const {Range} = require("atom")

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

module.exports = {
  findInEditor,
}
