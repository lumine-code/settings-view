describe("Settings rendering in editor windows", () => {
  let panel;
  beforeEach(async () => {
    jasmine.useRealClock();
    jasmine.attachToDOM(lumine.workspace.getElement());
    await lumine.packages.activatePackage("settings-view");
  });
  afterEach(async () => {
    panel?.destroy();
    await lumine.workspace.discardEditorWindows();
  });
  it("moves an unfinished keybinding render to the destination frame queue", async () => {
    const KeybindingsPanel = require("../lib/keybindings-panel");
    const actual = lumine.keymaps.getKeyBindings()[0];
    const bindings = Array.from({ length: 151 }, (_, index) => ({
      ...actual,
      command: "test:binding-" + index,
      keystrokes: "ctrl-" + index,
    }));
    spyOn(lumine.keymaps, "getKeyBindings").and.returnValue(bindings);
    panel = new KeybindingsPanel();
    window.cancelAnimationFrame(panel.pendingKeyBindingRender);
    const item = {
      canCopy: () => false,
      getTitle: () => "Keybindings native rendering",
      element: panel.element,
    };
    await lumine.workspace.open(item);
    const originalWindow = panel.renderFrameWindow;
    const extra = await lumine.workspace.detachItem(item);
    expect(panel.element.ownerDocument).toBe(extra.getDocument());
    expect(originalWindow).toBe(window);
    expect(panel.renderFrameWindow).toBe(extra.getDocument().defaultView);
    await conditionPromise(() => panel.pendingKeyBindingRender == null);
    expect(panel.refs.keybindingRows.querySelectorAll("tr").length).toBe(151);
    await lumine.workspace.attachWindow(extra);
  });
});
