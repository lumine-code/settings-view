const { CompositeDisposable, Disposable, TextEditor } = require("lumine");
const _ = require("@lumine-code/underscore-plus");
const CollapsibleSectionPanel = require("./collapsible-section-panel");
const PredefinedValuesEditor = require("./predefined-values-editor");
const { createSelectBox, forElement: selectBoxForElement } = require("./select-box");
const { getSettingDescription } = require("./rich-description");
const { getSettingTitle } = require("./rich-title");
const { scopeResolutionDetailsForKeyPath } = require("./scope-resolution");
const scopeContext = require("./scope-context");

module.exports = class SettingsPanel extends CollapsibleSectionPanel {
  constructor(options = {}) {
    super();
    this.element = document.createElement("section");
    this.element.classList.add("section", "settings-panel");
    this.options = options;
    this.disposables = new CompositeDisposable();
    this.renderDisposables = null;
    this.disposables.add(scopeContext.onDidChange(() => this.updateForScope()));
    this.reload();
  }

  reload() {
    this.renderDisposables?.dispose();
    this.renderDisposables = new CompositeDisposable();
    this.settingObservers = new Map();
    this.element.replaceChildren();

    const namespace = this.options.namespace;
    const schema = lumine.config.getSchema(namespace);
    const properties = schema?.properties || {};
    const selector = scopeContext.get();
    const settings = {};
    const baseSettings = getWithoutProjectOverride(namespace) || {};
    const names = new Set([...Object.keys(properties), ...Object.keys(baseSettings)]);
    for (const name of names) {
      const propertySchema = properties[name];
      if (propertySchema?.hidden) continue;
      const keyPath = `${namespace}.${name}`;
      if (selector) {
        const inspection = lumine.config.inspect(keyPath, { scopeSelector: selector });
        settings[name] = inspection.hasOverride
          ? inspection.overrideValue
          : valueForSelector(keyPath, selector);
      } else {
        settings[name] = getWithoutProjectOverride(keyPath);
      }
    }

    this.element.appendChild(this.elementForSettings(namespace, settings));
    this.scopeUpdateStates = new Map();
    try {
      this.renderDisposables.add(
        this.bindScopeSelector(),
        this.bindScopeOverrides(),
        this.bindInputFields(),
        this.bindSelectFields(),
        this.bindEditors(),
        this.bindTooltips(),
        this.bindSettingKeys(),
        this.handleEvents(),
      );
    } finally {
      this.scopeUpdateStates = null;
    }
  }

  destroy() {
    clearTimeout(this.copiedTimeout);
    this.flushPendingColorChange();
    this.renderDisposables?.dispose();
    this.disposables.dispose();
    this.element.remove();
  }

  updateForScope() {
    this.flushPendingColorChange();
    const selector = scopeContext.get();
    const selectorEditorElement = this.element.querySelector(".settings-scope-editor");
    const selectorEditor = PredefinedValuesEditor.forElement(selectorEditorElement);
    const selectorText = selector || "";
    if (selectorEditor && selectorEditor.getText() !== selectorText) {
      selectorEditor.setText(selectorText);
    }
    selectorEditor?.setInvalid(false);
    const scopeError = this.element.querySelector(".settings-scope-error");
    if (scopeError) scopeError.textContent = "";

    this.scopeUpdateStates = new Map();
    this.updatingScope = true;
    const stateFor = (keyPath) => this.getCurrentSettingState(keyPath);

    try {
      for (const toggle of this.element.querySelectorAll(".scope-override-toggle")) {
        const keyPath = toggle.dataset.settingKey;
        const state = stateFor(keyPath);
        const hasOverride = selector ? state.inspection.hasOverride : false;
        const controlGroup = toggle.closest(".control-group");
        const indicator = controlGroup.querySelector(":scope > .scope-resolution-indicator");
        toggle.hidden = !selector;
        indicator.hidden = Boolean(selector);
        toggle.checked = hasOverride;
        toggle.setAttribute(
          "aria-label",
          selector
            ? `Override ${keyPath} in ${selector}. ${toggle.dataset.resolutionLabel}.`
            : `Override ${keyPath}. ${toggle.dataset.resolutionLabel}.`,
        );
        this.updateScopeOverrideControls(controlGroup, !selector || hasOverride);
      }

      for (const warning of this.element.querySelectorAll(".setting-override-warning")) {
        warning.style.display = stateFor(warning.dataset.settingKey).hasProjectOverride
          ? "block"
          : "none";
      }

      for (const [keyPath, callbacks] of this.settingObservers) {
        const value = stateFor(keyPath).value;
        for (const callback of callbacks) callback(value);
      }
    } finally {
      this.updatingScope = false;
      this.scopeUpdateStates = null;
    }
  }

  getSettingState(name) {
    const selector = scopeContext.get();
    if (selector) {
      const inspection = lumine.config.inspect(name, { scopeSelector: selector });
      return {
        inspection,
        value: inspection.hasOverride ? inspection.overrideValue : valueForSelector(name, selector),
        defaultValue: inspection.variableByMatch ? inspection.baseValue : inspection.inheritedValue,
        isDefault: !inspection.hasOverride,
        hasProjectOverride: inspection.projectValue !== undefined,
      };
    }

    const defaultValue = getDefaultWithoutUserOverride(name);
    const userValue = lumine.config.get(name, {
      sources: [lumine.config.getUserConfigPath()],
    });
    return {
      inspection: null,
      value: getWithoutProjectOverride(name),
      defaultValue,
      isDefault: userValue == null || defaultValue === userValue,
      hasProjectOverride: settingHasProjectOverride(name),
    };
  }

  getCurrentSettingState(name) {
    if (!this.scopeUpdateStates) return this.getSettingState(name);
    let state = this.scopeUpdateStates.get(name);
    if (!state) {
      state = this.getSettingState(name);
      this.scopeUpdateStates.set(name, state);
    }
    return state;
  }

  updateOverrideMessage(name) {
    const hasOverride = this.getCurrentSettingState(name).hasProjectOverride;
    let message = this.element.querySelector(
      `div.setting-override-warning[data-setting-key="${name}"]`,
    );
    if (!message) return;
    message.style.display = hasOverride ? "block" : "none";
  }

  elementForSettings(namespace, settings) {
    if (_.isEmpty(settings)) {
      return document.createDocumentFragment();
    }

    let { title } = this.options;
    const includeTitle = this.options.includeTitle != null ? this.options.includeTitle : true;
    if (includeTitle) {
      if (title == null) {
        title = `${_.titleize(_.uncamelcase(namespace))} Settings`;
      }
    } else {
      if (title == null) {
        title = "Settings";
      }
    }

    const icon = this.options.icon != null ? this.options.icon : "gear";
    const sortedSettings = this.sortSettings(namespace, settings);

    const container = document.createElement("div");
    container.classList.add("section-container");

    const heading = document.createElement("div");
    heading.classList.add("block", "section-heading", "icon", `icon-${icon}`);
    heading.textContent = title;
    const headingRow = document.createElement("div");
    headingRow.classList.add("settings-heading-row");
    headingRow.appendChild(heading);
    headingRow.appendChild(this.scopeSelectorElement());
    container.appendChild(headingRow);

    const body = document.createElement("div");
    body.classList.add("section-body");
    for (const name of sortedSettings) {
      const keyPath = `${namespace}.${name}`;
      const selector = scopeContext.get();
      const inspection = selector
        ? lumine.config.inspect(keyPath, { scopeSelector: selector })
        : null;
      body.appendChild(
        elementForSetting(namespace, name, settings[name], { selector, inspection }),
      );
    }
    container.appendChild(body);

    return container;
  }

  sortSettings(namespace, settings) {
    return sortSettings(namespace, settings);
  }

  getKnownScopeSelectors() {
    const selectorsByIdentity = new Map();
    for (const selector of lumine.config.getScopeSelectors()) {
      selectorsByIdentity.set(lumine.config.validateScopeSelector(selector).join(","), selector);
    }
    for (const grammar of lumine.grammars.getGrammars()) {
      if (grammar?.scopeName) {
        const selector = `.${grammar.scopeName}`;
        selectorsByIdentity.set(lumine.config.validateScopeSelector(selector).join(","), selector);
      }
    }
    return [...new Set(selectorsByIdentity.values())].sort();
  }

  getScopePredefinedValues({ loading = false, selectors = null } = {}) {
    if (!loading && selectors == null) selectors = this.getKnownScopeSelectors();
    return [
      { value: "", label: "Default" },
      ...(loading
        ? []
        : selectors.map((selector) => ({
            value: selector,
            label: selector,
          }))),
    ];
  }

  scopeSelectorElement() {
    const wrapper = document.createElement("div");
    wrapper.classList.add("settings-scope-control");
    const current = scopeContext.get();
    const loading = !lumine.packages.hasActivatedInitialPackages();
    const selectors = loading ? [] : this.getKnownScopeSelectors();
    const selectorEditor = new PredefinedValuesEditor({
      text: current || "",
      placeholderText: "Default (*) or enter a selector",
      values: this.getScopePredefinedValues({ loading, selectors }),
      loading,
      loadingText: "Loading scopes…",
      ariaLabel: "Scope selector",
      buttonLabel: "Choose a recognized scope",
    });
    selectorEditor.scopeOptionsSignature = `${loading}:${selectors.join("\0")}`;
    selectorEditor.element.classList.add("settings-scope-editor");
    wrapper.appendChild(selectorEditor.element);

    const error = document.createElement("div");
    error.classList.add("text-error", "settings-scope-error");
    wrapper.appendChild(error);

    return wrapper;
  }

  bindScopeSelector() {
    const selectorEditorElement = this.element.querySelector(".settings-scope-editor");
    const error = this.element.querySelector(".settings-scope-error");
    const selectorEditor = PredefinedValuesEditor.forElement(selectorEditorElement);
    if (!selectorEditor || !error) {
      return new Disposable(() => {});
    }
    const commitInput = (text) => {
      const selector = text.trim();
      try {
        if (selector) lumine.config.validateScopeSelector(selector);
        error.textContent = "";
        selectorEditor.setInvalid(false);
        scopeContext.set(selector || null);
        if (selector === "*") selectorEditor.setText("");
      } catch (validationError) {
        error.textContent = validationError.message;
        selectorEditor.setInvalid(true);
      }
    };
    let refreshTimer = null;
    let selectorSignature = selectorEditor.scopeOptionsSignature;
    const refreshScopeOptions = () => {
      refreshTimer = null;
      const loading = !lumine.packages.hasActivatedInitialPackages();
      const selectors = loading ? [] : this.getKnownScopeSelectors();
      const nextSignature = `${loading}:${selectors.join("\0")}`;
      if (nextSignature === selectorSignature) return;
      selectorSignature = nextSignature;
      selectorEditor.setValues(this.getScopePredefinedValues({ loading, selectors }), { loading });
    };
    const scheduleScopeOptionsRefresh = () => {
      if (refreshTimer != null) clearTimeout(refreshTimer);
      refreshTimer = setTimeout(refreshScopeOptions, 100);
    };
    return new CompositeDisposable(
      selectorEditor.onDidCommit(commitInput),
      lumine.config.onDidChangeConfiguration(scheduleScopeOptionsRefresh),
      lumine.grammars.onDidAddGrammar(scheduleScopeOptionsRefresh),
      lumine.grammars.onDidUpdateGrammar(scheduleScopeOptionsRefresh),
      lumine.grammars.onDidRemoveGrammar(scheduleScopeOptionsRefresh),
      lumine.packages.onDidActivateInitialPackages(scheduleScopeOptionsRefresh),
      new Disposable(() => {
        if (refreshTimer != null) clearTimeout(refreshTimer);
      }),
      new Disposable(() => selectorEditor.destroy()),
    );
  }

  bindScopeOverrides() {
    const disposables = Array.from(this.element.querySelectorAll(".scope-override-toggle")).map(
      (toggle) => {
        const changed = () => {
          const keyPath = toggle.dataset.settingKey;
          const selector = scopeContext.get();
          if (!selector) return;
          const controlGroup = toggle.closest(".control-group");
          const inspection = lumine.config.inspect(keyPath, { scopeSelector: selector });
          if (toggle.checked) {
            const value = inspection.variableByMatch
              ? inspection.baseValue
              : inspection.inheritedValue;
            if (value === undefined) {
              toggle.checked = false;
              lumine.notifications.addWarning(`No inherited value for ${keyPath}`);
              return;
            }
            lumine.config.set(keyPath, value, { scopeSelector: selector });
          } else {
            lumine.config.unset(keyPath, { scopeSelector: selector });
          }
          const hasOverride = lumine.config.inspect(keyPath, {
            scopeSelector: selector,
          }).hasOverride;
          toggle.checked = hasOverride;
          this.updateScopeOverrideControls(controlGroup, hasOverride);
        };
        toggle.addEventListener("change", changed);
        return new Disposable(() => toggle.removeEventListener("change", changed));
      },
    );
    return new CompositeDisposable(...disposables);
  }

  updateScopeOverrideControls(controlGroup, hasOverride) {
    if (!controlGroup) return;
    controlGroup.classList.toggle("scope-inherited", !hasOverride);
    const controls = controlGroup.querySelector(":scope > .controls");
    if (!controls) return;
    for (const input of controls.querySelectorAll("input, select, button")) {
      input.disabled = !hasOverride;
      selectBoxForElement(input)?.setEnabled(hasOverride);
    }
    for (const editorElement of controls.querySelectorAll("lumine-text-editor")) {
      editorElement.getModel?.().setReadOnly?.(!hasOverride);
      editorElement.toggleAttribute("aria-disabled", !hasOverride);
      editorElement.classList.toggle("scope-inherited-control", !hasOverride);
      editorElement
        .closest(".editor-container")
        ?.classList.toggle("scope-inherited-editor-container", !hasOverride);
    }
  }

  bindInputFields() {
    const disposables = Array.from(this.element.querySelectorAll("input[id]")).map((input) => {
      let type = input.type;
      let name = type === "radio" ? input.name : input.id;

      this.observe(name, (value) => {
        this.updateOverrideMessage(name);
        if (type === "checkbox") {
          input.checked = value;
        } else if (type === "radio") {
          input.checked =
            value === this.parseValue(lumine.config.getSchema(name).type, input.value);
        } else {
          if (type === "color") {
            if (value && value.toHexString && value.toHexString()) {
              value = value.toHexString();
            }
          }

          input.value = value ?? "";
        }
      });

      const changeHandler = () => {
        let value = input.value;
        if (type === "checkbox") {
          value = input.checked;
        } else if (type === "radio") {
          value = this.parseValue(lumine.config.getSchema(name).type, value);
        } else {
          value = this.parseValue(type, value);
        }

        if (type === "color") {
          // This is debounced since the color wheel fires lots of events
          // as you are dragging it around
          this.flushPendingColorChange();
          const selector = scopeContext.get();
          this.pendingColorChange = () => this.setForSelector(name, value, selector);
          this.colorDebounceTimeout = setTimeout(() => this.flushPendingColorChange(), 100);
        } else {
          this.set(name, value);
        }
      };

      input.addEventListener("change", changeHandler);
      return new Disposable(() => input.removeEventListener("change", changeHandler));
    });

    return new CompositeDisposable(...disposables);
  }

  observe(name, callback) {
    const read = () => this.getCurrentSettingState(name).value;
    let callbacks = this.settingObservers.get(name);
    if (!callbacks) {
      callbacks = new Set();
      this.settingObservers.set(name, callbacks);
    }
    callbacks.add(callback);
    callback(read());
    this.renderDisposables.add(
      lumine.config.onDidChangeConfiguration((event) => {
        if (event.affectsConfiguration(name)) callback(read());
      }),
    );
  }

  isDefault(name) {
    return this.getCurrentSettingState(name).isDefault;
  }

  getDefault(name) {
    return this.getCurrentSettingState(name).defaultValue;
  }

  set(name, value) {
    return this.setForSelector(name, value, scopeContext.get());
  }

  setForSelector(name, value, selector) {
    if (selector) {
      if (value === undefined) {
        lumine.config.unset(name, { scopeSelector: selector });
        return true;
      } else {
        return lumine.config.set(name, value, { scopeSelector: selector });
      }
    } else {
      return lumine.config.set(name, value);
    }
  }

  flushPendingColorChange() {
    clearTimeout(this.colorDebounceTimeout);
    this.colorDebounceTimeout = null;
    const change = this.pendingColorChange;
    this.pendingColorChange = null;
    if (change) change();
  }

  setText(editor, name, type, value) {
    let stringValue;
    if (this.isDefault(name)) {
      stringValue = "";
    } else {
      stringValue = this.valueToString(value) || "";
    }

    if (
      stringValue === editor.getText() ||
      (!this.updatingScope && _.isEqual(value, this.parseValue(type, editor.getText())))
    ) {
      return;
    }

    editor.setText(stringValue, { bypassReadOnly: true });
    editor.moveToEndOfLine();
  }

  bindSelectFields() {
    const disposables = Array.from(this.element.querySelectorAll('[role="combobox"][id]')).map(
      (element) => {
        const select = selectBoxForElement(element);
        if (!select) return new Disposable(() => {});
        const name = element.id;
        this.observe(name, (value) => {
          select.setValue(value);
          element.removeAttribute("title");
          this.updateOverrideMessage(name);
        });
        return new CompositeDisposable(
          select.onDidChange(({ value }) => this.set(name, value)),
          new Disposable(() => select.destroy()),
        );
      },
    );

    return new CompositeDisposable(...disposables);
  }

  bindEditors() {
    const disposables = Array.from(
      this.element.querySelectorAll("lumine-text-editor:not(.predefined-values-editor-input)"),
    ).map((editorElement) => {
      let editor = editorElement.getModel();
      let name = editorElement.id;
      let type = editorElement.getAttribute("type");
      const subscriptions = new CompositeDisposable();

      const focusHandler = () => {
        if (editor.isReadOnly()) return;
        if (this.isDefault(name)) {
          editor.setText(this.valueToString(this.getDefault(name)) || "");
        }
      };
      editorElement.addEventListener("focus", focusHandler);
      subscriptions.add(
        new Disposable(() => editorElement.removeEventListener("focus", focusHandler)),
      );

      const blurHandler = () => {
        if (editor.isReadOnly()) return;
        if (this.isDefault(name)) {
          editor.setText("");
        }
      };
      editorElement.addEventListener("blur", blurHandler);
      subscriptions.add(
        new Disposable(() => editorElement.removeEventListener("blur", blurHandler)),
      );

      this.observe(name, (value) => {
        const defaultValue = this.defaultValueToString(this.getDefault(name));
        editor.setPlaceholderText(defaultValue == null ? "" : `Default: ${defaultValue}`);
        this.setText(editor, name, type, value);
        this.updateOverrideMessage(name);
      });

      subscriptions.add(
        editor.onDidStopChanging(() => {
          if (this.updatingScope || editor.isReadOnly()) return;
          const { minimum, maximum } = lumine.config.getSchema(name);
          const value = this.parseValue(type, editor.getText());
          if (minimum != null && value < minimum) {
            this.set(name, minimum);
            this.setText(editor, name, type, minimum);
          } else if (maximum != null && value > maximum) {
            this.set(name, maximum);
            this.setText(editor, name, type, maximum);
          } else if (!this.set(name, value)) {
            this.setText(editor, name, type, lumine.config.get(name));
          }
        }),
      );

      return subscriptions;
    });

    return new CompositeDisposable(...disposables);
  }

  // Clicking the greyed key path beside a setting copies it. The listener sits on
  // each span rather than on the panel so that `stopPropagation` beats the
  // collapse handler `CollapsibleSectionPanel` binds on `this.element`: an object
  // group renders its key inside the `.has-items` heading, and a bare click there
  // would fold the group away. `preventDefault` is for the checkbox and colour
  // forms, where the key sits inside the `<label>` and a click would otherwise
  // toggle the setting or open the colour picker.
  bindSettingKeys() {
    const disposables = Array.from(this.element.querySelectorAll(".setting-key")).map((keySpan) => {
      const clickHandler = (event) => {
        event.preventDefault();
        event.stopPropagation();
        lumine.clipboard.write(keySpan.textContent);
        this.showCopiedFeedback(keySpan);
      };

      keySpan.addEventListener("click", clickHandler);
      return new Disposable(() => keySpan.removeEventListener("click", clickHandler));
    });

    return new CompositeDisposable(...disposables);
  }

  showCopiedFeedback(keySpan) {
    clearTimeout(this.copiedTimeout);
    if (this.copiedElement) {
      this.copiedElement.classList.remove("copied");
    }

    this.copiedElement = keySpan;
    keySpan.classList.add("copied");
    this.copiedTimeout = setTimeout(() => {
      keySpan.classList.remove("copied");
      if (this.copiedElement === keySpan) this.copiedElement = null;
    }, 1200);
  }

  bindTooltips() {
    const defaultValueDisposables = Array.from(
      this.element.querySelectorAll('input[id], [role="combobox"][id], lumine-text-editor[id]'),
    ).map((element) => {
      const schema = lumine.config.getSchema(element.id);
      const defaultTitle = () => {
        let defaultValue = this.defaultValueToString(this.getDefault(element.id));
        if (schema?.enum && _.findWhere(schema.enum, { value: defaultValue })) {
          defaultValue = _.findWhere(schema.enum, { value: defaultValue }).description;
        }
        return defaultValue == null ? null : `Default: ${defaultValue}`;
      };
      // SelectBox uses the selected item's label as a native title. Remove it
      // before Tooltip reads it so the setting's default-value title wins.
      element.removeAttribute("title");
      return lumine.tooltips.add(element, {
        title: defaultTitle,
        delay: { show: 100 },
        placement: "auto left",
      });
    });

    const scopeResolutionDisposables = Array.from(
      this.element.querySelectorAll(
        ".scope-override-toggle[data-tooltip], .scope-resolution-indicator[data-tooltip]",
      ),
    ).map((element) =>
      lumine.tooltips.add(element, {
        title: element.dataset.tooltip,
        trigger: "hover focus",
      }),
    );

    return new CompositeDisposable(...defaultValueDisposables, ...scopeResolutionDisposables);
  }

  defaultValueToString(value) {
    return Array.isArray(value) && value.length === 0 ? "" : this.valueToString(value);
  }

  valueToString(value) {
    if (Array.isArray(value)) {
      if (value.length === 0) {
        return null;
      }
      return value.map((val) => val.toString().replace(/,/g, "\\,")).join(", ");
    } else if (value != null) {
      return value.toString();
    } else {
      return null;
    }
  }

  parseValue(type, value) {
    if (value === "") {
      return undefined;
    } else if (type === "number") {
      let floatValue = parseFloat(value);
      if (isNaN(floatValue)) {
        return value;
      } else {
        return floatValue;
      }
    } else if (type === "integer") {
      let intValue = parseInt(value);
      if (isNaN(intValue)) {
        return value;
      } else {
        return intValue;
      }
    } else if (type === "array") {
      let arrayValue = (value || "").split(",");
      arrayValue = arrayValue.reduce((values, val) => {
        const last = values.length - 1;
        if (last >= 0 && values[last].endsWith("\\")) {
          values[last] = values[last].replace(/\\$/, ",") + val;
        } else {
          values.push(val);
        }
        return values;
      }, []);
      return arrayValue.filter((val) => val).map((val) => val.trim());
    } else {
      return value;
    }
  }
};

