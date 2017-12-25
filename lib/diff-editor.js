const {CompositeDisposable, TextEditor, Point, Range, Emitter} = require("atom")
const {findInEditor, setGrammarForEditor, getBufferRangeForRowRange} = require("./utils")
const Path = require("path")

function activatePaneItem(item) {
  const pane = atom.workspace.paneForItem(item)
  if (pane) {
    pane.activate()
    pane.activateItem(item)
  }
}

function topPixelForBufferRow(editor, row) {
  return editor.element.pixelPositionForBufferPosition([row, 0]).top
}

module.exports = class DiffEditor {
  onDidDestroy(fn) { return this.emitter.on("did-destroy", fn) } // prettier-ignore
  emitDidDestroy() { this.emitter.emit("did-destroy") } // prettier-ignore

  get git() { return this.ui.git } // prettier-ignore

  constructor(ui) {
    this.ui = ui
    this.emitter = new Emitter()
    this.editor = this.buildEditor()
    this.editor.onDidDestroy(() => this.destroy())
    this.disposables = new CompositeDisposable()
    this.disposables.add(this.observeCursorMove(), this.observerActiveItem())
    this.registerCommands()
    this.ignoreCursorMove = false
  }

  observerActiveItem() {
    return atom.workspace.onDidStopChangingActivePaneItem(item => {
      // if (this.srcEditor === item) this.destroyDecorationMarker()
    })
  }

  buildEditor() {
    const editor = new TextEditor({
      lineNumberGutterVisible: false,
      autoHeight: false,
    })
    editor.buffer.isModified = () => false
    editor.element.classList.add("mgit", "mgit-diff")
    editor.getTitle = () => `mgit-diff`
    return editor
  }

  registerCommands() {
    atom.commands.add(this.editor.element, {
      "mgit-ui:move-to-next-hunk": () => this.moveToNextHunk(),
      "mgit-ui:move-to-previous-hunk": () => this.moveToPreviousHunk(),
      "mgit-ui:activate-src-editor": () => this.activateSrcEditor(),
    })
  }

  observeCursorMove() {
    return this.editor.onDidChangeCursorPosition(event => {
      if (this.ignoreCursorMove) return
      const {oldBufferPosition, newBufferPosition, textChanged, cursor} = event
      if (textChanged) return
      if (oldBufferPosition.row !== newBufferPosition.row) {
        this.syncFromDiffEditorToSrcEditor()
      }
    })
  }

  activate() {
    activatePaneItem(this.editor)
  }

  activateSrcEditor() {
    activatePaneItem(this.srcEditor)
  }

  getFullPathOfFileNameForDiff() {
    if (this.fileNameForDiff) {
      return Path.join(this.git.repo.getWorkingDirectory(), this.fileNameForDiff)
    }
  }

  async openSrcEditor() {
    const fullPath = this.getFullPathOfFileNameForDiff()
    if (this.srcEditorDisposables) {
      this.srcEditorDisposables.dispose()
    }
    this.srcEditor = await atom.workspace.open(fullPath, {pending: true, split: "left", activatePane: false})
    this.srcEditorDisposables = new CompositeDisposable()
    this.srcEditorDisposables.add(this.observeSrcEditorCursorMove())
    return this.srcEditor
  }

  observeSrcEditorCursorMove() {
    return this.srcEditor.onDidChangeCursorPosition(event => {
      const {oldBufferPosition, newBufferPosition, textChanged, cursor} = event
      if (textChanged) return
      if (oldBufferPosition.row !== newBufferPosition.row) {
        this.syncFromSrcEditorToDiffEditor(newBufferPosition.row)
      }
    })
  }

  async syncFromDiffEditorToSrcEditor() {
    const row = this.editor.getCursorBufferPosition().row
    const srcEditorRow = this.diffRowToSrcRow[row]
    if (srcEditorRow != null) {
      const srcEditor = await this.openSrcEditor()
      this.drawLineMarker(srcEditor, srcEditorRow)
      await this.editor.component.getNextUpdatePromise()
      const relativePixel = topPixelForBufferRow(this.editor, row) - this.editor.getScrollTop()
      const scrollTop = topPixelForBufferRow(srcEditor, srcEditorRow) - relativePixel
      srcEditor.element.setScrollTop(scrollTop)
    }
  }

  async syncFromSrcEditorToDiffEditor(row) {
    const diffEditorRow = this.srcRowToDiffRow[row]
    if (diffEditorRow != null) {
      const row = this.srcEditor.getCursorBufferPosition().row
      const relativePixel = topPixelForBufferRow(this.srcEditor, row) - this.srcEditor.getScrollTop()
      const scrollTop = topPixelForBufferRow(this.editor, diffEditorRow) - relativePixel
      this.editor.element.setScrollTop(scrollTop)
    }
  }

  // `diff --git a/lib/diff-editor.js b/lib/diff-editor.js
  // index 73c4b96..bcaff63 100644
  // --- a/lib/diff-editor.js
  // +++ b/lib/diff-editor.js
  // @@ -125,10 +125,25 @@ module.exports = class DiffEditor {
  //
  //    async openSrcEditor() {
  //      const fullPath = this.getFullPathOfFileNameForDiff()
  // +    if (this.srcEditorDisposables) {
  // +      this.srcEditorDisposables.dispose()
  // +    }
  //      this.srcEditor = await atom.workspace.open(fullPath, {pending: true, split: "left", activatePane: false})
  // `
  async parseDiff() {
    const from = [4, 0] // skip header row

    const regex = /(?:^@@ -\d+,\d+ \+(\d+),(\d+) @@.*$)|(^[ +-]).*$/g

    const scanRange = new Range(from, this.editor.getEofBufferPosition())
    const srcRowToDiffRow = {}
    const diffRowToSrcRow = {}
    const chunkRowRanges = []
    let startRow, endRow, currentRow
    this.editor.scanInBufferRange(regex, scanRange, ({match, range, stop}) => {
      if (match[1] != null) {
        currentRow = Number(match[1]) - 1
        const startRow = Number(match[1]) - 1
        const endRow = startRow + (Number(match[2]) - 1)
        chunkRowRanges.push([startRow, endRow])
      } else if (match[3]) {
        srcRowToDiffRow[currentRow] = range.start.row
        diffRowToSrcRow[range.start.row] = currentRow
        if (match[3] !== "-") currentRow++
      }
    })
    this.chunkRowRanges = chunkRowRanges
    this.srcRowToDiffRow = srcRowToDiffRow
    this.diffRowToSrcRow = diffRowToSrcRow
  }

  _parseDiff() {
    const hunks = []
    const startRow = 4 // skip 0 to 3 rows(4 lines in total)
    const lastRow = this.editor.getLastBufferRow()

    const lines = this.editor.buffer.getLines()
    const isInHunk = (hunk, char, row) => hunk.char === char && hunk.endRow + 1 === row
    const newHunk = (char, row) => ({char: char, startRow: row, endRow: row})
    const finalizeHunk = () => {
      if (currentHunk) hunks.push(currentHunk)
      currentHunk = null
    }

    let currentHunk
    for (let row = startRow; row <= lastRow; row++) {
      const char = lines[row][0]
      if (char === "+" || char === "-") {
        if (currentHunk && isInHunk(currentHunk, char, row)) {
          currentHunk.endRow = row
        } else {
          finalizeHunk()
          currentHunk = newHunk(char, row)
        }
      } else {
        finalizeHunk()
      }
    }
    finalizeHunk()
    return hunks
  }

  moveToHunk(direction) {
    const cursorRow = this.editor.getCursorBufferPosition().row
    let hunk
    if (direction === "next") {
      const hunks = this._parseDiff()
      hunk = hunks.find(hunk => hunk.startRow > cursorRow)
    } else {
      const hunks = this._parseDiff().reverse()
      hunk = hunks.find(hunk => hunk.startRow < cursorRow)
    }
    if (hunk) this.editor.setCursorBufferPosition([hunk.startRow, 0])
  }

  moveToNextHunk() {
    this.moveToHunk("next")
  }

  moveToPreviousHunk() {
    this.moveToHunk("previous")
  }

  async refreshIfBasedOnEditor(editor) {
    if (this.fileNameForDiff && this.fileNameForDiff === atom.project.relativize(editor.getPath())) {
      this.renderForFile(this.fileNameForDiff, this.useCached)
    }
  }

  async renderForFile(fileName, useCached) {
    this.useCached = useCached
    this.fileNameForDiff = fileName

    this.ignoreCursorMove = true
    this.editor.setText((await this.git.diff(fileName, useCached)) || "no diff")
    this.parseDiff()

    const pane = atom.workspace.paneForItem(this.editor)
    if (pane) {
      pane.activateItem(this.editor)
    } else {
      const activePane = atom.workspace.getActivePane()
      await atom.workspace.open(this.editor, {split: "right", activatePane: false})
      setGrammarForEditor(this.editor, "source.mgit-diff")
      if (atom.workspace.getActivePane() !== activePane) {
        activePane.activate()
      }
    }
    await this.openSrcEditor()
    const chunkRanges = this.chunkRowRanges.map(rowRange => {
      return getBufferRangeForRowRange(this.srcEditor, rowRange)
    })
    this.highlightChunkRanges(this.srcEditor, chunkRanges)

    this.editor.setCursorBufferPosition(Point.ZERO)
    this.ignoreCursorMove = false
  }

  destroy() {
    if (this.destroyed) return
    this.destroyed = true
    this.disposables.dispose()

    if (this.editor.isAlive()) {
      this.editor.destroy()
    }
    this.destroyDecorationMarker()
    this.emitDidDestroy()
  }

  destroyDecorationMarker() {
    if (this.lineMarker) this.lineMarker.destroy()
    if (this.chunkMarkers) {
      this.chunkMarkers.forEach(marker => marker.destroy())
    }
  }

  highlightChunkRanges(editor, ranges) {
    if (this.chunkMarkers) {
      this.chunkMarkers.forEach(marker => marker.destroy())
    }
    this.chunkMarkers = []

    const decorateRange = range => {
      const marker = editor.markBufferRange(range)
      editor.decorateMarker(marker, {type: "highlight", class: "mgit-chunk-range"})
      this.chunkMarkers.push(marker)
    }

    ranges.forEach(decorateRange)
  }

  highlightCurrentChunk(editor, rowRanges) {
    return
    if (this.chunkMarkers) {
      this.chunkMarkers.forEach(marker => marker.destroy())
    }

    this.chunkMarker = editor.markBufferRange(getBufferRangeForRowRange(editor, rowRange))
    editor.decorateMarker(this.chunkMarker, {
      type: "highlight",
      class: "mgit-chunk-range",
    })
  }

  drawLineMarker(editor, row) {
    if (this.lineMarker) this.lineMarker.destroy()

    this.lineMarker = editor.markBufferPosition([row, 0])
    editor.decorateMarker(this.lineMarker, {
      type: "line",
      class: "mgit-line-marker",
    })
  }
}
