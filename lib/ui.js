const {CompositeDisposable, TextEditor} = require("atom")
const _ = require("underscore-plus")
const Path = require("path")
const Git = require("./git")

const {inspect} = require("util")
const p = (...args) => {
  console.log(inspect(...args, {depth: null}))
}

const commentText = "# "
const statusHeaderLength = 3 + commentText.length

function mapEachLine(text, fn) {
  return text
    .split(/\r?\n/)
    .map(fn)
    .join("\n")
}

function isCommentLine(lineText) {
  return /^#.*$/.test(lineText)
}
function isEmptyLine(lineText) {
  return /^\s*$/.test(lineText)
}

function isCommentOrEmptyLine(lineText) {
  return isEmptyLine(lineText) || isCommentLine(lineText)
}

function hasCommitMessage(text) {
  return !text.split(/\r?\n/).every(isCommentOrEmptyLine)
}

function commentOut(text) {
  return mapEachLine(text, lineText => commentText + lineText)
}

function parseStatusTextLine(lineText) {
  const text = lineText.slice(commentText.length)
  return {
    stage: text[0],
    workTree: text[1],
    fileName: text.slice(3),
    get isStaged() {
      return /[A-Z]/.test(this.stage)
    },
  }
}

module.exports = class Ui {
  constructor(repo) {
    this.git = new Git(repo)
    this.editor = new TextEditor()
    this.editor.getTitle = () => "mgit:status"
    this.editor.element.classList.add("mgit-ui")
    this.editor.onDidDestroy(this.destroy.bind(this))
    this.disposables = new CompositeDisposable(this.registerCommands())
    this.needCommitOnDestroy = false
    this.editor.onDidSave(() => {
      this.needCommitOnDestroy = hasCommitMessage(this.editor.getText())
    })
  }

  async start() {
    const text = (await this.git.status()) || "no diff"
    this.editor.setText(commentOut(text.trimRight()))
    this.setModifiedState(false)
    this.editor.setCursorBufferPosition([0, 0])
    await atom.workspace.open(this.editor, {split: "down"})

    const gitCommitGrammar = atom.grammars.grammarForScopeName("text.git-commit")
    this.editor.setGrammar(gitCommitGrammar)
  }

  registerCommands() {
    return atom.commands.add(this.editor.element, {
      // "mgit-ui:add": () => this.add(),
      "mgit-ui:toggle-stage": () => this.toggleStage(),
      "mgit-ui:commit": () => this.commit(),
    })
  }

  async commit() {
    const range = [[0, 0], [0, 0]]
    const commitFilePath = Path.join(this.git.repo.getPath(), "COMMIT_EDITMSG")
    this.setModifiedState(true)
    this.unmockBuffer()
    await this.editor.saveAs(commitFilePath)

    this.editor.setTextInBufferRange([[0, 0], [0, 0]], "\n")
    this.editor.setCursorBufferPosition([0, 0])
    this.vmpActivateInsertMode()
  }

  async toggleStage() {
    const selection = this.editor.getLastSelection()
    const addFiles = []
    const resetFiles = []

    const [startRow, endRow] = selection.getBufferRowRange()

    for (let row = startRow; row <= endRow; row++) {
      const parsed = parseStatusTextLine(this.editor.lineTextForBufferRow(startRow))
      const {fileName, isStaged} = parsed
      // console.log(isStaged, fileName, parsed.isStaged)
      if (isStaged) {
        resetFiles.push(fileName)
      } else {
        addFiles.push(fileName)
      }
    }
    // console.log("add = ", addFiles, "reset =", resetFiles)
    await this.git.add(addFiles)
    await this.git.reset(resetFiles)
    await this.refreshStatus()
  }

  async refreshStatus() {
    const fileNameByRow = {}
    const cursorPosition = this.editor.getCursorBufferPosition()
    this.editor.buffer.getLines().forEach((lineText, index) => {
      fileNameByRow[parseStatusTextLine(lineText).fileName] = index
    })

    const res = await this.git.status()
    const byOriginalRow = lineText => fileNameByRow[parseStatusTextLine(lineText).fileName]
    const text = _.sortBy(commentOut(res.trimRight()).split("\n"), byOriginalRow).join("\n")
    this.editor.setText(text)
    // this.setModifiedState(false)
    this.editor.setCursorBufferPosition(cursorPosition)
  }

  setModifiedState(state) {
    if (state === this.modifiedState) return

    // HACK: overwrite TextBuffer:isModified to return static state.
    // This state is used by tabs package to show modified icon on tab.
    this.modifiedState = state
    if (!this.originalIsModified) {
      this.originalIsModified = this.editor.buffer.isModified
    }
    this.editor.buffer.isModified = () => state
    this.editor.buffer.emitModifiedStatusChanged(state)
  }

  unmockBuffer() {
    if (this.originalIsModified) {
      this.editor.buffer.isModified = this.originalIsModified
    }
  }

  destroy() {
    if (this.needCommitOnDestroy) {
      const commitFilePath = Path.join(this.git.repo.getPath(), "COMMIT_EDITMSG")
      this.git.commit(commitFilePath)
    }
  }

  vmpActivateNormalMode() { atom.commands.dispatch(this.editor.element, "vim-mode-plus:activate-normal-mode") } // prettier-ignore
  vmpActivateInsertMode() { atom.commands.dispatch(this.editor.element, "vim-mode-plus:activate-insert-mode") } // prettier-ignore
  vmpIsInsertMode() { return this.vmpIsEnabled() && this.editor.element.classList.contains("insert-mode") } // prettier-ignore
  vmpIsNormalMode() { return this.vmpIsEnabled() && this.editor.element.classList.contains("normal-mode") } // prettier-ignore
  vmpIsEnabled() { return this.editor.element.classList.contains("vim-mode-plus") } // prettier-ignore
}