/*
 * Space Pen Helpers
 */

// An array is editable when the comma-separated field can round-trip it:
// `valueToString` writes each item out with `toString`, and reading the field
// back produces strings that the schema's `items.type` coerces. Numbers survive
// that; booleans do not, since coercing the string "false" yields true.
let isEditableArray = function (array) {
  for (let item of array) {
    if (!_.isString(item) && !Number.isFinite(item)) {
      return false;
    }
  }
  return true;
};

function sortSettings(namespace, settings) {
  // Settings render in the order they are declared in the schema. An explicit
  // `order` field, when present, still takes precedence (installed packages rely
  // on it); settings without one fall back to their schema definition order
  // rather than being alphabetized.
  const parent = lumine.config.getSchema(namespace);
  const definitionOrder = parent && parent.properties ? Object.keys(parent.properties) : [];
  return _.chain(settings)
    .keys()
    .sortBy((name) => {
      const index = definitionOrder.indexOf(name);
      return index === -1 ? definitionOrder.length : index;
    })
    .sortBy((name) => {
      const schema = lumine.config.getSchema(`${namespace}.${name}`);
      return schema && schema.order != null ? schema.order : Infinity;
    })
    .value();
}

function scopesForSimpleSelector(selector) {
  if (typeof selector !== "string" || /[,:[\]#>+~]/.test(selector)) return null;
  const components = selector.trim().split(/\s+/);
  if (!components.every((component) => /^\.[A-Za-z0-9_.-]+$/.test(component))) return null;
  return components.map((component) => component.slice(1));
}

function valueForSelector(name, selector) {
  const scopes = scopesForSimpleSelector(selector);
  return scopes
    ? getWithoutProjectOverride(name, { scope: scopes })
    : getWithoutProjectOverride(name);
}

function getWithoutProjectOverride(name, options = {}) {
  if (lumine.config.projectFile) {
    options.excludeSources = [lumine.config.projectFile];
  }
  return lumine.config.get(name, options);
}

function getDefaultWithoutUserOverride(name) {
  return lumine.config.get(name, {
    excludeSources: [lumine.config.getUserConfigPath()],
  });
}

function getWithProjectOverride(name) {
  // Checking `lumine.config.projectSettings` lets us skip value coercion and
  // find out whether a given value is defined.
  return _.get(lumine.config.projectSettings, name.split("."));
}

function settingHasProjectOverride(name) {
  return typeof getWithProjectOverride(name) !== "undefined";
}

function addOverrideWarning(name, element) {
  let div = document.createElement("div");
  div.classList.add("text-warning", "setting-override-warning");
  div.textContent = `This global setting has been overridden by a project-specific setting. Changing it will affect your global config file, but may not have any effect in this window.`;
  div.dataset.settingKey = name;

  element.appendChild(div);
  return div;
}

function elementForSetting(namespace, name, value, context = {}) {
  const keyPath = `${namespace}.${name}`;
  const schema = lumine.config.getSchema(keyPath);
  if (schema?.hidden) return document.createDocumentFragment();
  const schemaType = schema?.type;
  const objectSetting =
    schemaType === "object" ||
    ((schemaType == null || schemaType === "any") && !Array.isArray(value) && _.isObject(value));
  if (objectSetting && _.keys(value).length === 0) return document.createDocumentFragment();
  let hasProjectOverride = context.inspection
    ? context.inspection.projectValue !== undefined
    : settingHasProjectOverride(keyPath);
  if (namespace === "core") {
    if (name === "themes") {
      return document.createDocumentFragment();
    } // Handled in the Themes panel
    if (name === "disabledPackages") {
      return document.createDocumentFragment();
    } // Handled in the Packages panel
    if (name === "customFileTypes") {
      return document.createDocumentFragment();
    }
    if (name === "uriHandlerRegistration") {
      return document.createDocumentFragment();
    } // Handled in the URI Handler panel
  }

  const controlGroup = document.createElement("div");
  controlGroup.classList.add("control-group");
  controlGroup.dataset.settingKey = keyPath;

  const controls = document.createElement("div");
  controls.classList.add("controls");
  controlGroup.appendChild(controls);

  let el = addOverrideWarning(keyPath, controlGroup);
  el.style.display = hasProjectOverride ? "block" : "none";

  const scopedLeaf = !objectSetting;
  if (scopedLeaf) {
    controlGroup.classList.add("scope-has-toggle");
    controlGroup.style.setProperty("--scope-indent", `${(context.depth || 0) * 20}px`);
    const toggle = document.createElement("input");
    toggle.type = "checkbox";
    toggle.classList.add("input-checkbox", "scope-override-toggle");
    const resolution = scopeResolutionDetailsForKeyPath(keyPath);
    const indicator = document.createElement("span");
    indicator.classList.add(
      "scope-resolution-indicator",
      `scope-resolution-${resolution.resolution}`,
    );
    indicator.dataset.settingKey = keyPath;
    indicator.dataset.tooltip = resolution.tooltip;
    indicator.hidden = Boolean(context.selector);
    indicator.setAttribute("role", "img");
    indicator.setAttribute("aria-label", resolution.tooltip);
    controlGroup.insertBefore(indicator, controls);

    toggle.classList.add(`scope-resolution-${resolution.resolution}`);
    toggle.dataset.settingKey = keyPath;
    toggle.dataset.tooltip = resolution.tooltip;
    toggle.dataset.resolutionLabel = resolution.label;
    toggle.hidden = !context.selector;
    toggle.checked = context.inspection?.hasOverride || false;
    toggle.setAttribute(
      "aria-label",
      context.selector
        ? `Override ${keyPath} in ${context.selector}. ${resolution.label}.`
        : `Override ${keyPath}. ${resolution.label}.`,
    );
    controlGroup.insertBefore(toggle, controls);
    if (context.selector && !context.inspection.hasOverride) {
      controlGroup.classList.add("scope-inherited");
    }
  }

  if (schema && schema.enum) {
    controls.appendChild(elementForOptions(namespace, name, value, { radio: schema.radio }));
  } else if (schema && schema.type === "color") {
    controls.appendChild(elementForColor(namespace, name, value));
  } else if (_.isBoolean(value) || (schema && schema.type === "boolean")) {
    controls.appendChild(elementForCheckbox(namespace, name, value));
  } else if (_.isArray(value) || (schema && schema.type === "array")) {
    if (isEditableArray(value)) {
      controls.appendChild(elementForArray(namespace, name, value));
    }
  } else if (objectSetting) {
    controls.appendChild(elementForObject(namespace, name, value, context));
  } else {
    controls.appendChild(elementForEditor(namespace, name, value));
  }

  if (scopedLeaf && context.selector && !context.inspection.hasOverride) {
    for (const input of controls.querySelectorAll("input, select, button")) {
      input.disabled = true;
      selectBoxForElement(input)?.setEnabled(false);
    }
    for (const editorElement of controls.querySelectorAll("lumine-text-editor")) {
      editorElement.getModel?.().setReadOnly?.(true);
      editorElement.setAttribute("aria-disabled", "true");
      editorElement.classList.add("scope-inherited-control");
      editorElement.closest(".editor-container")?.classList.add("scope-inherited-editor-container");
    }
  }

  return controlGroup;
}

function settingKeyElement(keyPath) {
  const keySpan = document.createElement("span");
  keySpan.classList.add("setting-key");
  keySpan.textContent = keyPath;
  keySpan.title = "Click to copy";
  return keySpan;
}

function settingTitleElement(keyPath, name) {
  const titleDiv = document.createElement("div");
  titleDiv.classList.add("setting-title");
  titleDiv.textContent = getSettingTitle(keyPath, name);
  titleDiv.appendChild(settingKeyElement(keyPath));
  return titleDiv;
}

function elementForOptions(namespace, name, value, { radio = false }) {
  let keyPath = `${namespace}.${name}`;
  let schema = lumine.config.getSchema(keyPath);
  let options = schema && schema.enum ? schema.enum : [];

  const fragment = document.createDocumentFragment();

  const label = document.createElement("label");
  label.classList.add("control-label");

  label.appendChild(settingTitleElement(keyPath, name));

  const descriptionDiv = document.createElement("div");
  descriptionDiv.classList.add("setting-description");
  descriptionDiv.innerHTML = getSettingDescription(keyPath);
  label.appendChild(descriptionDiv);

  fragment.appendChild(label);
  fragment.appendChild(enumOptions(options, { keyPath, radio }));

  return fragment;
}

function elementForCheckbox(namespace, name, value) {
  let keyPath = `${namespace}.${name}`;

  const div = document.createElement("div");
  div.classList.add("checkbox");

  const label = document.createElement("label");
  label.for = keyPath;

  const input = document.createElement("input");
  input.id = keyPath;
  input.type = "checkbox";
  input.classList.add("input-checkbox");
  input.checked = Boolean(value);
  label.appendChild(input);

  label.appendChild(settingTitleElement(keyPath, name));
  div.appendChild(label);

  const descriptionDiv = document.createElement("div");
  descriptionDiv.classList.add("setting-description");
  descriptionDiv.innerHTML = getSettingDescription(keyPath);
  div.appendChild(descriptionDiv);

  return div;
}

function elementForColor(namespace, name, _value) {
  let keyPath = `${namespace}.${name}`;

  const div = document.createElement("div");
  div.classList.add("color");

  const label = document.createElement("label");
  label.for = keyPath;

  const input = document.createElement("input");
  input.id = keyPath;
  input.type = "color";
  label.appendChild(input);

  label.appendChild(settingTitleElement(keyPath, name));
  div.appendChild(label);

  const descriptionDiv = document.createElement("div");
  descriptionDiv.classList.add("setting-description");
  descriptionDiv.innerHTML = getSettingDescription(keyPath);
  div.appendChild(descriptionDiv);

  return div;
}

function elementForEditor(namespace, name, value) {
  let keyPath = `${namespace}.${name}`;
  let type = _.isNumber(value) ? "number" : "string";

  const fragment = document.createDocumentFragment();

  const label = document.createElement("label");
  label.classList.add("control-label");

  label.appendChild(settingTitleElement(keyPath, name));

  const descriptionDiv = document.createElement("div");
  descriptionDiv.classList.add("setting-description");
  descriptionDiv.innerHTML = getSettingDescription(keyPath);
  label.appendChild(descriptionDiv);
  fragment.appendChild(label);

  const controls = document.createElement("div");
  controls.classList.add("controls");

  const editorContainer = document.createElement("div");
  editorContainer.classList.add("editor-container");

  const editor = new TextEditor({ mini: true });
  editor.element.id = keyPath;
  editor.element.setAttribute("type", type);
  editorContainer.appendChild(editor.element);
  controls.appendChild(editorContainer);
  fragment.appendChild(controls);

  return fragment;
}

function elementForArray(namespace, name, _value) {
  let keyPath = `${namespace}.${name}`;

  const fragment = document.createDocumentFragment();

  const label = document.createElement("label");
  label.classList.add("control-label");

  label.appendChild(settingTitleElement(keyPath, name));

  const descriptionDiv = document.createElement("div");
  descriptionDiv.classList.add("setting-description");
  descriptionDiv.innerHTML = getSettingDescription(keyPath);
  label.appendChild(descriptionDiv);
  fragment.appendChild(label);

  const controls = document.createElement("div");
  controls.classList.add("controls");

  const editorContainer = document.createElement("div");
  editorContainer.classList.add("editor-container");

  const editor = new TextEditor({ mini: true });
  editor.element.id = keyPath;
  editor.element.setAttribute("type", "array");
  editorContainer.appendChild(editor.element);
  controls.appendChild(editorContainer);
  fragment.appendChild(controls);

  return fragment;
}

function elementForObject(namespace, name, value, context) {
  if (_.keys(value).length === 0) {
    return document.createDocumentFragment();
  } else {
    let keyPath = `${namespace}.${name}`;
    let schema = lumine.config.getSchema(keyPath);
    let isCollapsed = schema.collapsed === true;

    const section = document.createElement("section");
    section.classList.add("sub-section");
    if (isCollapsed) {
      section.classList.add("collapsed");
    }

    const h3 = document.createElement("h3");
    h3.classList.add("sub-section-heading", "has-items");
    h3.textContent = getSettingTitle(keyPath, name);
    h3.appendChild(settingKeyElement(keyPath));
    section.appendChild(h3);

    const descriptionDiv = document.createElement("div");
    descriptionDiv.classList.add("setting-description");
    descriptionDiv.innerHTML = getSettingDescription(keyPath);
    section.appendChild(descriptionDiv);

    const div = document.createElement("div");
    div.classList.add("sub-section-body");
    for (const key of sortSettings(keyPath, value)) {
      const childName = `${name}.${key}`;
      const childKeyPath = `${namespace}.${childName}`;
      const childInspection = context.selector
        ? lumine.config.inspect(childKeyPath, { scopeSelector: context.selector })
        : null;
      div.appendChild(
        elementForSetting(namespace, childName, value[key], {
          selector: context.selector,
          inspection: childInspection,
          depth: (context.depth || 0) + 1,
        }),
      );
    }
    section.appendChild(div);

    return section;
  }
}

function enumOptions(options, { keyPath, radio }) {
  if (!radio) {
    return createSelectBox({
      id: keyPath,
      className: "form-control",
      ariaLabel: getSettingTitle(keyPath, keyPath.split(".").at(-1)),
      items: options.map(optionToSelect),
    }).element;
  }

  const container = document.createElement("fieldset");
  container.id = keyPath;
  container.classList.add("input-radio-group");
  for (const option of options) container.appendChild(optionToRadio(option, keyPath));
  return container;
}

function optionToRadio(option, keyPath) {
  const button = document.createElement("input");
  const label = document.createElement("label");
  label.classList.add("input-label");
  let value;
  let description;
  if (Object.hasOwn(option, "value")) {
    value = option.value;
    description = option.description;
  } else {
    value = option;
    description = option;
  }
  button.classList.add("input-radio");
  button.id = `${keyPath}[${value}]`;
  button.name = keyPath;
  button.type = "radio";
  button.value = value;
  label.appendChild(button);
  label.appendChild(document.createTextNode(description));
  return label;
}

function optionToSelect(option) {
  if (Object.hasOwn(option, "value")) {
    return { value: option.value, label: option.description };
  }
  return { value: option, label: option };
}
