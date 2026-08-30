/** @jsx etch.dom */
const { CompositeDisposable, Disposable, TextEditor } = require("lumine");
const etch = require("@lumine-code/etch");
const _ = require("@lumine-code/underscore-plus");
const path = require("path");
const focusWithHiddenContent = require("./focus-with-hidden-content");

module.exports = class KeybindingsPanel {
  static synchronousRenderLimit() {
    return 100;
  }

  static renderBatchSize() {
    return 50;
  }

  constructor() {
    this.activeSourceFilter = "all";
    this.copyFeedbackTimeouts = new Set();
    this.pendingKeyBindingRender = null;
    this.pendingKeyBindingRenderCallback = null;
    this.pendingKeyBindingRenderWindow = null;
    this.resumeKeyBindingRender = null;
    etch.initialize(this);

    this.refs.searchEditor.element.setAttribute("aria-label", "Search keybindings");
    this.refs.clearSearchButton.setAttribute("aria-label", "Clear keybindings search");
    this.refs.sourceFilters.setAttribute("role", "group");
    this.refs.sourceFilters.setAttribute("aria-label", "Filter keybindings by source");
    this.refs.resultStatus.setAttribute("role", "status");
    this.refs.resultStatus.setAttribute("aria-live", "polite");
    this.sourceFilterButtons = {
      all: this.refs.allSourceFilter,
      user: this.refs.userSourceFilter,
      core: this.refs.coreSourceFilter,
      packages: this.refs.packagesSourceFilter,
    };
    for (const [filter, button] of Object.entries(this.sourceFilterButtons)) {
      button.dataset.sourceFilter = filter;
    }
    this.updateSourceFilterButtons();

    this.disposables = new CompositeDisposable();
    this.disposables.add(this.handlePanelEvents());
    this.disposables.add(
      lumine.commands.add(this.element, {
        "core:move-up": () => this.scrollUp(),
        "core:move-down": () => this.scrollDown(),
        "core:page-up": () => this.pageUp(),
        "core:page-down": () => this.pageDown(),
        "core:move-to-top": () => this.scrollToTop(),
        "core:move-to-bottom": () => this.scrollToBottom(),
        "core:cancel": () => this.clearSearch(),
      }),
    );

    this.otherPlatformPattern = new RegExp(
      `\\.platform-(?!${_.escapeRegExp(process.platform)}\\b)`,
    );
    this.platformPattern = new RegExp(`\\.platform-${_.escapeRegExp(process.platform)}\\b`);

    this.disposables.add(
      this.refs.searchEditor.onDidStopChanging(() => this.filterKeyBindings()),
      lumine.keymaps.onDidReloadKeymap(() => this.loadKeyBindings()),
      lumine.keymaps.onDidUnloadKeymap(() => this.loadKeyBindings()),
    );
    this.loadKeyBindings();
  }

  destroy() {
    this.cancelPendingKeyBindingRender();
    for (const timeout of this.copyFeedbackTimeouts) clearTimeout(timeout);
    this.copyFeedbackTimeouts.clear();
    this.disposables.dispose();
    return etch.destroy(this);
  }

  update() {}

  render() {
    return (
      <div className="panels-item" tabIndex="-1">
        <section className="keybinding-panel section">
          <div className="keybindings-heading-row">
            <div className="section-heading icon icon-keyboard">Keybindings</div>
            <div className="keybindings-actions">
              <button
                ref="openKeymapButton"
                type="button"
                className="btn btn-default icon icon-file-code"
              >
                Open Keymap
              </button>
              <button
                ref="resolverButton"
                type="button"
                className="btn btn-default icon icon-pulse"
              >
                Keybinding Resolver
              </button>
            </div>
          </div>

          <p className="text text-subtle keybindings-help">
            Search registered shortcuts, copy an override, or inspect context-dependent resolution.
          </p>

          <div className="keybindings-search-row">
            <div className="editor-container">
              <TextEditor
                mini
                ref="searchEditor"
                placeholderText="Search shortcuts, commands, contexts, or sources"
              />
            </div>
            <button
              ref="clearSearchButton"
              type="button"
              className="btn btn-default icon icon-x"
              aria-label="Clear keybindings search"
              title="Clear search"
            />
          </div>

          <div
            ref="sourceFilters"
            className="btn-group keybindings-source-filters"
            role="group"
            aria-label="Filter keybindings by source"
          >
            <button ref="allSourceFilter" type="button" className="btn selected">
              All
            </button>
            <button ref="userSourceFilter" type="button" className="btn">
              User
            </button>
            <button ref="coreSourceFilter" type="button" className="btn">
              Core
            </button>
            <button ref="packagesSourceFilter" type="button" className="btn">
              Packages
            </button>
          </div>

          <div
            ref="resultStatus"
            className="keybindings-result-status text-subtle"
            role="status"
            aria-live="polite"
          />
          <div
            ref="emptyState"
            className="alert alert-info icon icon-search keybindings-empty-state"
          />

          <table
            ref="keybindingsTable"
            className="native-key-bindings table text keybindings-table"
          >
            <caption className="sr-only">Registered keybindings</caption>
            <col className="keystroke" />
            <col className="command" />
            <col className="source" />
            <col className="selector" />
            <col className="actions" />
            <thead>
              <tr>
                <th className="keystroke" scope="col">
                  Shortcut
                </th>
                <th className="command" scope="col">
                  Command
                </th>
                <th className="source" scope="col">
                  Source
                </th>
                <th className="selector" scope="col">
                  Context
                </th>
                <th className="actions" scope="col">
                  Actions
                </th>
              </tr>
            </thead>
            <tbody ref="keybindingRows" />
          </table>
        </section>
      </div>
    );
  }

  handlePanelEvents() {
    const openKeymapHandler = () => {
      lumine.commands.dispatch(
        lumine.views.getView(lumine.workspace),
        "application:open-your-keymap",
      );
    };
    const resolverHandler = () => {
      lumine.commands.dispatch(
        lumine.views.getView(lumine.workspace),
        "keybinding-resolver:toggle",
      );
    };
    const clearSearchHandler = () => this.clearSearch();
    const sourceFilterHandler = (event) => {
      const button = event.target.closest("button");
      if (button && button.dataset.sourceFilter) this.setSourceFilter(button.dataset.sourceFilter);
    };

    this.refs.openKeymapButton.addEventListener("click", openKeymapHandler);
    this.refs.resolverButton.addEventListener("click", resolverHandler);
    this.refs.clearSearchButton.addEventListener("click", clearSearchHandler);
    this.refs.sourceFilters.addEventListener("click", sourceFilterHandler);

    return new CompositeDisposable(
      new Disposable(() =>
        this.refs.openKeymapButton.removeEventListener("click", openKeymapHandler),
      ),
      new Disposable(() => this.refs.resolverButton.removeEventListener("click", resolverHandler)),
      new Disposable(() =>
        this.refs.clearSearchButton.removeEventListener("click", clearSearchHandler),
      ),
      new Disposable(() =>
        this.refs.sourceFilters.removeEventListener("click", sourceFilterHandler),
      ),
    );
  }

  loadKeyBindings() {
    this.coreKeymapsPath = path.join(lumine.application.getResourcePath(), "keymaps");
    this.userKeymapPath = lumine.keymaps.getUserKeymapPath();
    this.sourceLabelsByPath = new Map();
    this.keyBindings = lumine.keymaps.getKeyBindings();
    this.filterKeyBindings();
  }

  sourceFor(filePath) {
    if (this.sourceLabelsByPath.has(filePath)) return this.sourceLabelsByPath.get(filePath);
    const source = determineSource(filePath, this.coreKeymapsPath, this.userKeymapPath);
    this.sourceLabelsByPath.set(filePath, source);
    return source;
  }

  focus() {
    focusWithHiddenContent(this.refs.searchEditor.element, [this.refs.keybindingsTable]);
  }

  show() {
    this.element.style.display = "";
    this.resumePendingKeyBindingRender();
  }

  clearSearch() {
    if (this.refs.searchEditor.getText()) this.refs.searchEditor.setText("");
    this.filterKeyBindings();
    this.focus();
  }

  setSourceFilter(filter) {
    this.activeSourceFilter = filter;
    this.updateSourceFilterButtons();
    this.filterKeyBindings();
  }

  updateSourceFilterButtons() {
    for (const [filter, button] of Object.entries(this.sourceFilterButtons)) {
      const selected = filter === this.activeSourceFilter;
      button.classList.toggle("selected", selected);
      button.setAttribute("aria-pressed", selected ? "true" : "false");
    }
  }

  filterKeyBindings(
    keyBindings = this.keyBindings,
    filterString = this.refs.searchEditor.getText(),
  ) {
    const keywords = filterString.trim().toLowerCase().split(/\s+/).filter(Boolean);
    const visibleBindings = keyBindings
      .filter((binding) => {
        if (!this.showSelector(binding.selector)) return false;

        let source;
        if (this.activeSourceFilter !== "all" || keywords.length > 0) {
          source = this.sourceFor(binding.source);
          if (!this.matchesSourceFilter(source)) return false;
        }
        if (keywords.length === 0) return true;

        const fields = [binding.selector, binding.keystrokes, binding.command, source]
          .filter(Boolean)
          .map((field) => String(field).toLowerCase());
        return keywords.every((keyword) =>
          fields.some((field) => this.fieldMatches(field, keyword)),
        );
      })
      .sort(this.compareKeyBindings);

    this.renderKeyBindings(visibleBindings, filterString);
    return visibleBindings;
  }

  renderKeyBindings(bindings, filterString) {
    this.cancelPendingKeyBindingRender();
    this.refs.keybindingRows.replaceChildren();
    const groupCounts = bindings.reduce((counts, binding) => {
      counts.set(binding.keystrokes, (counts.get(binding.keystrokes) || 0) + 1);
      return counts;
    }, new Map());
    const renderedShortcuts = new Set();
    let index = 0;
    const appendBatch = () => {
      const document = this.element.ownerDocument;
      const fragment = document.createDocumentFragment();
      const end = Math.min(index + KeybindingsPanel.renderBatchSize(), bindings.length);
      while (index < end) {
        const binding = bindings[index++];
        const renderShortcut = !renderedShortcuts.has(binding.keystrokes);
        renderedShortcuts.add(binding.keystrokes);
        fragment.appendChild(
          this.elementForKeyBinding(binding, {
            renderShortcut,
            shortcutRowSpan: groupCounts.get(binding.keystrokes),
          }),
        );
      }
      this.refs.keybindingRows.appendChild(fragment);
    };

    this.updateResultState(bindings.length, filterString);
    if (bindings.length <= KeybindingsPanel.synchronousRenderLimit()) {
      while (index < bindings.length) appendBatch();
    } else {
      const renderNextBatch = () => {
        if (this.element.style.display === "none") {
          this.resumeKeyBindingRender = renderNextBatch;
          return;
        }
        this.resumeKeyBindingRender = null;
        appendBatch();
        if (index < bindings.length) {
          this.requestKeyBindingRender(renderNextBatch);
        }
      };
      this.requestKeyBindingRender(renderNextBatch);
    }
  }

  requestKeyBindingRender(callback) {
    const domWindow = this.element.ownerDocument.defaultView;
    if (!domWindow) throw new Error("Keybinding rendering requires a live owner Window");
    const handle = domWindow.requestAnimationFrame(() => {
      if (
        this.pendingKeyBindingRender !== handle ||
        this.pendingKeyBindingRenderWindow !== domWindow
      ) {
        return;
      }
      this.pendingKeyBindingRender = null;
      this.pendingKeyBindingRenderCallback = null;
      this.pendingKeyBindingRenderWindow = null;
      callback();
    });
    this.pendingKeyBindingRender = handle;
    this.pendingKeyBindingRenderCallback = callback;
    this.pendingKeyBindingRenderWindow = domWindow;
  }

  resumePendingKeyBindingRender() {
    if (!this.resumeKeyBindingRender || this.pendingKeyBindingRender != null) return;
    if (this.element.style.display === "none") return;
    const resume = this.resumeKeyBindingRender;
    this.resumeKeyBindingRender = null;
    this.requestKeyBindingRender(resume);
  }

  cancelPendingKeyBindingRender() {
    if (this.pendingKeyBindingRender != null) {
      try {
        this.pendingKeyBindingRenderWindow?.cancelAnimationFrame(this.pendingKeyBindingRender);
      } catch {
        // Recovery can begin after the owning native Window has closed.
      }
    }
    this.pendingKeyBindingRender = null;
    this.pendingKeyBindingRenderCallback = null;
    this.pendingKeyBindingRenderWindow = null;
    this.resumeKeyBindingRender = null;
  }

  beginWindowSurfaceTransition() {
    const resume = this.pendingKeyBindingRenderCallback || this.resumeKeyBindingRender;
    this.cancelPendingKeyBindingRender();
    this.resumeKeyBindingRender = resume;
    const finish = () => this.resumePendingKeyBindingRender();
    return { commit: finish, rollback: finish };
  }

  fieldMatches(field, keyword) {
    return field.includes(keyword) || Boolean(lumine.tools.fuzzyMatcher.match(field, keyword));
  }

  compareKeyBindings(a, b) {
    return (
      String(a.keystrokes).localeCompare(String(b.keystrokes)) ||
      String(a.command).localeCompare(String(b.command)) ||
      String(a.selector).localeCompare(String(b.selector))
    );
  }

  matchesSourceFilter(source) {
    if (this.activeSourceFilter === "all") return true;
    if (this.activeSourceFilter === "user") return source === "User";
    if (this.activeSourceFilter === "core") return source === "Core";
    return source !== "User" && source !== "Core" && source !== "Unknown";
  }

  updateResultState(count, filterString) {
    const hasQuery = Boolean(filterString.trim());
    this.refs.clearSearchButton.style.visibility = hasQuery ? "visible" : "hidden";
    this.refs.keybindingsTable.style.display = count > 0 ? "" : "none";
    this.refs.emptyState.style.display = count === 0 ? "" : "none";

    if (count === 0) {
      this.refs.resultStatus.textContent = "No matching keybindings.";
      this.refs.emptyState.textContent = "No keybindings match this search and source filter.";
    } else if (hasQuery || this.activeSourceFilter !== "all") {
      this.refs.resultStatus.textContent = `${count} matching ${count === 1 ? "keybinding" : "keybindings"}.`;
    } else {
      this.refs.resultStatus.textContent = `${count} registered ${count === 1 ? "keybinding" : "keybindings"}.`;
    }
  }

  showSelector(selector) {
    const segments = selector ? selector.split(",") : [];
    return segments.some((segment) => {
      return this.platformPattern.test(segment) || !this.otherPlatformPattern.test(segment);
    });
  }

  elementForKeyBinding(keyBinding, { renderShortcut = true, shortcutRowSpan = 1 } = {}) {
    const document = this.element.ownerDocument;
    const { selector, keystrokes, command } = keyBinding;
    const source = this.sourceFor(keyBinding.source);
    const tr = document.createElement("tr");
    tr.dataset.selector = selector;
    tr.dataset.keystrokes = keystrokes;
    tr.dataset.command = command;

    const keystrokeTd = this.createShortcutCell(keystrokes);
    if (renderShortcut) {
      keystrokeTd.rowSpan = shortcutRowSpan;
    } else {
      keystrokeTd.classList.add("keybinding-mobile-shortcut");
    }
    tr.appendChild(keystrokeTd);

    const commandTd = this.createCell("command", "Command");
    commandTd.textContent = command;
    commandTd.title = command;
    tr.appendChild(commandTd);

    const sourceTd = this.createCell("source", "Source");
    if (source === "User") {
      const sourceBadge = document.createElement("span");
      sourceBadge.classList.add("badge", "badge-info", "keybinding-source-badge");
      sourceBadge.textContent = source;
      sourceTd.appendChild(sourceBadge);
    } else {
      sourceTd.textContent = source;
    }
    tr.appendChild(sourceTd);

    const selectorTd = this.createCell("selector", "Context");
    selectorTd.textContent = selector;
    selectorTd.title = selector;
    tr.appendChild(selectorTd);

    const actionsTd = this.createCell("actions", "Actions");
    const copyButton = document.createElement("button");
    copyButton.type = "button";
    copyButton.classList.add("btn", "btn-xs", "icon", "icon-clippy", "copy-keybinding");
    copyButton.textContent = "Copy";
    copyButton.setAttribute("aria-label", `Copy override for ${keystrokes}`);
    copyButton.addEventListener("click", () => this.copyKeyBinding(keyBinding, copyButton));
    actionsTd.appendChild(copyButton);
    tr.appendChild(actionsTd);

    return tr;
  }

  createCell(className, label) {
    const document = this.element.ownerDocument;
    const cell = document.createElement("td");
    cell.classList.add(className);
    cell.dataset.label = label;
    return cell;
  }

  createShortcutCell(keystrokes) {
    const document = this.element.ownerDocument;
    const cell = this.createCell("keystroke", "Shortcut");
    const key = document.createElement("kbd");
    key.textContent = keystrokes;
    cell.appendChild(key);
    return cell;
  }

  copyKeyBinding({ selector, keystrokes, command }, button) {
    const keymapExtension = path.extname(lumine.keymaps.getUserKeymapPath());
    const escapeCSON = (input) => {
      return JSON.stringify(input).slice(1, -1).replace(/\\"/g, '"').replace(/'/g, "\\'");
    };
    const content =
      keymapExtension === ".cson"
        ? `'${escapeCSON(selector)}':\n  '${escapeCSON(keystrokes)}': '${escapeCSON(command)}'`
        : `${JSON.stringify(selector)}: {\n  ${JSON.stringify(keystrokes)}: ${JSON.stringify(command)}\n}`;
    lumine.clipboard.write(content);

    button.textContent = "Copied";
    button.classList.add("copied");
    const timeout = setTimeout(() => {
      this.copyFeedbackTimeouts.delete(timeout);
      if (button.isConnected) {
        button.textContent = "Copy";
        button.classList.remove("copied");
      }
    }, 1200);
    this.copyFeedbackTimeouts.add(timeout);
  }

  scrollUp() {
    this.element.scrollTop -= this.element.ownerDocument.body.offsetHeight / 20;
  }

  scrollDown() {
    this.element.scrollTop += this.element.ownerDocument.body.offsetHeight / 20;
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

  static determineSource(filePath) {
    return determineSource(
      filePath,
      path.join(lumine.application.getResourcePath(), "keymaps"),
      lumine.keymaps.getUserKeymapPath(),
    );
  }
};

function determineSource(filePath, coreKeymapsPath, userKeymapPath) {
  if (!filePath || typeof filePath !== "string") return "Unknown";
  if (filePath.indexOf(coreKeymapsPath) === 0) return "Core";
  if (filePath === userKeymapPath) return "User";

  const pathParts = filePath.split(path.sep);
  const packageName = pathParts[pathParts.length - 3] || "";
  return packageName ? _.titleize(_.uncamelcase(packageName)) : "Unknown";
}
