const {Range} = require("atom")

function getRepositoryForFilePath(filePath) {
  if (filePath) {
    const index = atom.project.getDirectories().findIndex(dir => dir.contains(filePath))
    return atom.project.getRepositories()[index]
  }
}

function repositoryHasFilePath(repo, filePath) {
  return repo === getRepositoryForFilePath(filePath)
}

function findInEditor(editor, regex, direction, options, fn) {
  let found, scanRange

  if (direction === "forward") {
    functionName = "scanInBufferRange"
    scanRange = new Range(options.from, editor.getEofBufferPosition())
  } else {
    functionName = "backwardsScanInBufferRange"
    scanRange = new Range(options.from, [0, 0])
  }
  editor[functionName](regex, scanRange, event => {
    const value = fn(event)
    if (value) {
      found = value
      event.stop()
    }
  })
  return found
}

function setGrammarForEditor(editor, scopeName) {
  const grammar = atom.grammars.grammarForScopeName(scopeName)
  editor.setGrammar(grammar)
}

// private
function isCommentOrEmptyLine(lineText) {
  return /^\s*$/.test(lineText) || /^#.*$/.test(lineText)
}

// public
function hasCommitMessage(text) {
  return !text.split(/\r?\n/).every(isCommentOrEmptyLine)
}

module.exports = {
  getRepositoryForFilePath,
  repositoryHasFilePath,
  findInEditor,
  setGrammarForEditor,
  hasCommitMessage,
}
