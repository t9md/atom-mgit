const {Range} = require("atom")

function getRepositoryForEditor(editor) {
  const filePath = editor.getPath()
  if (filePath) {
    const index = atom.project.getDirectories().findIndex(dir => dir.contains(filePath))
    return atom.project.getRepositories()[index]
  }
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

module.exports = {
  getRepositoryForEditor,
  findInEditor,
  setGrammarForEditor,
}
