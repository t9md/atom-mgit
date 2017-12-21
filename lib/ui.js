const {CompositeDisposable, TextEditor, Point} = require("atom")
const _ = require("underscore-plus")
const Path = require("path")
const Git = require("./git")

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

function setGrammarForEditor(editor, scopeName) {
  const grammar = atom.grammars.grammarForScopeName(scopeName)
  editor.setGrammar(grammar)
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
    this.originalPane = atom.workspace.getActivePane()
    this.git = new Git(repo)
    this.editor = new TextEditor({autoHeight: false})
    this.editor.getTitle = () => "mgit:status"
    this.editor.element.classList.add("mgit", "mgit-status")
    this.editor.onDidDestroy(this.destroy.bind(this))
    this.disposables = new CompositeDisposable(this.registerCommands())
    this.needCommitOnDestroy = false
    this.editor.onDidSave(() => {
      this.needCommitOnDestroy = hasCommitMessage(this.editor.getText())
    })
    this.statusMessage = "[<, >, -] stage/unstage/toggle [D] diff [C] commit"
    this.observeCursorMove()
  }

  observeCursorMove() {
    return this.editor.onDidChangeCursorPosition(event => {
      if (!this.autoDiff) return
      const {oldBufferPosition, newBufferPosition, textChanged, cursor} = event
      if (textChanged) return
      if (oldBufferPosition.row !== newBufferPosition.row) {
        this.diff()
      }
    })
  }

  async start() {
    const text = (await this.git.status()) || "* no diff"
    this.render(commentOut(text.trimRight()))
    this.setModifiedState(false)
    this.editor.setCursorBufferPosition(Point.ZERO)
    await atom.workspace.open(this.editor, {split: "down"})
    setGrammarForEditor(this.editor, "text.git-commit")
  }

  registerCommands() {
    return atom.commands.add(this.editor.element, {
      "mgit-ui:stage": () => this.stage(),
      "mgit-ui:unstage": () => this.unstage(),
      "mgit-ui:toggle-stage": () => this.toggleStage(),
      "mgit-ui:start-commit": () => this.startCommit(),
      "mgit-ui:toggle-diff": () => this.toggleDiff(),
    })
  }

  prepareDiffEditor() {
    if (!this.diffEditor) {
      const editor = new TextEditor({autoHeight: false})
      editor.buffer.isModified = () => false
      editor.element.classList.add("mgit", "mgit-diff")
      editor.getTitle = () => "mgit:diff"
      editor.onDidDestroy(() => {
        this.diffEditor = null
        const pane = atom.workspace.paneForItem(this.editor)
        if (pane) pane.activate()
      })
      this.diffEditor = editor
    }
  }

  async toggleDiff() {
    if (this.diffEditor) {
      this.autoDiff = false
      this.diffEditor.destroy()
    } else {
      this.autoDiff = true
      this.diff()
    }
  }

  async diff() {
    this.prepareDiffEditor()
    const row = this.editor.getCursorBufferPosition().row
    const fileName = parseStatusTextLine(this.editor.lineTextForBufferRow(row)).fileName
    const text = (await this.git.diff(fileName)) || "no diff"
    this.diffEditor.setText(text)
    const pane = atom.workspace.paneForItem(this.diffEditor)
    if (pane) {
      pane.activateItem(this.diffEditor)
    } else {
      const activePane = atom.workspace.getActivePane()
      await atom.workspace.open(this.diffEditor, {split: "right", activatePane: false})
      if (atom.workspace.getActivePane() !== activePane) {
        activePane.activate()
      }
    }
    setGrammarForEditor(this.diffEditor, "source.diff")
    this.diffEditor.setCursorBufferPosition(Point.ZERO)
  }

  refreshRepo() {
    this.git.repo.refreshStatus() // To update git-gutter color
  }

  writeMessage(message) {
    this.editor.setTextInBufferRange([[0, 3], [0, Infinity]], message)
  }
  async startCommit() {
    const commitFilePath = Path.join(this.git.repo.getPath(), "COMMIT_EDITMSG")
    const state = this.parseStatusForRowRange([0, this.editor.getLastBufferRow()])
    if (!state.staged.length) {
      this.writeMessage("Nothing staged")
      return
    }

    this.setModifiedState(true)
    this.unmockBufferIsModified()
    await this.editor.saveAs(commitFilePath)

    this.editor.setTextInBufferRange([Point.ZERO, Point.ZERO], "\n")
    this.editor.setCursorBufferPosition(Point.ZERO)
    this.vmpActivateInsertMode()
  }

  parseStatusForRowRange(rowRange) {
    const [startRow, endRow] = rowRange
    const parsedLines = []
    for (let row = startRow; row <= endRow; row++) {
      parsedLines.push(parseStatusTextLine(this.editor.lineTextForBufferRow(row)))
    }

    const state = {staged: [], notStaged: []}
    for (const {fileName, isStaged} of parsedLines) {
      state[isStaged ? "staged" : "notStaged"].push(fileName)
    }
    return state
  }

  async stage() {
    const rowRange = this.editor.getLastSelection().getBufferRowRange()
    const files = this.parseStatusForRowRange(rowRange).notStaged
    if (files.length) {
      await this.git.add(files)
      await this.refreshStatus()
    }
  }

  async render(bodyText) {
    const text = ["## " + this.statusMessage, bodyText].join("\n")
    this.editor.setText(text)
  }

  async unstage() {
    const rowRange = this.editor.getLastSelection().getBufferRowRange()
    const files = this.parseStatusForRowRange(rowRange).staged
    if (files.length) {
      await this.git.reset(files)
      await this.refreshStatus()
    }
  }

  async toggleStage() {
    const rowRange = this.editor.getLastSelection().getBufferRowRange()
    const state = this.parseStatusForRowRange(rowRange)
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
    this.render(text)
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

  unmockBufferIsModified() {
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
    if (this.originalPane.isAlive()) {
      this.originalPane.activate()
    }
  }

  vmpActivateNormalMode() { atom.commands.dispatch(this.editor.element, "vim-mode-plus:activate-normal-mode") } // prettier-ignore
  vmpActivateInsertMode() { atom.commands.dispatch(this.editor.element, "vim-mode-plus:activate-insert-mode") } // prettier-ignore
  vmpIsInsertMode() { return this.vmpIsEnabled() && this.editor.element.classList.contains("insert-mode") } // prettier-ignore
  vmpIsNormalMode() { return this.vmpIsEnabled() && this.editor.element.classList.contains("normal-mode") } // prettier-ignore
  vmpIsEnabled() { return this.editor.element.classList.contains("vim-mode-plus") } // prettier-ignore
}
