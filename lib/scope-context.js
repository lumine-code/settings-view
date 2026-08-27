const { Emitter } = require("lumine");

class ScopeContext {
  constructor() {
    this.emitter = new Emitter();
    this.selector = null;
  }

  get() {
    return this.selector;
  }

  set(selector) {
    selector = selector || null;
    if (selector === this.selector) return;
    this.selector = selector;
    this.emitter.emit("did-change", selector);
  }

  onDidChange(callback) {
    return this.emitter.on("did-change", callback);
  }
}

module.exports = new ScopeContext();
