const {CompositeDisposable, TextEditor, Point, Emitter} = require("atom")
const Path = require("path")
const Git = require("./git")
const fs = require("fs-plus")

const {repositoryHasFilePath, setGrammarForEditor, hasCommitMessage} = require("./utils")
const settings = require("./settings")
const DiffEditor = require("./diff-editor")
const GitStatus = require("./git-status")

module.exports = class Ui {
  onDidDestroy(fn) { return this.emitter.on("did-destroy", fn) } // prettier-ignore
  emitDidDestroy() { this.emitter.emit("did-destroy") } // prettier-ignore

  constructor(repo) {
    this.emitter = new Emitter()

    this.originalPane = atom.workspace.getActivePane()
    this.git = new Git(repo)
    this.gitStatus = new GitStatus(this)

    this.editor = this.buildStatusEditor()
    this.editor.onDidDestroy(() => this.destroy())

    this.disposables = new CompositeDisposable()
    this.disposables.add(
      this.registerCommands(), //
      this.observeEditors(),
      this.observeCursorMove()
    )
    this.COMMIT_EDITMSG = Path.join(this.git.repo.getPath(), "COMMIT_EDITMSG")
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
      "mgit-ui:add-all": () => this.addAll(),
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
    await this.gitStatus.getStatusAndParse()
    this.gitStatus.render()
    this.setModifiedState(false)
    await atom.workspace.open(this.editor)
    this.editor.setCursorBufferPosition(Point.ZERO)
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
    const item = this.gitStatus.getItemForRow(this.editor.getCursorBufferPosition().row)
    if (!item) return

    const fullPath = Path.join(this.git.repo.getWorkingDirectory(), item.fileName)
    if (!repositoryHasFilePath(this.git.repo, fullPath)) {
      return
    }
    if (!this.diffEditor) {
      this.diffEditor = new DiffEditor(this)
      this.diffEditor.onDidDestroy(() => {
        this.diffEditor = null
      })
    }
    this.diffEditor.renderForFile(item.fileName)
  }

  writeMessage(message) {
    this.editor.setTextInBufferRange([[0, 3], [0, Infinity]], message)
  }

  async gitReset() {
    await this.git.reset()
    await this.refreshStatus()
  }

  async addAll() {
    await this.git.addAll()
    await this.refreshStatus()
  }

  getConfig(param) {
    return settings.get(param)
  }

  async startCommit(amend) {
    if (!this.getConfig("stageAllOnCommit") && !this.gitStatus.hasStagedItem()) {
      this.writeMessage("Stage some file first!")
      return
    }

    this.setModifiedState(true)
    this.unmockBufferIsModified()
    this.preventAutoReresh = true
    await this.editor.saveAs(this.COMMIT_EDITMSG)
    this.preventAutoReresh = false

    // const commitMessage = amend ? await this.git.getLastCommitInfo().message : ""
    this.editor.setTextInBufferRange([Point.ZERO, Point.ZERO], commitMessage + "\n")
    this.editor.setCursorBufferPosition(Point.ZERO)
    this.vmpActivateInsertMode()
  }

  async commit() {
    if (hasCommitMessage(this.editor.getText())) {
      await this.editor.save()

      if (this.getConfig("stageAllOnCommit") && !this.gitStatus.hasStagedItem()) {
        await this.git.addAll()
      }
      await this.git.commit(this.COMMIT_EDITMSG)
      await this.refreshStatus()
      this.git.repo.refreshStatus() // To update git-gutter color
    }
  }

  async stage() {
    const {untracked, unstaged} = this.gitStatus.getFilesByStateInSelected()
    const files = [...untracked, ...unstaged]
    if (files.length) {
      await this.git.add(files)
      await this.refreshStatus()
    }
  }

  async unstage() {
    const files = this.gitStatus.getFilesByStateInSelected().staged
    if (files.length) {
      await this.git.resetFiles(files)
      await this.refreshStatus()
    }
  }

  async toggleStage() {
    const {staged, unstaged, untracked} = this.gitStatus.getFilesByStateInSelected()
    await this.git.add([...unstaged, ...untracked])
    await this.git.resetFiles(staged)
    await this.refreshStatus()
  }

  async refreshStatus() {
    const cursorPosition = this.editor.getCursorBufferPosition()
    await this.gitStatus.getStatusAndParse()
    this.gitStatus.render()
    this.editor.setCursorBufferPosition(cursorPosition)
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
