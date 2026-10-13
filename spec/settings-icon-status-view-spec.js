const SettingsIconStatusView = require("../lib/settings-icon-status-view");

describe("SettingsIconStatusView", function () {
  let view;

  beforeEach(() => {
    view = new SettingsIconStatusView({
      addRightTile: jasmine.createSpy("addRightTile").and.returnValue({ destroy() {} }),
    });
  });

  afterEach(() => view.destroy());

  it("shows only the primary action in its tooltip", function () {
    const [tooltip] = lumine.tooltips.findTooltips(view.element);

    expect(tooltip.getTitle()).toBe("Click to open Settings.");
    expect(tooltip.options.keyBindingCommand).toBeUndefined();
  });
});
