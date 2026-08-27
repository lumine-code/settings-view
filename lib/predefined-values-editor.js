const { CompositeDisposable, Disposable, Emitter, TextEditor } = require("lumine");

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

    this.button = document.createElement("button");
    this.button.type = "button";
    this.button.classList.add("icon", "icon-chevron-down", "predefined-values-editor-button");
    this.button.title = buttonLabel;
    this.button.setAttribute("aria-label", buttonLabel);
    this.button.setAttribute("aria-haspopup", "listbox");
    this.element.appendChild(this.button);

    this.select = document.createElement("select");
    this.select.classList.add("form-control", "predefined-values-editor-select");
    this.select.tabIndex = -1;
    this.select.setAttribute("aria-label", buttonLabel);
    this.element.appendChild(this.select);
    this.setValues(values, { loading });

    const buttonClicked = () => this.openPicker();
    const selectChanged = () => {
      const value = this.values[Number(this.select.selectedOptions[0]?.dataset.valueIndex)];
      if (!value) return;
      this.setText(value.value);
      this.focus();
      this.emitter.emit("did-commit", this.getText());
    };
    const focusOut = (event) => {
      if (!this.element.contains(event.relatedTarget)) {
        this.emitter.emit("did-commit", this.getText());
      }
    };

    this.button.addEventListener("click", buttonClicked);
    this.select.addEventListener("change", selectChanged);
    this.element.addEventListener("focusout", focusOut);
    this.disposables.add(
      lumine.commands.add(this.editor.element, {
        "core:confirm": () => this.emitter.emit("did-commit", this.getText()),
        "core:move-down": () => this.openPicker(),
      }),
      new Disposable(() => this.button.removeEventListener("click", buttonClicked)),
      new Disposable(() => this.select.removeEventListener("change", selectChanged)),
      new Disposable(() => this.element.removeEventListener("focusout", focusOut)),
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
    this.values = values.map((value) =>
      typeof value === "string"
        ? { value, label: value }
        : { value: String(value.value ?? ""), label: value.label ?? String(value.value ?? "") },
    );
    this.select.replaceChildren();
    const current = this.getText().trim();
    for (const [index, value] of this.values.entries()) {
      const option = document.createElement("option");
      option.dataset.valueIndex = index;
      option.textContent = value.label;
      option.selected = current === value.value;
      this.select.appendChild(option);
    }
    if (loading) {
      const loadingElement = document.createElement("option");
      loadingElement.textContent = this.loadingText;
      loadingElement.disabled = true;
      this.select.appendChild(loadingElement);
    }
    this.select.selectedIndex = this.values.findIndex((value) => current === value.value);
  }

  openPicker() {
    this.syncSelection();
    try {
      this.select.showPicker();
    } catch {
      this.select.click();
    }
  }

  syncSelection() {
    if (!this.select || !this.values) return;
    const current = this.getText().trim();
    this.select.selectedIndex = this.values.findIndex((value) => current === value.value);
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
