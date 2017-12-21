const {CompositeDisposable, TextEditor, Point} = require("atom")
const _ = require("underscore-plus")
const Path = require("path")
const Git = require("./git")
const fs = require("fs-plus")

const {findInEditor, getRepositoryForEditor, getRepositoryForFilePath, setGrammarForEditor} = require("./utils")
const settings = require("./settings")
const DiffEditor = require("./diff-editor")

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
    get staged() {
      return /[A-Z]/.test(this.stage)
    },
    get unstaged() {
      return /[A-Z]/.test(this.workTree)
    },
  }
}

module.exports = class Ui {
  static start(repo) {
    new this(repo).start()
  }

  constructor(repo) {
    this.originalPane = atom.workspace.getActivePane()
    this.git = new Git(repo)
    this.editor = new TextEditor({autoHeight: false})

    Object.assign(this.editor, {
      getTitle: () => "mgit-status",
      getDefaultLocation: () => settings.get("openLocation"),
      getAllowedLocations: () => ["bottom", "right", "left", "center"],
    })

    this.editor.element.classList.add("mgit", "mgit-status")
    this.editor.onDidDestroy(this.destroy.bind(this))

    this.disposables = new CompositeDisposable()
    this.disposables.add(
      this.registerCommands(),
      this.observeEditors(),
      this.observeCursorMove(),
      this.editor.onDidSave(() => {
        this.needCommitOnDestroy = hasCommitMessage(this.editor.getText())
      })
    )
    this.needCommitOnDestroy = false
    this.statusMessage = "<, >, -, D, C"
  }

  observeEditors() {
    return atom.workspace.observeTextEditors(editor => {
      if (!editor.isMini() && this.repositoryHasEditor(editor)) {
        this.disposables.add(
          editor.onDidSave(async event => {
            if (this.preventAutoReresh) return
            await this.refreshStatus()
            this.refreshDiffIfNecessary(editor)
          })
        )
      }
    })
  }

  refreshDiffIfNecessary(editor) {
    if (this.diffEditor && this.diffEditor.isBasedOnEditor(editor)) {
      this.diffEditor.refresh()
    }
  }

  repositoryHasFilePath(filePath) {
    return getRepositoryForFilePath(filePath) === this.git.repo && fs.isFileSync(filePath)
  }

  repositoryHasEditor(editor) {
    return getRepositoryForEditor(editor) === this.git.repo
  }

  needUpdateDiff() {
    return this.autoDiff || settings.get("autoDiff")
  }

  observeCursorMove() {
    return this.editor.onDidChangeCursorPosition(event => {
      if (!this.needUpdateDiff()) return
      const {oldBufferPosition, newBufferPosition, textChanged, cursor} = event
      if (textChanged) return
      if (oldBufferPosition.row !== newBufferPosition.row) {
        this.diff()
      }
    })
  }

  async start() {
    const statusText = await this.git.status()
    if (statusText) {
      const bodyText = commentOut(statusText.trimRight())
      this.editor.setText(["## " + this.statusMessage, bodyText].join("\n"))
    } else {
      this.editor.setText("## No diff")
    }
    this.setModifiedState(false)
    this.editor.setCursorBufferPosition(Point.ZERO)
    await atom.workspace.open(this.editor)
    setGrammarForEditor(this.editor, "text.git-commit")
  }

  registerCommands() {
    return atom.commands.add(this.editor.element, {
      "mgit-ui:stage": () => this.stage(),
      "mgit-ui:unstage": () => this.unstage(),
      "mgit-ui:toggle-stage": () => this.toggleStage(),
      "mgit-ui:start-commit": () => this.startCommit(),
      "mgit-ui:add-all-and-start-commit": () => this.addAllAndStartCommit(),
      "mgit-ui:reset": () => this.gitReset(),
      "mgit-ui:toggle-diff": () => this.toggleDiff(),
      "core:close": event => this.close(event),
      "core:save": event => this.save(event),
    })
  }

  close(event) {
    event.stopImmediatePropagation()
    this.editor.destroy()
  }

  save(event) {
    event.stopImmediatePropagation()
    this.editor.save()
  }

  async toggleDiff() {
    if (this.diffEditor) {
      this.autoDiff = false
      this.diffEditor.destroy()
    } else {
      this.autoDiff = true
      await this.diff()
    }
  }

  async diff() {
    const row = this.editor.getCursorBufferPosition().row
    const fileName = parseStatusTextLine(this.editor.lineTextForBufferRow(row)).fileName
    const fullPath = Path.join(this.git.repo.getWorkingDirectory(), fileName)
    if (!this.repositoryHasFilePath(fullPath)) {
      return
    }
    if (!this.diffEditor) {
      this.diffEditor = new DiffEditor(this.git)
      this.diffEditor.editor.onDidDestroy(() => {
        this.diffEditor = null
      })
    }
    this.diffEditor.renderForFile(fileName)
  }

  refreshRepo() {
    this.git.repo.refreshStatus() // To update git-gutter color
  }

  writeMessage(message) {
    this.editor.setTextInBufferRange([[0, 3], [0, Infinity]], message)
  }

  async gitReset() {
    await this.git.reset()
    await this.refreshStatus()
  }

  async addAllAndStartCommit() {
    await this.git.addAll()
    await this.refreshStatus()
    this.startCommit()
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
    this.preventAutoReresh = true
    await this.editor.saveAs(commitFilePath)
    this.preventAutoReresh = false

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

    const state = {staged: [], unstaged: []}
    for (const {fileName, staged, unstaged} of parsedLines) {
      if (staged) state.staged.push(fileName)
      if (unstaged) state.unstaged.push(fileName)
    }
    return state
  }

  async stage() {
    const rowRange = this.editor.getLastSelection().getBufferRowRange()
    const files = this.parseStatusForRowRange(rowRange).unstaged
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
      await this.git.resetFiles(files)
      await this.refreshStatus()
    }
  }

  async toggleStage() {
    const rowRange = this.editor.getLastSelection().getBufferRowRange()
    const state = this.parseStatusForRowRange(rowRange)
    await this.git.add(state.unstaged)
    await this.git.resetFiles(state.staged)
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
    if (this.diffEditor) this.diffEditor.destroy()
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
