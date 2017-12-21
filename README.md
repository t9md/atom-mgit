# atom-mgit

:warning: **Alpha status**: Might introduce breaking changes until I set this stable(or remove this warning).

minimum git wrapper for me(t9md).

## Setup

1. install
2. set your own keymap in your `keymap.cson`

## How to use

Assume you set example keymap displayed in next section.

1. `mgit:status` by `space g s`
2. Prepare index by using one of `toggle-stage`(`-`), `stage`(`<`), `unstage`(`>`)
  - You can check `diff` by `D`.
3. Start commit by `C`, your cursor is placed at first line of status buffer
4. Author commit msg and save then close buffer by `q`
  - if commit msg has non-commented line, commit is executed.

## Keymap example

keymap.cson

```coffeescript
'atom-text-editor.vim-mode-plus.normal-mode':
  'space g s': 'mgit:status'

'atom-text-editor.vim-mode-plus.normal-mode.mgit, atom-text-editor.vim-mode-plus.visual-mode.mgit':
  'q': 'core:close'

'atom-text-editor.vim-mode-plus.normal-mode.mgit-status, atom-text-editor.vim-mode-plus.visual-mode.mgit-status':
  '-': 'mgit-ui:toggle-stage'
  '<': 'mgit-ui:stage'
  '>': 'mgit-ui:unstage'
  'C': 'mgit-ui:start-commit'
  'D': 'mgit-ui:toggle-diff'
```

## TODO

- [x] auto-refresh status/diff
- [ ] jump to real file from diff view
- [ ] `commit -am`? OR `add .` then `commit -m`
- [ ] Detect git status change outside of Atom.app
- [ ] `diff --cached`
- [ ] highlight diff by textDecoration(not by grammar)
- [ ] move next/prev hunk by keyboard on `diff` view
- [ ] introduce control-bar for easy to complement memory
- [ ] new branch, checkout file, checkout branch
- [ ] `commit --ammend`, `commit --ammend -no-edit`
