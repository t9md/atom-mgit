const {CompositeDisposable} = require("atom")
const Ui = require("./ui")
const settings = require("./settings")
const {getRepositoryForFilePath} = require("./utils")

module.exports = {
  config: settings.config,

  activate() {
    require("atom-package-deps").install("mgit")
    this.disposables = new CompositeDisposable(
      atom.commands.add("atom-text-editor", {
        "mgit:status": () => this.status(),
      })
    )
  },

  deactivate() {
    this.disposables.dispose()
  },

  status() {
    const editor = atom.workspace.getActiveTextEditor()
    const repo = getRepositoryForFilePath(editor.getPath())
    if (repo) Ui.start(repo)
  },
}
