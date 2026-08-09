/** @jsx etch.dom */
const { CompositeDisposable, Disposable } = require("lumine");
const etch = require("@lumine-code/etch");
const { STATUS_DOT_TYPES } = require("./status-dots");

// Renders a package badge as a small colored dot. The badge title and text are
// shown in a hover tooltip, and clicking a badge that carries a link opens it
// in the browser.
module.exports = class BadgeView {
  constructor(badge) {
    this.badge = badge;
    this.disposables = new CompositeDisposable();

    etch.initialize(this);

    const tooltip = this.tooltipText();
    if (tooltip) {
      this.disposables.add(lumine.tooltips.add(this.element, { title: tooltip }));
    }

    if (this.hasLink()) {
      const clickHandler = (event) => {
        event.stopPropagation();
        event.preventDefault();
        lumine.shell.openExternal(this.badge.link);
      };
      this.element.addEventListener("click", clickHandler);
      this.disposables.add(
        new Disposable(() => this.element.removeEventListener("click", clickHandler)),
      );
    }
  }

  destroy() {
    this.disposables.dispose();
    return etch.destroy(this);
  }

  update() {}

  render() {
    const classes = `package-badge-dot ${this.dotClass()}${this.hasLink() ? " has-link" : ""}`;
    return <span className={classes} />;
  }

  tooltipText() {
    return [this.badge.title, this.badge.text]
      .filter((part) => typeof part === "string")
      .join(": ");
  }

  hasLink() {
    return typeof this.badge.link === "string";
  }

  // See `status-dots.js` for what each type means and what colour it carries.
  dotClass() {
    return STATUS_DOT_TYPES.has(this.badge.type)
      ? `badge-dot-${this.badge.type}`
      : "badge-dot-default";
  }
};
