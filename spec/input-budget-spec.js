const { TextBuffer } = require("lumine");

function giantSource() {
  let source = TextBuffer.createTextSnapshot("x".repeat(32768));
  while (source.canMaterialize()) source = source.replace(source.length, source.length, source);
  return source;
}

describe("Settings input budgets", () => {
  let owned = [];
  beforeEach(async () => {
    jasmine.useRealClock();
    await lumine.packages.activatePackage("settings-view");
  });
  afterEach(async () => {
    for (const item of owned.reverse()) await item.destroy();
    owned = [];
  });
  function own(item) {
    owned.push(item);
    return item;
  }
  function guard(editor, limit) {
    const original = editor.getText;
    return spyOn(editor, "getText").and.callFake(() => {
      if (editor.getBuffer().getLength() > limit)
        throw new Error("oversized input must not be read");
      return original.call(editor);
    });
  }

  it("checks query metadata, displays a recoverable message and preserves the complete draft", () => {
    const readInput = require("../lib/read-input"),
      editor = own(lumine.workspace.buildTextEditor({ mini: true }));
    const parent = document.createElement("div");
    parent.appendChild(editor.element);
    const source = giantSource();
    editor.getBuffer().setText(source);
    const read = guard(editor, 4096);
    expect(readInput(editor)).toBeNull();
    expect(read).not.toHaveBeenCalled();
    expect(parent.textContent).toContain("draft has been preserved");
    expect(editor.getBuffer().getTextSnapshot().equals(source)).toBeTrue();
    editor.setText("complete query");
    expect(readInput(editor)).toBe("complete query");
    expect(parent.querySelector(".settings-input-budget-message")).toBeNull();
  });

  it("refuses oversized selector commits and predefined list refreshes without losing the draft", () => {
    const Editor = require("../lib/predefined-values-editor"),
      control = own(new Editor({ values: [".source.js"] }));
    const committed = jasmine.createSpy("commit");
    control.onDidCommit(committed);
    const source = giantSource();
    guard(control.editor, 4096);
    control.editor.getBuffer().setText(source);
    control.commit();
    control.setValues([".source.js", ".source.py"]);
    control.syncSelection();
    expect(committed).not.toHaveBeenCalled();
    expect(control.editor.getBuffer().getTextSnapshot().equals(source)).toBeTrue();
    control.editor.setText(".source.py");
    control.commit();
    expect(committed).toHaveBeenCalledOnceWith(".source.py");
  });

  it("retires a pending setting value and preserves an oversized draft on refresh and blur", () => {
    const Panel = require("../lib/settings-panel");
    lumine.config.setSchema("budget-fixture", {
      type: "object",
      properties: { value: { type: "string", default: "default" } },
    });
    const panel = own(new Panel({ namespace: "budget-fixture", includeTitle: false }));
    const element = panel.element.querySelector('[id="budget-fixture.value"]'),
      editor = element.getModel();
    editor.setText("pending");
    expect(panel.pendingEditorChanges.has(editor)).toBeTrue();
    const source = giantSource();
    guard(editor, 1048576);
    editor.getBuffer().setText(source);
    expect(panel.pendingEditorChanges.has(editor)).toBeFalse();
    panel.setText(editor, "budget-fixture.value", "string", "external refresh");
    element.dispatchEvent(new FocusEvent("blur"));
    expect(editor.getBuffer().getTextSnapshot().equals(source)).toBeTrue();
    expect(lumine.config.get("budget-fixture.value")).toBe("default");
    editor.setText("fixed");
    panel.pendingEditorChanges.get(editor).commit();
    expect(lumine.config.get("budget-fixture.value")).toBe("fixed");
  });

  it("clears settings search results and recovers without using a shortened query", () => {
    const Panel = require("../lib/search-settings-panel"),
      panel = own(new Panel(null));
    const editor = panel.refs.searchEditor;
    guard(editor, 4096);
    editor.getBuffer().setText(giantSource());
    panel.matchSettings();
    expect(panel.searchResults.length).toBe(0);
    expect(panel.searchState).toBe("unavailable");
    expect(panel.refs.searchStatus.textContent).toContain("unavailable");
    editor.setText("font size");
    panel.matchSettings();
    expect(panel.searchState).not.toBe("unavailable");
  });

  it("retires package search presentation before any remote query is started", () => {
    const Panel = require("../lib/install-panel"),
      editor = own(lumine.workspace.buildTextEditor({ mini: true }));
    const panel = Object.create(Panel.prototype);
    panel.refs = { searchEditor: editor, browseArea: document.createElement("div") };
    panel.catalogFetched = true;
    panel.clearSearchResults = jasmine.createSpy("clear results");
    panel.performSearchForQuery = jasmine.createSpy("search");
    guard(editor, 4096);
    editor.getBuffer().setText(giantSource());
    panel.performSearch();
    expect(panel.clearSearchResults).toHaveBeenCalled();
    expect(panel.performSearchForQuery).not.toHaveBeenCalled();
    editor.setText("complete-query");
    panel.performSearch();
    expect(panel.performSearchForQuery).toHaveBeenCalledOnceWith("complete-query");
  });
  for (const moduleName of ["themes-panel", "installed-packages-panel"]) {
    it(`retires ${moduleName} cards and counts for an unavailable query`, () => {
      const Panel = require(`../lib/${moduleName}`),
        editor = own(lumine.workspace.buildTextEditor({ mini: true }));
      const panel = Object.create(Panel.prototype);
      panel.element = document.createElement("div");
      const card = document.createElement("div");
      card.className = "package-card";
      panel.element.appendChild(card);
      panel.refs = { filterEditor: editor, totalPackages: document.createElement("span") };
      panel.filterPackageListByText = jasmine.createSpy("filter");
      guard(editor, 4096);
      editor.getBuffer().setText(giantSource());
      panel.matchPackages();
      expect(card.classList.contains("hidden")).toBeTrue();
      expect(panel.refs.totalPackages.textContent).toBe("Unavailable");
      expect(panel.filterPackageListByText).not.toHaveBeenCalled();
      editor.setText("complete");
      panel.matchPackages();
      expect(panel.filterPackageListByText).toHaveBeenCalledOnceWith("complete");
    });
  }

  it("retires keybinding results when the complete query is unavailable", () => {
    const Panel = require("../lib/keybindings-panel"),
      editor = own(lumine.workspace.buildTextEditor({ mini: true }));
    const panel = Object.create(Panel.prototype);
    panel.refs = { searchEditor: editor };
    panel.keyBindings = [];
    panel.renderKeyBindings = jasmine.createSpy("render");
    guard(editor, 4096);
    editor.getBuffer().setText(giantSource());
    panel.filterKeyBindings();
    expect(panel.renderKeyBindings).toHaveBeenCalledOnceWith([], "");
  });
});
