const path = require("path");

describe("SettingsPanel scope marker layout", () => {
  let settingsPanel;
  let scopeContext;
  let wrapper;

  beforeEach(async () => {
    const pack = await lumine.packages.activatePackage("settings-view");
    // Settings View can be generation-swapped between spec groups. Reacquire
    // its constructor and shared context from the currently active package.
    const SettingsPanel = require(path.join(pack.path, "lib", "settings-panel"));
    scopeContext = require(path.join(pack.path, "lib", "scope-context"));
    scopeContext.set(null);
    scopeContext.setTarget("global");
    lumine.config.setSchema("settings-layout", {
      type: "object",
      properties: {
        title: { type: "string", default: "A setting" },
        nested: {
          type: "object",
          properties: { title: { type: "string", default: "A nested setting" } },
        },
      },
    });
    settingsPanel = new SettingsPanel({ namespace: "settings-layout", includeTitle: false });
    wrapper = document.createElement("div");
    wrapper.className = "settings-view";
    wrapper.style.width = "420px";
    const panels = document.createElement("div");
    panels.className = "panels";
    const item = document.createElement("div");
    item.className = "panels-item";
    item.appendChild(settingsPanel.element);
    panels.appendChild(item);
    wrapper.appendChild(panels);
    jasmine.attachToDOM(wrapper);
  });

  afterEach(async () => {
    settingsPanel?.destroy();
    settingsPanel = null;
    scopeContext?.set(null);
    scopeContext?.setTarget("global");
    wrapper?.remove();
    await lumine.packages.deactivatePackage("settings-view");
  });

  function expectMarkerInsideControlsGutter(marker, group) {
    const panelRect = settingsPanel.element.getBoundingClientRect();
    const markerRect = marker.getBoundingClientRect();
    const controlsRect = group.querySelector(":scope > .controls").getBoundingClientRect();
    expect(markerRect.width).toBeGreaterThan(0);
    expect(markerRect.left).toBeGreaterThanOrEqual(panelRect.left);
    expect(markerRect.right).toBeLessThanOrEqual(panelRect.right);
    expect(controlsRect.left - markerRect.right).toBeGreaterThanOrEqual(4);
    return markerRect;
  }

  for (const { name, padding, fontSize } of [
    { name: "compact sections", padding: 24, fontSize: 13 },
    { name: "narrow dock sections", padding: 12, fontSize: 13 },
    { name: "larger interface fonts", padding: 24, fontSize: 18 },
    { name: "unpadded language settings", padding: 0, fontSize: 13 },
  ]) {
    it(`keeps resolution markers and override controls inside ${name}`, () => {
      settingsPanel.element.style.padding = `${padding}px`;
      settingsPanel.element.style.fontSize = `${fontSize}px`;
      const groups = ["title", "nested.title"].map((key) =>
        settingsPanel.element.querySelector(
          `.control-group[data-setting-key="settings-layout.${key}"]`,
        ),
      );
      const markerRects = groups.map((group) => {
        const indicator = group.querySelector(":scope > .scope-resolution-indicator");
        expect(indicator.hidden).toBe(false);
        return expectMarkerInsideControlsGutter(indicator, group);
      });

      scopeContext.set(".source.js");
      groups.forEach((group, index) => {
        expect(group.querySelector(":scope > .scope-resolution-indicator").hidden).toBe(true);
        const toggle = group.querySelector(":scope > .scope-override-toggle");
        expect(toggle.hidden).toBe(false);
        const toggleRect = expectMarkerInsideControlsGutter(toggle, group);
        expect(toggleRect.left).toBeNear(markerRects[index].left);
        expect(toggleRect.top).toBeNear(markerRects[index].top);
      });
    });
  }
});
