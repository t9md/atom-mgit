const {CompositeDisposable, TextEditor, Point, Emitter} = require("atom")
const {findInEditor, setGrammarForEditor} = require("./utils")

function isHunkRow(editor, row) {
  return row >= 5 && editor.lineTextForBufferRow(row).search(/^[+-]/) !== -1
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
