const UpdatesPanel = require("../lib/updates-panel");
const PackageManager = require("../lib/package-manager");
const SettingsView = require("../lib/settings-view");

describe("UpdatesPanel", () => {
  let panel = null;
  let packageManager = null;

  beforeEach(() => {
    packageManager = new PackageManager();
  });

  afterEach(() => {
    if (panel) panel.destroy();
  });

  it("lists the installed packages that have a newer version", async () => {
    const getUpdates = spyOn(packageManager, "getGitPackageUpdates").and.returnValue(
      Promise.resolve([
        { name: "updatable", repository: "owner/updatable", latestSha: "a".repeat(40) },
      ]),
    );

    panel = new UpdatesPanel(new SettingsView(), packageManager);

    await panel.loadPromise;
    // Updates come from the install receipts, not the catalog.
    expect(getUpdates).toHaveBeenCalled();
    expect(panel.packageCards.map((card) => card.pack.name)).toEqual(["updatable"]);
    expect(panel.refs.updateCount.textContent).toBe("1");
  });

  it("reports when everything is up to date", async () => {
    spyOn(packageManager, "getGitPackageUpdates").and.returnValue(Promise.resolve([]));

    panel = new UpdatesPanel(new SettingsView(), packageManager);

    await panel.loadPromise;
    expect(panel.packageCards.length).toBe(0);
    expect(panel.refs.updateCount.textContent).toBe("0");
    expect(panel.refs.statusMessage.textContent).toContain("up to date");
  });
});
