const { CompositeDisposable } = require("lumine");

module.exports = class ListView {
  // * `list` a {List} object
  // * `container` a jQuery element
  // * `createView` a Function that returns a jQuery element / HTMLElement
  //   * `item` the item to create the view for
  constructor(list, container, createView) {
    this.list = list;
    this.container = container;
    this.createView = createView;
    this.views = [];
    this.viewMap = {};
    this.rows = new Map();
    this.subscriptions = new CompositeDisposable(
      this.list.onDidAddItem((item) => this.addView(item)),
      this.list.onDidRemoveItem((item) => this.removeView(item)),
    );
    this.addViews();
  }

  getViews() {
    return this.views;
  }

  filterViews(filterFn) {
    return this.list.filterItems(filterFn).map((item) => this.viewMap[this.list.keyForItem(item)]);
  }

  addViews() {
    for (const item of this.list.getItems()) {
      this.addView(item);
    }
  }

  addView(item) {
    if (this.destroyed) return;
    const view = this.createView(item);
    if (this.destroyed) {
      view.destroy();
      return;
    }
    this.views.push(view);
    this.viewMap[this.list.keyForItem(item)] = view;

    const row = document.createElement("div");
    row.classList.add("row");
    row.appendChild(view.element);
    this.rows.set(view, row);
    this.container.insertBefore(row, this.container.children[0]);
  }

  removeView(item) {
    if (this.destroyed) return;
    const key = this.list.keyForItem(item);
    const view = this.viewMap[key];
    if (view) {
      const index = this.views.indexOf(view);
      if (index > -1) this.views.splice(index, 1);
      delete this.viewMap[key];
      this.rows.get(view)?.remove();
      this.rows.delete(view);
      view.destroy();
    }
  }

  destroy() {
    if (this.destroyed) return;
    this.destroyed = true;
    this.subscriptions.dispose();
    const views = this.views.splice(0);
    this.viewMap = {};
    const rows = [...this.rows.values()];
    this.rows.clear();
    for (const row of rows) row.remove();
    for (const view of views) view.destroy();
  }
};
