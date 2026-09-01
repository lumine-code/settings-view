const { CompositeDisposable, Disposable, Emitter, TextEditor } = require("lumine");
const { createSelectBox } = require("./select-box");

const instancesByElement = new WeakMap();

module.exports = class PredefinedValuesEditor {
  static forElement(element) {
    return instancesByElement.get(element) || null;
  }

  constructor({
    text = "",
    placeholderText = "",
    values = [],
    loading = false,
    loadingText = "Loading values…",
    ariaLabel = "Value",
    buttonLabel = "Choose a predefined value",
  } = {}) {
    this.emitter = new Emitter();
    this.disposables = new CompositeDisposable();
    this.loadingText = loadingText;

    this.element = document.createElement("div");
    this.element.classList.add("predefined-values-editor");
    instancesByElement.set(this.element, this);

    this.editor = new TextEditor({ mini: true });
    this.editor.setPlaceholderText(placeholderText);
    this.editor.setText(text);
    this.editor.element.classList.add("predefined-values-editor-input");
    this.editor.element.setAttribute("aria-label", ariaLabel);
    this.element.appendChild(this.editor.element);

    this.select = createSelectBox({
      items: [],
      ariaLabel: buttonLabel,
      popupAnchor: this.element,
      className: "icon icon-chevron-down predefined-values-editor-button",
    });
    this.button = this.select.element;
    this.button.title = buttonLabel;
    this.element.appendChild(this.button);
    this.setValues(values, { loading });

    const selectChanged = ({ item }) => {
      const value = item?.source;
      if (!value) return;
      this.setText(value.value);
      this.focus();
      this.emitter.emit("did-commit", this.getText());
    };
    const focusOut = (event) => {
      if (this.element.contains(event.relatedTarget)) return;
      queueMicrotask(() => {
        if (
          !this.element.contains(document.activeElement) &&
          this.button.getAttribute("aria-expanded") !== "true"
        ) {
          this.emitter.emit("did-commit", this.getText());
        }
      });
    };

    this.element.addEventListener("focusout", focusOut);
    this.disposables.add(
      lumine.commands.add(this.editor.element, {
        "core:confirm": () => this.emitter.emit("did-commit", this.getText()),
        "core:move-down": () => this.openPicker(),
      }),
      this.select.onDidChange(selectChanged),
      new Disposable(() => this.element.removeEventListener("focusout", focusOut)),
      new Disposable(() => this.select.destroy()),
    );
  }

  onDidCommit(callback) {
    return this.emitter.on("did-commit", callback);
  }

  getText() {
    return this.editor.getText();
  }

  setText(text) {
    this.editor.setText(String(text ?? ""));
    this.syncSelection();
  }

  setInvalid(invalid) {
    this.editor.element.toggleAttribute("aria-invalid", invalid);
  }

  setValues(values, { loading = false } = {}) {
    this.loading = loading;
    this.values = values.map((value) =>
      typeof value === "string"
        ? { value, label: value }
        : { value: String(value.value ?? ""), label: value.label ?? String(value.value ?? "") },
    );
    const current = this.getText().trim();
    this.select.setItems(this.itemsForCurrent(current), { value: current });
  }

  itemsForCurrent(current) {
    const items = this.values.map((value) => ({
      value: value.value,
      label: value.label,
      source: value,
    }));
    if (current && !this.values.some((value) => value.value === current)) {
      items.unshift({ value: current, label: current, disabled: true });
    }
    if (this.loading) {
      items.push({ value: Symbol("loading"), label: this.loadingText, disabled: true });
    }
    return items;
  }

  openPicker() {
    this.syncSelection();
    return this.select.open();
  }

  syncSelection() {
    if (!this.select || !this.values) return;
    const current = this.getText().trim();
    this.select.setItems(this.itemsForCurrent(current), { value: current });
  }

  focus() {
    this.editor.element.focus();
  }

  destroy() {
    instancesByElement.delete(this.element);
    this.disposables.dispose();
    this.editor.destroy();
    this.emitter.dispose();
    this.element.remove();
  }
};
