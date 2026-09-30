const { Emitter } = require("lumine");

class ScopeContext {
  constructor() {
    this.emitter = new Emitter();
    this.selector = null;
    this.target = "global";
  }

  get() {
    return this.selector;
  }

  set(selector) {
    if (typeof selector === "string") selector = selector.trim();
    if (selector === "*") selector = null;
    selector = selector || null;
    if (selector === this.selector) return;
    this.selector = selector;
    this.emitter.emit("did-change", selector);
  }

  onDidChange(callback) {
    return this.emitter.on("did-change", callback);
  }

  getTarget() {
    return this.target;
  }

  setTarget(target) {
    if (target !== "global" && target !== "window") {
      throw new TypeError("Settings target must be 'global' or 'window'");
    }
    if (target === this.target) return;
    this.target = target;
    this.emitter.emit("did-change-target", target);
  }

  onDidChangeTarget(callback) {
    return this.emitter.on("did-change-target", callback);
  }
}

module.exports = new ScopeContext();
