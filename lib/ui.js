const {CompositeDisposable, TextEditor} = require("atom")
const _ = require("underscore-plus")
const Path = require("path")
const Git = require("./git")

const {inspect} = require("util")
const p = (...args) => {
  console.log(inspect(...args, {depth: null}))
}

const COMMENT_TEXT = "# "
const STATUS_PART_LENGTH = 3

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
  return text
    .split(/\r?\n/)
    .map(lineText => COMMENT_TEXT + lineText)
    .join("\n")
}

function parseStatusTextLine(lineText) {
  const text = lineText.slice(COMMENT_TEXT.length)
  return {
    stage: text[0],
    workTree: text[1],
    fileName: text.slice(STATUS_PART_LENGTH),
    get isStaged() {
      return /[A-Z]/.test(this.stage)
    },
  }
}

module.exports = class Ui {
  constructor(repo) {
    this.git = new Git(repo)
    this.editor = new TextEditor({autoHeight: false})
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
      "mgit-ui:stage": () => this.stage(),
      "mgit-ui:unstage": () => this.unstage(),
      "mgit-ui:toggle-stage": () => this.toggleStage(),
      "mgit-ui:start-commit": () => this.startCommit(),
    })
  }

  refreshRepo() {
    // To update git-gutter color
    this.git.repo.refreshStatus()
  }

  async startCommit() {
    const range = [[0, 0], [0, 0]]
    const commitFilePath = Path.join(this.git.repo.getPath(), "COMMIT_EDITMSG")
    this.setModifiedState(true)
    this.unmockBuffer()
    await this.editor.saveAs(commitFilePath)

    this.editor.setTextInBufferRange([[0, 0], [0, 0]], "\n")
    this.editor.setCursorBufferPosition([0, 0])
    this.vmpActivateInsertMode()
  }

  parseSelectedRows() {
    const [startRow, endRow] = this.editor.getLastSelection().getBufferRowRange()
    const results = []
    for (let row = startRow; row <= endRow; row++) {
      results.push(parseStatusTextLine(this.editor.lineTextForBufferRow(row)))
    }
    return results
  }

  parseStatus() {
    const state = {staged: [], notStaged: []}
    const parsedLines = this.parseSelectedRows()
    for (const {fileName, isStaged} of parsedLines) {
      state[isStaged ? "staged" : "notStaged"].push(fileName)
    }
    return state
  }
  async stage() {
    const files = this.parseStatus().notStaged
    if (files.length) {
      await this.git.add(files)
      await this.refreshStatus()
    }
  }

  async unstage() {
    const files = this.parseStatus().staged
    if (files.length) {
      await this.git.reset(files)
      await this.refreshStatus()
    }
  }

  async toggleStage() {
    const state = this.parseStatus()
    await this.git.add(state.notStaged)
    await this.git.reset(state.staged)
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
      this.refreshRepo()
    }
  }

  vmpActivateNormalMode() { atom.commands.dispatch(this.editor.element, "vim-mode-plus:activate-normal-mode") } // prettier-ignore
  vmpActivateInsertMode() { atom.commands.dispatch(this.editor.element, "vim-mode-plus:activate-insert-mode") } // prettier-ignore
  vmpIsInsertMode() { return this.vmpIsEnabled() && this.editor.element.classList.contains("insert-mode") } // prettier-ignore
  vmpIsNormalMode() { return this.vmpIsEnabled() && this.editor.element.classList.contains("normal-mode") } // prettier-ignore
  vmpIsEnabled() { return this.editor.element.classList.contains("vim-mode-plus") } // prettier-ignore
}
