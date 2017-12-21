const {CompositeDisposable} = require("atom")
const Ui = require("./ui")
const settings = require("./settings")

module.exports = {
  config: settings.config,

  activate() {
    this.installPackageDependencies()
    this.disposables = new CompositeDisposable(
      atom.commands.add("atom-workspace", {
        "mgit:status": () => this.status(),
      })
    )
  },
  deactivate() {
    this.disposables.dispose()
  },
  async status() {
    const repo = atom.project.getRepositories()[0]
    if (repo) new Ui(repo).start()
  },

  installPackageDependencies() {
    require("atom-package-deps")
      .install("mgit")
      .then(() => {
        console.log("All dependencies installed, good to go")
      })
  },
}
