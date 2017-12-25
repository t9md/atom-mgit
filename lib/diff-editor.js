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
      if (this.syncingEditor === item) this.destroyDecorationMarker()
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
      "mgit-ui:activate-syncing-editor": () => this.activateSyncingEditor(),
    })
  }

  observeCursorMove() {
    return this.editor.onDidChangeCursorPosition(event => {
      if (this.ignoreCursorMove) return
      const {oldBufferPosition, newBufferPosition, textChanged, cursor} = event
      if (textChanged) return
      if (oldBufferPosition.row !== newBufferPosition.row) {
        this.syncToEditor()
      }
    })
  }

  activate() {
    activatePaneItem(this.editor)
  }

  activateSyncingEditor() {
    activatePaneItem(this.syncingEditor)
  }

  getFullPathOfFileNameForDiff() {
    if (this.fileNameForDiff) {
      return Path.join(this.git.repo.getWorkingDirectory(), this.fileNameForDiff)
    }
  }

  async syncToEditor() {
    const cursorRow = this.editor.getCursorBufferPosition().row
    const from = [cursorRow, Infinity]
    const regex = /^@@ -\d+,\d+ \+(\d+),(\d+) @@.*$/g
    const event = findInEditor(this.editor, "backward", regex, {from}, event => {
      return event
    })

    if (!event) return

    const fullPath = this.getFullPathOfFileNameForDiff()
    const editor = await atom.workspace.open(fullPath, {pending: true, split: "left", activatePane: false})

    const chunkHeaderRow = event.range.start.row
    const chunkStartRow = chunkHeaderRow + 1
    const baseEditorChunkStartRow = Number(event.match[1]) - 1
    const baseEditorChunkEndRow = baseEditorChunkStartRow + (Number(event.match[2]) - 1)

    const isRemovedRow = row => this.editor.lineTextForBufferRow(row)[0].startsWith("-")
    let nonRemovedCursorRow = cursorRow
    if (isRemovedRow(cursorRow)) {
      const scanRange = [[cursorRow, 0], [chunkHeaderRow, 0]]
      nonRemovedCursorRow = findInEditor(this.editor, "backward", /^[^-].*$/, {scanRange}, event => {
        return event.range.start.row
      })
    }

    let relativeRow = -1
    for (let row = chunkStartRow; row <= nonRemovedCursorRow; row++) {
      if (/^[+ ]$/.test(this.editor.lineTextForBufferRow(row)[0])) {
        relativeRow++
      }
    }
    const baseEditorBufferRowAtCursorRow = Math.max(baseEditorChunkStartRow + relativeRow, 0)
    const point = new Point(baseEditorBufferRowAtCursorRow, 0)
    this.syncingEditor = editor
    editor.setCursorBufferPosition(point, {autoscroll: false})
    this.highlightCurrentChunk(editor, [baseEditorChunkStartRow, baseEditorChunkEndRow])
    this.drawLineMarker(editor, point.row)

    await this.editor.component.getNextUpdatePromise()
    const relativePixel = topPixelForBufferRow(this.editor, nonRemovedCursorRow) - this.editor.getScrollTop()
    const scrollTop = topPixelForBufferRow(editor, point.row) - relativePixel
    editor.element.setScrollTop(scrollTop)
  }

  parseDiff() {
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
      const hunks = this.parseDiff()
      hunk = hunks.find(hunk => hunk.startRow > cursorRow)
    } else {
      const hunks = this.parseDiff().reverse()
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
    if (this.chunkMarker) this.chunkMarker.destroy()
  }

  highlightCurrentChunk(editor, rowRange) {
    if (this.chunkMarker) this.chunkMarker.destroy()

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
