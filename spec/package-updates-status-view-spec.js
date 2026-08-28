const { Disposable } = require("lumine");
const PackageUpdatesStatusView = require("../lib/package-updates-status-view");

describe("PackageUpdatesStatusView", function () {
  let updates;
  let changeHandler;
  let statusBar;
  let tile;
  let view;

  beforeEach(function () {
    updates = [];
    tile = jasmine.createSpyObj("tile", ["destroy"]);
    statusBar = {
      addRightTile: jasmine.createSpy("addRightTile").and.returnValue(tile),
    };
    const packageManager = {
      getAvailableUpdates: () => updates,
      onDidChangeAvailableUpdates(callback) {
        changeHandler = callback;
        return new Disposable(() => {
          changeHandler = null;
        });
      },
    };
    view = new PackageUpdatesStatusView(statusBar, packageManager);
    view.attach();
  });

  afterEach(function () {
    if (view) view.destroy();
  });

  it("attaches immediately to the left of the settings gear and stays hidden at zero", function () {
    expect(statusBar.addRightTile).toHaveBeenCalledWith({ item: view, priority: 111 });
    expect(view.element).toHaveClass("icon-squirrel");
    expect(view.element.style.display).toBe("none");
  });

  it("shows the count and a singular or plural tooltip", function () {
    const [tooltip] = lumine.tooltips.findTooltips(view.element);

    changeHandler([{ name: "one" }]);
    expect(view.element.style.display).toBe("");
    expect(view.countElement.textContent).toBe("1");
    expect(tooltip.getTitle()).toBe("1 package update available");

    changeHandler([{ name: "one" }, { name: "two" }]);
    expect(view.countElement.textContent).toBe("2");
    expect(tooltip.getTitle()).toBe("2 package updates available");
  });

  it("opens the Update panel when clicked", function () {
    const open = spyOn(lumine.workspace, "open").and.returnValue(Promise.resolve());
    changeHandler([{ name: "one" }]);

    view.element.click();

    expect(open).toHaveBeenCalledWith("lumine://config/update");
  });

  it("destroys its tile and update-state subscription", function () {
    view.destroy();

    expect(tile.destroy).toHaveBeenCalled();
    expect(changeHandler).toBe(null);
    view = null;
  });
});
