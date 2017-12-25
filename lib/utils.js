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

function findInEditor(editor, direction, regex, options, fn) {
  let found
  let {scanRange, from} = options

  if (direction === "forward") {
    functionName = "scanInBufferRange"
    if (!scanRange) scanRange = new Range(options.from, editor.getEofBufferPosition())
  } else {
    functionName = "backwardsScanInBufferRange"
    if (!scanRange) scanRange = new Range(options.from, [0, 0])
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

function getBufferRangeForRowRange(editor, [startRow, endRow]) {
  return new Range([startRow, 0], [startRow, 0]).union(editor.bufferRangeForBufferRow(endRow, {includeNewline: true}))
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
  getBufferRangeForRowRange,
  setGrammarForEditor,
  hasCommitMessage,
}
