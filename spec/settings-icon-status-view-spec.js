const SettingsIconStatusView = require("../lib/settings-icon-status-view");

describe("SettingsIconStatusView", function () {
  let view;

  beforeEach(() => {
    view = new SettingsIconStatusView({
      addRightTile: jasmine.createSpy("addRightTile").and.returnValue({ destroy() {} }),
    });
  });

  afterEach(() => view.destroy());

  it("resolves the settings-view:open keybinding in its tooltip", function () {
    const [tooltip] = lumine.tooltips.findTooltips(view.element);

    expect(tooltip.getTitle()).toContain("Settings");
    expect(tooltip.options.keyBindingCommand).toBe("settings-view:open");
  });
});
