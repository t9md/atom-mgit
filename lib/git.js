const {BufferedProcess} = require("atom")

function runCommand(options) {
  const bufferedProcess = new BufferedProcess(options)
  bufferedProcess.onWillThrowError(({error, handle}) => {
    if (error.code === "ENOENT" && error.syscall.indexOf("spawn") === 0) {
      console.log("ERROR")
    }
    handle()
  })
  return bufferedProcess
}

// Run git commands
module.exports = class Git {
  constructor(repo) {
    this.repo = repo
  }

  runGitCommand(args) {
    args = args.split(/\s+/g)
    const options = {
      stdio: ["ignore", "pipe", "pipe"],
      env: process.env,
      cwd: this.repo.getWorkingDirectory(),
    }

    let stdoutText = ""
    const stdout = data => {
      stdoutText += data
    }
    const stderr = data => console.warn("mgit: ", data)
    let exit
    const exitPromise = new Promise(resolve => {
      exit = () => {
        resolve(stdoutText)
      }
    })

    runCommand({command: "git", args, stdout, stderr, exit, options})
    return exitPromise
  }

  status() {
    return this.runGitCommand("status --porcelain --untracked-files=all")
  }

  async add(files) {
    if (files.length) {
      return this.runGitCommand(`add -- ${files.join(" ")}`)
    }
  }

  async commit(messageFilePath) {
    return this.runGitCommand(`commit --file=${messageFilePath}`)
  }

  async reset(files) {
    if (files.length) {
      return this.runGitCommand(`reset -- ${files.join(" ")}`)
    }
  }
}
