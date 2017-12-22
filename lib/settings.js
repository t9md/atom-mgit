const {Disposable} = require("atom")

function inferType(value) {
  if (Number.isInteger(value)) return "integer"
  if (Array.isArray(value)) return "array"
  if (typeof value === "boolean") return "boolean"
  if (typeof value === "string") return "string"
}

class Settings {
  constructor(scope, config) {
    // complement `type` field by inferring it from default value.
    // Also translate direct `boolean` value to {default: `boolean`} object
    this.scope = scope
    this.config = config

    const configNames = Object.keys(this.config)
    for (let i = 0; i < configNames.length; i++) {
      const name = configNames[i]
      let value = this.config[name]

      // Translate direct boolean to { defaultr: boolean } form
      if (typeof value === "boolean") {
        this.config[name] = value = {default: value}
      }

      if (!value.type) value.type = inferType(value.default)

      // Inject order to appear at setting-view in ordered.
      value.order = i
    }
  }

  delete(param) {
    return atom.config.unset(`${this.scope}.${param}`)
  }

  get(param) {
    return atom.config.get(`${this.scope}.${param}`)
  }

  set(param, value) {
    return atom.config.set(`${this.scope}.${param}`, value)
  }

  toggle(param) {
    return this.set(param, !this.get(param))
  }

  observe(param, fn) {
    return atom.config.observe(`${this.scope}.${param}`, fn)
  }

  onDidChange(param, fn) {
    return atom.config.onDidChange(`${this.scope}.${param}`, fn)
  }
}

module.exports = new Settings("mgit", {
  openLocation: {
    enum: ["left", "right", "bottom", "center"],
    default: "bottom",
  },
  stageAllOnCommit: {
    default: true,
    description: "Automatically stage all stagable(tracked and untracked) before commit only when no files are staged",
  },
  autoDiff: {
    default: true,
    description: "Automatically show diff while moving on git-status view",
  },
})
