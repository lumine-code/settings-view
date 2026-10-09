describe("Settings package list card ownership", () => {
  let settings, manager, panels, root;
  beforeEach(async () => {
    for (const name of ["openPath", "openExternal", "openApplication", "showItemInFolder"])
      spyOn(lumine.shell, name).and.resolveTo();
    spyOn(lumine.application, "openWindow").and.resolveTo();
    const pack = await lumine.packages.activatePackage("settings-view");
    root = require("node:path").join(pack.path, "lib");
    manager = new (require(require("node:path").join(root, "package-manager")))();
    spyOn(manager, "getAvatarCache").and.returnValue({ avatar() {} });
    spyOn(manager, "getInstalled").and.resolveTo({ dev: [], core: [], user: [], git: [] });
    spyOn(manager, "getOutdated").and.resolveTo({});
    settings = new (require(require("node:path").join(root, "settings-view")))();
    panels = [];
  });
  afterEach(async () => {
    for (const panel of panels) {
      for (const list of Object.values(panel.itemViews)) {
        for (const card of list.getViews()) if (!card.destroyed) await card.destroy();
      }
      await panel.destroy();
    }
    await settings.destroy();
    await lumine.packages.deactivatePackage("settings-view");
  });
  for (const moduleName of ["installed-packages-panel", "themes-panel"]) {
    it(`retires its actual ${moduleName} cards and copied list observers`, async () => {
      const Panel = require(require("node:path").join(root, moduleName));
      const panel = new Panel(settings, manager);
      panels.push(panel);
      jasmine.attachToDOM(panel.element);
      await Promise.resolve();
      await Promise.resolve();
      panel.items.dev.setItems([
        { name: "owned-card", version: "1.0.0", repository: "audit/owned-card" },
      ]);
      const card = panel.itemViews.dev.getViews()[0];
      expect(card).toBeDefined();
      const update = spyOn(card, "updateDisabledState").and.callThrough();
      await panel.destroy();
      lumine.config.set("core.disabledPackages", ["owned-card"]);
      expect(update).not.toHaveBeenCalled();
      expect(card.destroyed).toBe(true);
      const create = spyOn(panel, "createPackageCard").and.callThrough();
      const newItem = {
        name: "another-owned-card",
        version: "1.0.0",
        repository: "audit/another-owned-card",
      };
      panel.items.dev.setItems([newItem]);
      expect(panel.itemViews.dev.getViews().length).toBe(0);
      expect(create).not.toHaveBeenCalled();
    });
  }
  it("ignores a copied pending theme configuration update after the actual panel closes", async () => {
    const Panel = require(require("node:path").join(root, "themes-panel"));
    const panel = new Panel(settings, manager);
    panels.push(panel);
    const update = spyOn(panel, "updateThemeConfig").and.callThrough();
    panel.scheduleUpdateThemeConfig();
    await panel.destroy();
    expect(() => window.advanceClock(100)).not.toThrow();
    expect(update).not.toHaveBeenCalled();
  });
  it("does not report a stale frontend failure when native theme enumeration finishes after close", async () => {
    let finish;
    manager.getInstalled.and.returnValue(new Promise((resolve) => (finish = resolve)));
    const Panel = require(require("node:path").join(root, "themes-panel"));
    const panel = new Panel(settings, manager);
    panels.push(panel);
    const notification = spyOn(lumine.notifications, "addError").and.callThrough();
    await panel.destroy();
    finish({ dev: [], core: [], user: [], git: [] });
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
    expect(panel.packages).toBeUndefined();
    expect(notification).not.toHaveBeenCalled();
  });
});
