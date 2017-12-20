const {CompositeDisposable} = require("atom")
const _ = require("underscore-plus")

module.exports = class Ui {
  constructor(git) {
    this.git = git
    this.editor = atom.workspace.buildTextEditor({})
    // lineNumberGutterVisible: false,
    // autoHeight: false,

    this.editor.getTitle = () => "mgit:status"
    this.editor.element.classList.add("mgit-ui")
    this.editor.onDidDestroy(this.destroy.bind(this))

    this.disposables = new CompositeDisposable(this.registerCommands())
  }

  registerCommands() {
    return atom.commands.add(this.editor.element, {
      // "mgit-ui:add": () => this.add(),
      "mgit-ui:toggle-stage": () => this.toggleStage(),
    })
  }

  add() {
    const selection = this.editor.getLastSelection()
    const files = []

    const [startRow, endRow] = selection.getBufferRowRange()
    const shortStatusHeaderLength = 3
    for (let row = startRow; row <= endRow; row++) {
      files.push(this.editor.lineTextForBufferRow(startRow).slice(shortStatusHeaderLength))
    }
    this.git.add(files)
  }

  async toggleStage() {
    const selection = this.editor.getLastSelection()
    const addFiles = []
    const resetFiles = []

    const [startRow, endRow] = selection.getBufferRowRange()
    const shortStatusHeaderLength = 3
    for (let row = startRow; row <= endRow; row++) {
      const lineText = this.editor.lineTextForBufferRow(startRow)
      const fileName = lineText.slice(shortStatusHeaderLength)
      const firstChar = lineText[0]
      if (/[A-Z]/.test(firstChar)) {
        resetFiles.push(fileName)
      } else {
        addFiles.push(fileName)
      }
    }
    console.log("add = ", addFiles, "reset =", resetFiles)
    await this.git.add(addFiles)
    await this.git.reset(resetFiles)
    await this.refreshStatus()
  }

  async refreshStatus() {
    const sortOrder = {}
    const cursorPosition = this.editor.getCursorBufferPosition()
    const shortStatusHeaderLength = 3
    const lines = this.editor.buffer.getLines().map(line => line.slice(shortStatusHeaderLength))
    lines.forEach((line, index) => (sortOrder[line] = index))

    console.log("REFreshing!")
    const res = await this.git.status()
    const text = _.sortBy(res.split("\n"), t => sortOrder[t.slice(shortStatusHeaderLength)]).join("\n") + "\n"
    this.editor.setText(text)
    // this.setModifiedState(false)
    this.editor.setCursorBufferPosition(cursorPosition)
  }

  async open(options = {split: "right"}) {
    return atom.workspace.open(this.editor, options)
  }

  setModifiedState(state) {
    if (state === this.modifiedState) return

    // HACK: overwrite TextBuffer:isModified to return static state.
    // This state is used by tabs package to show modified icon on tab.
    this.modifiedState = state
    this.editor.buffer.isModified = () => state
    this.editor.buffer.emitModifiedStatusChanged(state)
  }

  destroy() {}
}
