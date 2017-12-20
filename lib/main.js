const {CompositeDisposable} = require("atom")
const Git = require("./git")
const Ui = require("./ui")
// const mgit = new Git()

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
    if (repo) {
      const git = new Git(repo)
      const res = await git.status()
      if (res) {
        console.log(res)
        const ui = new Ui(git)
        ui.editor.setText(res)
        ui.setModifiedState(false)
        ui.editor.setCursorBufferPosition([0, 0])
        await ui.open()
      }
    }
  },
}
