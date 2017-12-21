const {CompositeDisposable, TextEditor, Point} = require("atom")
const {findInEditor, setGrammarForEditor} = require("./utils")

function isHunkRow(editor, row) {
  return row >= 5 && editor.lineTextForBufferRow(row).search(/^[+-]/) !== -1
}

module.exports = class DiffEditor {
  constructor(git) {
    this.git = git
    const editor = new TextEditor({autoHeight: false})
    this.editor = editor

    editor.buffer.isModified = () => false
    editor.element.classList.add("mgit", "mgit-diff")
    editor.getTitle = () => `mgit-diff:${this.fileNameForDiff}`

    atom.commands.add(editor.element, {
      "mgit-ui:move-to-next-hunk": () => this.moveToNextHunk(),
      "mgit-ui:move-to-previous-hunk": () => this.moveToPreviousHunk(),
    })
  }

  moveToNextHunk() {
    const from = this.editor.getCursorBufferPosition()
    const regex = /^[+-]/g
    let rowsToSkip = isHunkRow(this.editor, from.row) ? from.row + 1 : -1
    const point = findInEditor(this.editor, regex, "forward", {from}, event => {
      const {start} = event.range
      if (start.row === rowsToSkip) {
        rowsToSkip++
        return
      }
      if (start.row >= 5 && start.isGreaterThan(from)) return start
    })
    if (point) this.editor.setCursorBufferPosition(point)
  }

  moveToPreviousHunk() {
    const from = this.editor.getCursorBufferPosition()
    const regex = /^[+-]/g
    let rowsToSkip = isHunkRow(this.editor, from.row) ? from.row - 1 : -1
    const point = findInEditor(this.editor, regex, "backward", {from}, event => {
      const {start} = event.range
      if (start.row === rowsToSkip) {
        rowsToSkip--
        return
      }
      if (start.row >= 5 && start.isLessThan(from)) return start
    })
    if (point) this.editor.setCursorBufferPosition(point)
  }

  async refresh() {
    const text = (await this.git.diff(this.fileNameForDiff, this.useCached)) || "no diff"
    this.diffEditor.setText(text)
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
      if (atom.workspace.getActivePane() !== activePane) {
        activePane.activate()
      }
    }
    setGrammarForEditor(this.editor, "source.diff")
    this.editor.setCursorBufferPosition(Point.ZERO)
  }

  destroy() {
    if (this.editor.isAlive()) {
      this.editor.destroy()
    }
    this.editor = null
  }
}
