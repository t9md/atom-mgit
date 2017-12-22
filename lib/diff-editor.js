const {CompositeDisposable, TextEditor, Point, Range, Emitter} = require("atom")
const {findInEditor, setGrammarForEditor} = require("./utils")

function isHunkRow(editor, row) {
  return row >= 5 && editor.lineTextForBufferRow(row).search(/^[+-]/) !== -1
}

// return '+' or '-''
function getHunkCharForRow(editor, row) {
  return editor.lineTextForBufferRow(row)[0]
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

    atom.commands.add(this.editor.element, {
      "mgit-ui:move-to-next-hunk": () => this.moveToNextHunk(),
      "mgit-ui:move-to-previous-hunk": () => this.moveToPreviousHunk(),
    })
  }

  buildEditor() {
    const editor = new TextEditor({autoHeight: false})
    editor.buffer.isModified = () => false
    editor.element.classList.add("mgit", "mgit-diff")
    editor.getTitle = () => `mgit-diff`
    return editor
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

  async refresh() {
    const text = (await this.git.diff(this.fileNameForDiff, this.useCached)) || "no diff"
    this.diffEditor.setText(text)
  }

  async refreshIfBasedOnEditor(editor) {
    if (this.isBasedOnEditor(editor)) {
      await refresh()
    }
  }

  isBasedOnEditor(editor) {
    return this.fileNameForDiff && this.fileNameForDiff === atom.project.relativize(editor.getPath())
  }

  async renderForFile(fileName, useCached) {
    const text = (await this.git.diff(fileName, useCached)) || "no diff"
    this.useCached = useCached
    this.fileNameForDiff = fileName
    this.editor.setText(text)
    const pane = atom.workspace.paneForItem(this.editor)
    if (pane) {
      pane.activateItem(this.editor)
    } else {
      const activePane = atom.workspace.getActivePane()
      await atom.workspace.open(this.editor, {split: "right", activatePane: false})
      setGrammarForEditor(this.editor, "source.diff")
      if (atom.workspace.getActivePane() !== activePane) {
        activePane.activate()
      }
    }
    this.editor.setCursorBufferPosition(Point.ZERO)
  }

  destroy() {
    if (this.destroyed) return
    this.destroyed = true

    if (this.editor.isAlive()) {
      this.editor.destroy()
    }
    this.emitDidDestroy()
  }
}
