const {CompositeDisposable} = require("atom")
const Ui = require("./ui")

module.exports = {
  activate() {
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
}
