const path = require("node:path");

describe("settings-view native opening", () => {
  let main, pack;

  beforeEach(async () => {
    jasmine.attachToDOM(lumine.workspace.getElement());
    if (lumine.packages.isPackageLoaded("settings-view")) {
      await lumine.packages.unloadPackage("settings-view");
    }
    pack = await lumine.packages.activatePackage("settings-view");
    main = pack.mainModule;
  });

  afterEach(async () => {
    await lumine.packages.unloadPackage("settings-view");
  });

  async function holdImport() {
    const runtime = await main.importSettingsRuntime();
    let release;
    spyOn(main, "importSettingsRuntime").and.returnValue(
      new Promise((resolve) => (release = () => resolve(runtime))),
    );
    return release;
  }

  it("retains its synchronous view factory for restoration", () => {
    spyOn(main, "importSettingsRuntime").and.callThrough();
    const view = main.createSettingsView({ uri: "lumine://config" });
    expect(typeof view.showPanelForURI).toBe("function");
    expect(view.then).toBeUndefined();
    expect(main.importSettingsRuntime).not.toHaveBeenCalled();
  });

  it("uses native loading for ordinary URI opens and shares the current constructor", async () => {
    spyOn(main, "importSettingsRuntime").and.callThrough();
    const view = await lumine.workspace.open("lumine://config/core");
    const SettingsView = require(path.join(pack.path, "lib/settings-view.jsx"));
    expect(view instanceof SettingsView).toBe(true);
    expect(main.importSettingsRuntime).toHaveBeenCalledTimes(1);
  });

  it("shares one import and one view for concurrent settings URIs", async () => {
    const release = await holdImport();
    const first = main.openSettingsView("lumine://config/core");
    const second = main.openSettingsView("lumine://config/editor");
    spyOn(main, "createSettingsView").and.callThrough();
    release();
    const [core, editor] = await Promise.all([first, second]);
    expect(core).toBe(editor);
    expect(main.createSettingsView).toHaveBeenCalledTimes(1);
    expect(main.importSettingsRuntime).toHaveBeenCalledTimes(1);
  });

  it("does not create a view for an opening aborted while modules load", async () => {
    const release = await holdImport();
    const controller = new AbortController();
    spyOn(main, "createSettingsView").and.callThrough();
    const pending = main.openSettingsView("lumine://config/core", { signal: controller.signal });
    controller.abort();
    release();
    expect(await pending).toBeUndefined();
    expect(main.createSettingsView).not.toHaveBeenCalled();
  });

  it("does not create an old view after unloading and activating another generation", async () => {
    const release = await holdImport();
    const retired = main;
    spyOn(retired, "createSettingsView").and.callThrough();
    const pending = main.openSettingsView("lumine://config/core");
    await lumine.packages.unloadPackage("settings-view");
    pack = await lumine.packages.activatePackage("settings-view");
    main = pack.mainModule;
    release();
    expect(await pending).toBeUndefined();
    expect(retired.createSettingsView).not.toHaveBeenCalled();
    const view = await main.openSettingsView("lumine://config/editor");
    const SettingsView = require(path.join(pack.path, "lib/settings-view.jsx"));
    expect(view instanceof SettingsView).toBe(true);
  });

  it("retries failed native loading on the next settings opening", async () => {
    spyOn(main, "importSettingsRuntime").and.rejectWith(new Error("Held settings import failed"));
    await expectAsync(main.openSettingsView("lumine://config/core")).toBeRejectedWithError(
      "Held settings import failed",
    );
    main.importSettingsRuntime.and.callThrough();
    const view = await main.openSettingsView("lumine://config/core");
    expect(typeof view.showPanelForURI).toBe("function");
    expect(main.importSettingsRuntime).toHaveBeenCalledTimes(2);
  });
});
