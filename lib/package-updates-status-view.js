const { CompositeDisposable, Disposable } = require("lumine");

module.exports = class PackageUpdatesStatusView {
  constructor(statusBar, packageManager) {
    this.statusBar = statusBar;
    this.packageManager = packageManager;
    this.disposables = new CompositeDisposable();

    this.element = document.createElement("status-bar-tile");
    this.element.classList.add("package-updates-status", "icon", "icon-squirrel");
    this.element.setAttribute("role", "button");

    this.countElement = document.createElement("span");
    this.element.appendChild(this.countElement);

    this.disposables.add(
      this.packageManager.onDidChangeAvailableUpdates((updates) => this.update(updates)),
      lumine.tooltips.add(this.element, { title: () => this.tooltipTitle() }),
    );

    const clickHandler = () => lumine.workspace.open("lumine://config/update");
    this.element.addEventListener("click", clickHandler);
    this.disposables.add(
      new Disposable(() => this.element.removeEventListener("click", clickHandler)),
    );

    this.update(this.packageManager.getAvailableUpdates());
  }

  update(updates) {
    this.count = Array.isArray(updates) ? updates.length : 0;
    this.countElement.textContent = String(this.count);
    this.element.style.display = this.count > 0 ? "" : "none";
    this.element.setAttribute("aria-label", this.tooltipTitle());
  }

  tooltipTitle() {
    return this.count === 1
      ? "1 package update available"
      : `${this.count} package updates available`;
  }

  attach() {
    if (this.tile) return;
    // The settings gear uses 110. Right-side tiles are ordered from the
    // highest priority on the left to the lowest at the outer (right) edge, so
    // 111 places this indicator immediately to the gear's left.
    this.tile = this.statusBar.addRightTile({
      item: this,
      priority: 111,
    });
  }

  destroy() {
    this.disposables.dispose();
    this.element.remove();
    if (this.tile) {
      this.tile.destroy();
      this.tile = null;
    }
  }
};
