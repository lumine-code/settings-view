const path = require("path");
const KeybindingsPanel = require("../lib/keybindings-panel");

describe("KeybindingsPanel", function () {
  let [keyBindings, panel] = [];

  beforeEach(function () {
    expect(lumine.keymaps).toBeDefined();
    const keySource = `${lumine.application.getResourcePath()}${path.sep}keymaps`;
    keyBindings = [
      {
        source: keySource,
        keystrokes: "ctrl-a",
        command: "core:select-all",
        selector: ".editor, .platform-test",
      },
      {
        source: keySource,
        keystrokes: "ctrl-u",
        command: "core:undo",
        selector: ".platform-test",
      },
      {
        source: keySource,
        keystrokes: "ctrl-u",
        command: "core:undo",
        selector: ".platform-a, .platform-b",
      },
      {
        source: keySource,
        keystrokes: "shift-\\ \\",
        command: "core:undo",
        selector: ".editor",
      },
      {
        source: keySource,
        keystrokes: "ctrl-z'",
        command: "core:toggle",
        selector: "lumine-text-editor[data-grammar~='css']",
      },
    ];
    spyOn(lumine.keymaps, "getKeyBindings").and.returnValue(keyBindings);
    return (panel = new KeybindingsPanel());
  });

  afterEach(() => panel.destroy());

  it("loads and displays core key bindings", function () {
    expect(panel.refs.keybindingRows.children.length).toBe(3);

    const row = panel.refs.keybindingRows.children[0];
    expect(row.querySelector(".keystroke").textContent).toBe("ctrl-a");
    expect(row.querySelector(".command").textContent).toBe("core:select-all");
    expect(row.querySelector(".source").textContent).toBe("Core");
    expect(row.querySelector(".selector").textContent).toBe(".editor, .platform-test");
    expect(panel.refs.resultStatus.textContent).toBe("3 registered keybindings.");
    expect(panel.refs.emptyState).toBeHidden();
  });

  it("uses accessible buttons for panel and row actions", () => {
    expect(panel.refs.openKeymapButton.tagName).toBe("BUTTON");
    expect(panel.refs.resolverButton.tagName).toBe("BUTTON");
    expect(panel.refs.clearSearchButton.getAttribute("aria-label")).toBe(
      "Clear keybindings search",
    );
    const copyButton = panel.element.querySelector(".copy-keybinding");
    expect(copyButton.tagName).toBe("BUTTON");
    expect(copyButton.getAttribute("aria-label")).toContain("ctrl-a");
  });

  it("focuses search without laying out the result table", () => {
    Object.defineProperty(panel.element, "scrollTop", {
      configurable: true,
      value: 42,
      writable: true,
    });
    const focus = spyOn(panel.refs.searchEditor.element, "focus").and.callFake(() => {
      expect(panel.refs.keybindingsTable.style.display).toBe("none");
      panel.element.scrollTop = 0;
    });

    panel.focus();

    expect(focus).toHaveBeenCalled();
    expect(panel.refs.keybindingsTable.style.display).toBe("");
    expect(panel.element.scrollTop).toBe(42);
  });

  it("resolves keybinding source paths once per reload", () => {
    const getUserKeymapPath = spyOn(lumine.keymaps, "getUserKeymapPath").and.callThrough();

    panel.loadKeyBindings();
    panel.filterKeyBindings();

    expect(getUserKeymapPath).toHaveBeenCalledTimes(1);
  });

  it("renders large keybinding lists in animation-frame batches", async () => {
    const bindings = Array.from({ length: 101 }, (_, index) => ({
      source: keyBindings[0].source,
      keystrokes: `ctrl-${index}`,
      command: `test:command-${index}`,
      selector: ".editor",
    }));
    lumine.keymaps.getKeyBindings.and.returnValue(bindings);
    panel.destroy();

    panel = new KeybindingsPanel();
    panel.element.style.display = "none";

    expect(panel.refs.keybindingRows.children.length).toBe(0);
    await conditionPromise(() => panel.resumeKeyBindingRender != null);
    expect(panel.refs.keybindingRows.children.length).toBe(0);
    panel.show();
    await conditionPromise(() => panel.refs.keybindingRows.children.length === bindings.length);
  });

  it("moves pending batch rendering to the destination Document", async () => {
    const bindings = Array.from({ length: 101 }, (_, index) => ({
      source: keyBindings[0].source,
      keystrokes: `ctrl-${index}`,
      command: `test:command-${index}`,
      selector: ".editor",
    }));
    lumine.keymaps.getKeyBindings.and.returnValue(bindings);
    panel.destroy();
    panel = new KeybindingsPanel();
    const sourceHandle = panel.pendingKeyBindingRender;
    const frame = document.createElement("iframe");
    jasmine.attachToDOM(frame);

    try {
      expect(sourceHandle).not.toBeNull();
      expect(panel.pendingKeyBindingRenderWindow).toBe(window);
      const detach = panel.beginWindowSurfaceTransition();
      expect(panel.pendingKeyBindingRender).toBeNull();
      expect(panel.resumeKeyBindingRender).toEqual(jasmine.any(Function));

      frame.contentDocument.body.appendChild(panel.element);
      const commit = detach.commit();
      expect(panel.pendingKeyBindingRenderWindow).toBe(frame.contentWindow);
      await commit;
      await conditionPromise(() => panel.refs.keybindingRows.children.length === bindings.length);
      expect(panel.refs.keybindingRows.firstElementChild.ownerDocument).toBe(frame.contentDocument);

      const attach = panel.beginWindowSurfaceTransition();
      document.body.appendChild(panel.element);
      await attach.commit();
      expect(panel.element.ownerDocument).toBe(document);
    } finally {
      if (panel.element.ownerDocument !== document) document.body.appendChild(panel.element);
      frame.remove();
    }
  });

  it("opens the user keymap and keybinding resolver from the header", () => {
    spyOn(lumine.commands, "dispatch");
    const workspaceElement = lumine.views.getView(lumine.workspace);

    panel.refs.openKeymapButton.click();
    expect(lumine.commands.dispatch).toHaveBeenCalledWith(
      workspaceElement,
      "application:open-your-keymap",
    );

    panel.refs.resolverButton.click();
    expect(lumine.commands.dispatch).toHaveBeenCalledWith(
      workspaceElement,
      "keybinding-resolver:toggle",
    );
  });

  describe("when a keybinding is copied", function () {
    describe("when the keybinding file ends in .cson", () =>
      it("writes a CSON snippet to the clipboard", function () {
        spyOn(lumine.keymaps, "getUserKeymapPath").and.returnValue("keymap.cson");
        panel.element.querySelector(".copy-keybinding").click();
        expect(lumine.clipboard.read().replace(/\r\n/g, "\n")).toBe(`\
'.editor, .platform-test':
  'ctrl-a': 'core:select-all'\
`);
      }));

    describe("when the keybinding file ends in .json", () =>
      it("writes a JSON snippet to the clipboard", function () {
        spyOn(lumine.keymaps, "getUserKeymapPath").and.returnValue("keymap.json");
        panel.element.querySelector(".copy-keybinding").click();
        expect(lumine.clipboard.read().replace(/\r\n/g, "\n")).toBe(`\
".editor, .platform-test": {
  "ctrl-a": "core:select-all"
}\
`);
      }));

    describe("when the keybinding contains special characters", function () {
      it("escapes the backslashes before copying", function () {
        spyOn(lumine.keymaps, "getUserKeymapPath").and.returnValue("keymap.cson");
        panel.element.querySelectorAll(".copy-keybinding")[2].click();
        expect(lumine.clipboard.read().replace(/\r\n/g, "\n")).toBe(`\
'.editor':
  'shift-\\\\ \\\\': 'core:undo'\
`);
      });

      it("escapes the single quotes before copying", function () {
        spyOn(lumine.keymaps, "getUserKeymapPath").and.returnValue("keymap.cson");
        panel.element.querySelectorAll(".copy-keybinding")[1].click();
        expect(lumine.clipboard.read().replace(/\r\n/g, "\n")).toBe(`\
'lumine-text-editor[data-grammar~=\\'css\\']':
  'ctrl-z\\'': 'core:toggle'\
`);
      });
    });

    it("shows feedback after copying", () => {
      const copyButton = panel.element.querySelector(".copy-keybinding");
      copyButton.click();
      expect(copyButton.textContent).toBe("Copied");
      expect(copyButton).toHaveClass("copied");
    });
  });

  describe("when the key bindings change", () =>
    it("reloads the key bindings", async () => {
      keyBindings.push({
        source: lumine.keymaps.getUserKeymapPath(),
        keystrokes: "ctrl-b",
        command: "core:undo",
        selector: ".editor",
      });
      lumine.keymaps.emitter.emit("did-reload-keymap");

      await conditionPromise(
        () => panel.refs.keybindingRows.children.length === 4,
        "the new keybinding to show up in the keybinding panel",
      );

      const row = panel.refs.keybindingRows.children[1];
      expect(row.querySelector(".keystroke").textContent).toBe("ctrl-b");
      expect(row.querySelector(".command").textContent).toBe("core:undo");
      expect(row.querySelector(".source").textContent).toBe("User");
      expect(row.querySelector(".selector").textContent).toBe(".editor");
    }));

  describe("when searching key bindings", function () {
    it("find case-insensitive results", function () {
      keyBindings.push({
        source: `${lumine.application.getResourcePath()}${path.sep}keymaps`,
        keystrokes: "F11",
        command: "window:toggle-full-screen",
        selector: "body",
      });
      lumine.keymaps.emitter.emit("did-reload-keymap");

      panel.filterKeyBindings(keyBindings, "f11");

      expect(panel.refs.keybindingRows.children.length).toBe(1);

      const row = panel.refs.keybindingRows.children[0];
      expect(row.querySelector(".keystroke").textContent).toBe("F11");
      expect(row.querySelector(".command").textContent).toBe("window:toggle-full-screen");
      expect(row.querySelector(".source").textContent).toBe("Core");
      expect(row.querySelector(".selector").textContent).toBe("body");
    });

    it("performs a match for each keyword across separate fields", function () {
      panel.filterKeyBindings(keyBindings, "core ctrl-a");

      expect(panel.refs.keybindingRows.children.length).toBe(1);

      const row = panel.refs.keybindingRows.children[0];
      expect(row.querySelector(".keystroke").textContent).toBe("ctrl-a");
      expect(row.querySelector(".command").textContent).toBe("core:select-all");
      expect(row.querySelector(".source").textContent).toBe("Core");
      expect(row.querySelector(".selector").textContent).toBe(".editor, .platform-test");
    });

    it("supports fuzzy command keywords", () => {
      panel.filterKeyBindings(keyBindings, "slct al");
      expect(panel.refs.keybindingRows.children).toHaveLength(1);
      expect(panel.refs.keybindingRows.children[0].querySelector(".command").textContent).toBe(
        "core:select-all",
      );
    });

    it("shows an empty state when nothing matches", () => {
      panel.filterKeyBindings(keyBindings, "nothing-will-match-this");
      expect(panel.refs.keybindingRows.children).toHaveLength(0);
      expect(panel.refs.keybindingsTable).toBeHidden();
      expect(panel.refs.emptyState.style.display).toBe("");
      expect(panel.refs.emptyState.textContent).toContain("No keybindings match");
      expect(panel.refs.resultStatus.textContent).toBe("No matching keybindings.");
    });
  });

  describe("source filters", () => {
    beforeEach(() => {
      keyBindings.push({
        source: lumine.keymaps.getUserKeymapPath(),
        keystrokes: "ctrl-b",
        command: "core:undo",
        selector: ".editor",
      });
      panel.loadKeyBindings();
    });

    it("switches filters using the source buttons", () => {
      panel.refs.userSourceFilter.click();
      expect(panel.activeSourceFilter).toBe("user");
      expect(panel.refs.userSourceFilter).toHaveClass("selected");
      expect(panel.refs.allSourceFilter).not.toHaveClass("selected");
      expect(panel.refs.keybindingRows.children).toHaveLength(1);
      expect(panel.refs.keybindingRows.querySelector(".source").textContent).toBe("User");
    });
  });

  it("groups identical shortcuts across their context rows", () => {
    keyBindings.push({
      source: `${lumine.application.getResourcePath()}${path.sep}keymaps`,
      keystrokes: "ctrl-a",
      command: "editor:select-all",
      selector: "lumine-text-editor",
    });
    panel.loadKeyBindings();

    const duplicateRows = Array.from(panel.refs.keybindingRows.children).filter(
      (row) => row.dataset.keystrokes === "ctrl-a",
    );
    expect(duplicateRows).toHaveLength(2);
    expect(duplicateRows[0].querySelector(".keystroke").rowSpan).toBe(2);
    expect(duplicateRows[1].querySelector(".keystroke")).toHaveClass("keybinding-mobile-shortcut");
  });
});
