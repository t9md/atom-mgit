const _ = require("underscore-plus")

const COMMENT_TEXT = "# "
const STATUS_PART_LENGTH = 3

function removeEndingNewLine(text) {
  return text.replace(/\r?\n$/, "")
}

function parseLine(text) {
  return {
    rawText: text,
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
      return this.stage + this.workTree === "??"
    },
  }
}

module.exports = class GitStatus {
  constructor(ui) {
    this.ui = ui
    this.items = []
  }

  get editor() { return this.ui.editor } // prettier-ignore
  get git() { return this.ui.git } // prettier-ignore

  render() {
    const header = this.isEmpty() ? "Clean" : "Dirty"
    this.editor.setText(`## ${header}\n`)
    this.renderFromRow(1)
  }

  renderFromRow(row) {
    const range = [[row, 0], [Infinity, Infinity]]
    const texts = this.items.map(parsedLine => COMMENT_TEXT + parsedLine.rawText)
    this.editor.setTextInBufferRange(range, texts.join("\n"))
    if (this.itemStartMarker) {
      this.itemStartMarker.destroy()
    }
    this.itemStartMarker = this.editor.markBufferPosition([row, 0], {invalidate: "never"})
  }

  isEmpty() {
    return this.items.length === 0
  }

  hasStagedItem() {
    return this.items.some(item => item.staged)
  }

  async getStatusAndParse() {
    const output = removeEndingNewLine(await this.git.status())
    if (!output) {
      this.items = []
    } else {
      let items = output.split(/\r?\n/).map(parseLine)
      if (!this.isEmpty()) {
        // keep original order if there are existing items
        items = _.sortBy(items, ({fileName}) => this.items.findIndex(item => item.fileName === fileName))
      }
      this.items = items
    }
  }

  getItemStartRow() {
    return this.itemStartMarker.getBufferRange().start.row
  }

  getItemForRow(row) {
    const index = row - this.getItemStartRow()
    return this.items[index]
  }

  getItemsInRowRange(rowRange) {
    const [startRow, endRow] = rowRange
    const items = []
    for (let row = startRow; row <= endRow; row++) {
      const item = this.getItemForRow(row)
      if (item) items.push(item)
    }
    return items
  }

  getFilesByStateInSelected() {
    const filesByState = {staged: [], unstaged: [], untracked: []}

    const rowRange = this.editor.getLastSelection().getBufferRowRange()
    for (const {staged, unstaged, untracked, fileName} of this.getItemsInRowRange(rowRange)) {
      if (staged) filesByState.staged.push(fileName)
      if (unstaged) filesByState.unstaged.push(fileName)
      if (untracked) filesByState.untracked.push(fileName)
    }
    return filesByState
  }

  destroy() {}
}
