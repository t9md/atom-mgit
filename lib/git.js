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

function runGitCommand(args, cwd) {
  let stdoutText = ""
  let exit
  const exitPromise = new Promise(resolve => (exit = () => resolve(stdoutText)))
  runCommand({
    command: "git",
    args: args.split(/\s+/g),
    stdout: data => (stdoutText += data),
    stderr: data => console.warn("mgit: ", data),
    exit,
    options: {
      stdio: ["ignore", "pipe", "pipe"],
      env: process.env,
      cwd: cwd,
    },
  })
  return exitPromise
}

module.exports = class Git {
  constructor(repo) {
    this.repo = repo
  }

  run(args) {
    return runGitCommand(args, {cwd: this.repo.getWorkingDirectory()})
  }

  async status() {
    return this.run("status --porcelain --untracked-files=all")
  }

  async add(files) {
    if (files.length) {
      return this.run(`add -- ${files.join(" ")}`)
    }
  }

  async diff(file) {
    return this.run(`diff -- ${file}`)
  }

  async commit(messageFilePath) {
    if (!messageFilePath) {
      throw new Error("don't omit `messageFilePath`")
    }
    return this.run(`commit --cleanup=strip --file=${messageFilePath}`)
  }

  async reset(files) {
    if (files.length) {
      return this.run(`reset -- ${files.join(" ")}`)
    }
  }
}
