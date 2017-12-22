const {CompositeDisposable, TextEditor, Point, Emitter} = require("atom")
const _ = require("underscore-plus")
const Path = require("path")
const Git = require("./git")
const fs = require("fs-plus")

const {
  findInEditor,
  repositoryHasFilePath,
  getRepositoryForFilePath,
  setGrammarForEditor,
  hasCommitMessage,
} = require("./utils")
const settings = require("./settings")
const DiffEditor = require("./diff-editor")

const COMMENT_TEXT = "# "
const STATUS_PART_LENGTH = 3

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
    get untracked() {
      return this.stage === "?" && this.workTree === "?"
    },
  }
}

module.exports = class Ui {
  static start(repo) {
    new this(repo).start()
  }

  setPhase(phase) {
    this.phase = phase
  }

  onDidDestroy(fn) { return this.emitter.on("did-destroy", fn) } // prettier-ignore
  emitDidDestroy() { this.emitter.emit("did-destroy") } // prettier-ignore

  constructor(repo) {
    this.emitter = new Emitter()

    this.setPhase("status")
    this.originalPane = atom.workspace.getActivePane()
    this.git = new Git(repo)

    this.editor = this.buildStatusEditor()
    this.editor.onDidDestroy(() => this.destroy())

    this.disposables = new CompositeDisposable()
    this.disposables.add(
      this.registerCommands(), //
      this.observeEditors(),
      this.observeCursorMove()
    )
    this.statusMessage = "<, >, -, D, C"
  }

  buildStatusEditor() {
    const editor = new TextEditor({autoHeight: false})

    Object.assign(editor, {
      getTitle: () => "mgit-status",
      getDefaultLocation: () => settings.get("openLocation"),
      getAllowedLocations: () => ["bottom", "right", "left", "center"],
    })

    editor.element.classList.add("mgit", "mgit-status")
    return editor
  }

  registerCommands() {
    return atom.commands.add(this.editor.element, {
      "mgit-ui:stage": () => this.stage(),
      "mgit-ui:unstage": () => this.unstage(),
      "mgit-ui:toggle-stage": () => this.toggleStage(),
      "mgit-ui:start-commit": () => this.startCommit(),
      "mgit-ui:commit": () => this.commit(),
      "mgit-ui:add-all-and-start-commit": () => this.addAllAndStartCommit(),
      "mgit-ui:reset": () => this.gitReset(),
      "mgit-ui:toggle-diff": () => this.toggleDiff(),
      "core:close": event => this.close(event),
      "core:save": event => this.save(event),
    })
  }

  observeEditors() {
    return atom.workspace.observeTextEditors(editor => {
      if (editor.isMini) return
      if (!repositoryHasFilePath(this.git.repo, editor.getPath())) return
      this.disposables.add(
        editor.onDidSave(async event => {
          if (this.preventAutoReresh) return
          await this.refreshStatus()
          if (this.diffEditor) {
            await this.refreshIfBasedOnEditor(editor)
          }
        })
      )
    })
  }

  needUpdateDiff() {
    return this.diffEditor || settings.get("autoDiff")
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
      this.diffEditor.destroy()
    } else {
      await this.diff()
    }
  }

  async diff() {
    const row = this.editor.getCursorBufferPosition().row
    const fileName = parseStatusTextLine(this.editor.lineTextForBufferRow(row)).fileName
    const fullPath = Path.join(this.git.repo.getWorkingDirectory(), fileName)
    if (!fs.isFileSync(fullPath) || !repositoryHasFilePath(this.git.repo, fullPath)) {
      return
    }
    if (!this.diffEditor) {
      this.diffEditor = new DiffEditor(this)
      this.diffEditor.onDidDestroy(() => {
        this.diffEditor = null
      })
    }
    this.diffEditor.renderForFile(fileName, this.phase === "commit")
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
    this.setPhase("commit")

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

  async commit() {
    if (hasCommitMessage(this.editor.getText())) {
      await this.editor.save()
      const commitFilePath = Path.join(this.git.repo.getPath(), "COMMIT_EDITMSG")
      await this.git.commit(commitFilePath)
      await this.refreshStatus()
      this.git.repo.refreshStatus() // To update git-gutter color
    }
  }

  parseStatusForRowRange(rowRange) {
    const [startRow, endRow] = rowRange
    const parsedLines = []
    for (let row = startRow; row <= endRow; row++) {
      parsedLines.push(parseStatusTextLine(this.editor.lineTextForBufferRow(row)))
    }

    const state = {staged: [], unstaged: [], untracked: []}
    for (const {fileName, staged, unstaged, untracked} of parsedLines) {
      if (staged) state.staged.push(fileName)
      if (unstaged) state.unstaged.push(fileName)
      if (untracked) state.untracked.push(fileName)
    }
    return state
  }

  async stage() {
    const rowRange = this.editor.getLastSelection().getBufferRowRange()
    const state = this.parseStatusForRowRange(rowRange)
    const files = [...state.untracked, ...state.unstaged]
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
    await this.git.add([...state.unstaged, ...state.untracked])
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
    this.setPhase("status")
    this.setModifiedState(false)
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
      this.originalIsModified = null
    }
  }

  destroy() {
    if (this.diffEditor) this.diffEditor.destroy()
    if (this.originalPane.isAlive()) this.originalPane.activate()
  }

  vmpActivateNormalMode() { atom.commands.dispatch(this.editor.element, "vim-mode-plus:activate-normal-mode") } // prettier-ignore
  vmpActivateInsertMode() { atom.commands.dispatch(this.editor.element, "vim-mode-plus:activate-insert-mode") } // prettier-ignore
  vmpIsInsertMode() { return this.vmpIsEnabled() && this.editor.element.classList.contains("insert-mode") } // prettier-ignore
  vmpIsNormalMode() { return this.vmpIsEnabled() && this.editor.element.classList.contains("normal-mode") } // prettier-ignore
  vmpIsEnabled() { return this.editor.element.classList.contains("vim-mode-plus") } // prettier-ignore
}
