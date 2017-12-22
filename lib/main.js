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
        "mgit:start-commit": () => this.status(true),
      })
    )
  },

  deactivate() {
    this.disposables.dispose()
  },

  async status(startCommit) {
    const editor = atom.workspace.getActiveTextEditor()
    const repo = getRepositoryForFilePath(editor.getPath())
    if (repo) {
      const ui = new Ui(repo)
      await ui.start()
      if (startCommit) {
        await ui.startCommit()
      }
    }
  },
}
