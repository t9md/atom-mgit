const {CompositeDisposable} = require("atom")
const Ui = require("./ui")
const settings = require("./settings")

module.exports = {
  config: settings.config,

  activate() {
    this.installPackageDependencies()
    this.disposables = new CompositeDisposable(
      atom.commands.add("atom-text-editor", {
        "mgit:status": () => this.status(),
      })
    )
  },
  deactivate() {
    this.disposables.dispose()
  },

  async status() {
    const editor = atom.workspace.getActiveTextEditor()
    const filePath = editor.getPath()
    if (filePath) {
      const index = atom.project.getDirectories().findIndex(dir => dir.contains(filePath))
      const repo = atom.project.getRepositories()[index]
      if (repo) new Ui(repo).start()
    }
  },

  installPackageDependencies() {
    require("atom-package-deps")
      .install("mgit")
      .then(() => {
        console.log("All dependencies installed, good to go")
      })
  },
}
