/** @babel */
/** @jsx etch.dom */
const etch = require("@lumine-code/etch");

const controllersByElement = new WeakMap();

function createSelectBox(options = {}) {
  const classNames = String(options.className ?? "")
    .split(/\s+/)
    .filter(Boolean);
  const controller = lumine.menu.createSelectBox({
    ...options,
    matchTriggerFontSize: options.matchTriggerFontSize ?? classNames.includes("form-control"),
  });
  controllersByElement.set(controller.element, controller);
  return controller;
}

function forElement(element) {
  return controllersByElement.get(element) || null;
}

class SelectBox {
  constructor(props) {
    this.props = props;
    this.controller = createSelectBox({
      ...this.optionsFor(props),
      onWillOpen: () => this.props.onWillOpen?.(this),
    });
    this.changeSubscription = this.controller.onDidChange((event) => {
      this.props.onDidChange?.(event);
    });
    this.clickHandler = (event) => this.props.onClick?.(event);
    this.controller.element.addEventListener("click", this.clickHandler);
    etch.initialize(this);
    this.element.appendChild(this.controller.element);
  }

  optionsFor(props) {
    return {
      items: props.items,
      value: props.value,
      disabled: props.disabled,
      ariaLabel: props.ariaLabel,
      className: props.className,
      id: props.id,
      placeholder: props.placeholder,
      popupAnchor: props.popupAnchor,
      matchTriggerFontSize: props.matchTriggerFontSize,
    };
  }

  update(props) {
    this.props = props;
    this.controller.setItems(props.items || [], { value: props.value });
    if (props.value !== undefined) this.controller.setValue(props.value);
    this.controller.setEnabled(props.disabled !== true);
    if (props.ariaLabel) this.controller.setAriaLabel(props.ariaLabel);
    return Promise.resolve();
  }

  get value() {
    return this.controller.value;
  }

  get items() {
    return this.controller.items;
  }

  get textContent() {
    return this.controller.element.textContent;
  }

  set value(value) {
    this.controller.setValue(value);
  }

  get classList() {
    return this.controller.element.classList;
  }

  get disabled() {
    return this.controller.element.disabled;
  }

  set disabled(disabled) {
    this.controller.setEnabled(!disabled);
  }

  setItems(items, options) {
    this.controller.setItems(items, options);
  }

  setValue(value, options) {
    return this.controller.setValue(value, options);
  }

  setEnabled(enabled) {
    this.controller.setEnabled(enabled);
  }

  open() {
    return this.controller.open();
  }

  close() {
    return this.controller.close();
  }

  focus() {
    this.controller.focus();
  }

  render() {
    return <span style={{ display: "contents" }} />;
  }

  destroy() {
    this.changeSubscription.dispose();
    this.controller.element.removeEventListener("click", this.clickHandler);
    this.controller.destroy();
    return etch.destroy(this);
  }
}

module.exports = { SelectBox, createSelectBox, forElement };
