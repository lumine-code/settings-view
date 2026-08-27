/** @jsx etch.dom */
const { CompositeDisposable } = require("lumine");
const etch = require("@lumine-code/etch");
const focusWithHiddenContent = require("./focus-with-hidden-content");
const SettingsPanel = require("./settings-panel");

module.exports = class GeneralPanel {
  constructor() {
    etch.initialize(this);
    this.subscriptions = new CompositeDisposable();
    this.subscriptions.add(
      lumine.commands.add(this.element, {
        "core:move-up": () => {
          this.scrollUp();
        },
        "core:move-down": () => {
          this.scrollDown();
        },
        "core:page-up": () => {
          this.pageUp();
        },
        "core:page-down": () => {
          this.pageDown();
        },
        "core:move-to-top": () => {
          this.scrollToTop();
        },
        "core:move-to-bottom": () => {
          this.scrollToBottom();
        },
      }),
    );
  }

  destroy() {
    this.subscriptions.dispose();
    return etch.destroy(this);
  }

  update() {}

  render() {
    return (
      <div tabIndex="0" className="panels-item">
        <SettingsPanel ref="panel" namespace="core" icon="settings" />
      </div>
    );
  }

  focus() {
    focusWithHiddenContent(this.element, [this.element.querySelector(".settings-panel")]);
  }

  show() {
    this.element.style.display = "";
  }

  scrollUp() {
    this.element.scrollTop -= document.body.offsetHeight / 20;
  }

  scrollDown() {
    this.element.scrollTop += document.body.offsetHeight / 20;
  }

  pageUp() {
    this.element.scrollTop -= this.element.offsetHeight;
  }

  pageDown() {
    this.element.scrollTop += this.element.offsetHeight;
  }

  scrollToTop() {
    this.element.scrollTop = 0;
  }

  scrollToBottom() {
    this.element.scrollTop = this.element.scrollHeight;
  }
};
