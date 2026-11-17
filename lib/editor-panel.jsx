/** @jsx etch.dom */
const { CompositeDisposable } = require("lumine");
const etch = require("@lumine-code/etch");
const SettingsPanel = require("./settings-panel");

module.exports = class EditorPanel {
  constructor() {
    etch.initialize(this);
    this.subscriptions = new CompositeDisposable();
    this.subscriptions.add(lumine.scrollbars.bindNavigation(this.element));
  }

  destroy() {
    this.subscriptions.dispose();
    return etch.destroy(this);
  }

  update() {}

  render() {
    return (
      <div tabIndex="0" className="panels-item">
        <SettingsPanel namespace="editor" icon="code" />
      </div>
    );
  }

  focus() {
    this.element.focus();
  }

  show() {
    this.element.style.display = "";
  }
};
