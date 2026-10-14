const path = require("node:path");
const { createRequire } = require("node:module");
const windowService = require("./helpers/window-service");

describe("settings icon constructor bootstrap", () => {
  let pack, bar, lease;
  beforeEach(async () => {
    await lumine.packages.activatePackage("status-bar");
    if (lumine.packages.isPackageLoaded("settings-view"))
      await lumine.packages.unloadPackage("settings-view");
    pack = await lumine.packages.activatePackage("settings-view");
    lumine.config.set("settings-view.showSettingsIconInStatusBar", true);
    const Bar = lumine.packages.getActivePackage("status-bar").mainModule.statusBar.constructor;
    bar = new Bar();
  });
  afterEach(async () => {
    lease?.dispose();
    lease = null;
    bar.destroy();
    await lumine.packages.unloadPackage("settings-view");
  });

  it("mounts the visible gear synchronously without loading a constructor shim", () => {
    lease = pack.mainModule.consumeStatusBar(windowService(bar));
    const tile = bar
      .getRightTiles()
      .find((entry) => entry.getItem().element?.matches(".settings-icon"));
    expect(tile).toBeDefined();
    const filename = path.join(__dirname, "../lib/settings-icon-status-view.js");
    expect(Object.values(require.cache).some((entry) => entry?.filename === filename)).toBe(false);
    const currentRequire = createRequire(path.join(pack.path, "package.json"));
    const Constructor = currentRequire("./lib/settings-icon-status-view");
    expect(Constructor).toBe(pack.mainModule.SettingsIconStatusView);
    expect(tile.getItem().constructor).toBe(Constructor);
  });

  it("retains the compatibility path's constructor identity after a package reload", async () => {
    const previous = createRequire(path.join(pack.path, "package.json"))(
      "./lib/settings-icon-status-view",
    );
    await lumine.packages.unloadPackage("settings-view");
    pack = await lumine.packages.activatePackage("settings-view");
    const current = createRequire(path.join(pack.path, "package.json"))(
      "./lib/settings-icon-status-view",
    );
    expect(current).not.toBe(previous);
    expect(current).toBe(pack.mainModule.SettingsIconStatusView);
  });

  it("shares the constructor when the helper is loaded before the package main module", async () => {
    await lumine.packages.unloadPackage("settings-view");
    const currentRequire = createRequire(path.join(pack.path, "package.json"));
    const early = currentRequire("./lib/settings-icon-status-view");
    pack = await lumine.packages.activatePackage("settings-view");
    expect(pack.mainModule.SettingsIconStatusView).toBe(early);
    expect(currentRequire("./lib/settings-icon-status-view")).toBe(early);
  });
});
