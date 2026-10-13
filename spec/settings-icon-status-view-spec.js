const SettingsIconStatusView = require("../lib/settings-icon-status-view");

describe("SettingsIconStatusView", function () {
  let view;

  beforeEach(() => {
    view = new SettingsIconStatusView({
      addRightTile: jasmine.createSpy("addRightTile").and.returnValue({ destroy() {} }),
    });
  });

  afterEach(() => view.destroy());

  it("shows the primary action and its keyboard shortcut in the tooltip", function () {
    const [tooltip] = lumine.tooltips.findTooltips(view.element);

    expect(tooltip.getTitle()).toContain("Click to open Settings.");
    expect(tooltip.options.keyBindingCommand).toBe("settings-view:open");
    expect(tooltip.options.keyBindingExtra).toBeUndefined();
  });
});
