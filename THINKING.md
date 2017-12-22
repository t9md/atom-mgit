
# Cycle

dirty => clean

statusEditor is home of mgit operation, from where user can
  - open diff editor
  - start commit
  - git reset
  - jump to file under cursor

statusEditor is toggle-able(open/close), openable as dock item.

# controlBar
  - provide easy to use GUI for common but non-keymapped operation
  - reside at top of statusEditor

# StatusEditor
- Have section
  - controlBar
  - statusArea
    - git status -> statusText -> commentOut-ed -> parseStatusText -> render statusArea
