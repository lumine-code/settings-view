const { Disposable } = require("lumine");

describe("settings-view status action menus", () => {
  let gear, updates;
  beforeEach(async () => {
    jasmine.attachToDOM(lumine.workspace.getElement());
    await lumine.packages.activatePackage("settings-view");
    const SettingsIconStatusView = require("../lib/settings-icon-status-view");
    const PackageUpdatesStatusView = require("../lib/package-updates-status-view");
    const statusBar = { addRightTile: () => ({ destroy() {} }) };
    gear = new SettingsIconStatusView(statusBar);
    updates = new PackageUpdatesStatusView(statusBar, {
      getAvailableUpdates: () => [{ name: "test" }],
      onDidChangeAvailableUpdates: () => new Disposable(),
    });
    lumine.workspace.getElement().append(gear.element, updates.element);
  });
  afterEach(async () => {
    gear.destroy();
    updates.destroy();
    await lumine.packages.deactivatePackage("settings-view");
  });
  it("provides every settings panel and exposes the updates tile's primary action", () => {
    const gearMenu = lumine.contextMenu
      .templateForElement(gear.element)
      .filter((item) => item.command);
    expect(gearMenu.map((item) => item.command)).toEqual([
      "settings-view:open",
      "settings-view:show-keybindings",
      "settings-view:install-packages-and-themes",
      "settings-view:check-updates",
      "settings-view:view-installed-packages",
      "settings-view:view-installed-themes",
    ]);
    const dispatch = spyOn(lumine.commands, "dispatch").and.callThrough();
    for (const [element, command] of [
      [gear.element, "settings-view:open"],
      [updates.element, "settings-view:check-updates"],
    ]) {
      const [tooltip] = lumine.tooltips.findTooltips(element);
      expect(tooltip.options.keyBindingCommand).toBe(command);
      expect(tooltip.options.keyBindingExtra).toBeUndefined();
      expect(tooltip.getTitle()).toContain("Click to open");
    }
    expect(
      lumine.contextMenu.templateForElement(updates.element).map((item) => item.command),
    ).toEqual(["settings-view:check-updates"]);
    const open = spyOn(lumine.workspace, "open").and.resolveTo();
    for (const element of [gear.element, updates.element])
      element.dispatchEvent(new MouseEvent("click", { button: 2 }));
    expect(open).not.toHaveBeenCalled();
    expect(dispatch).not.toHaveBeenCalled();
    gear.element.click();
    expect(open).toHaveBeenCalledWith("lumine://config");
    updates.element.click();
    expect(dispatch.calls.allArgs().map(([, command]) => command)).toEqual([
      gearMenu[0].command,
      lumine.contextMenu.templateForElement(updates.element)[0].command,
    ]);
    expect(open).toHaveBeenCalledWith("lumine://config/update");
    lumine.commands.dispatch(gear.element, gearMenu[4].command);
    expect(open).toHaveBeenCalledWith("lumine://config/packages");
  });
});
