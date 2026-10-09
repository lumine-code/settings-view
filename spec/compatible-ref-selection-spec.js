describe("Package card compatibility after selecting a ref", () => {
  let card, manager, selecting;

  beforeEach(async () => {
    jasmine.useRealClock();
    for (const method of ["openPath", "openExternal", "openApplication", "showItemInFolder"])
      spyOn(lumine.shell, method).and.returnValue(Promise.resolve());
    spyOn(lumine.application, "openWindow").and.returnValue(Promise.resolve());
    await lumine.packages.activatePackage("settings-view");
    const PackageManager = require("../lib/package-manager");
    const PackageCard = require("../lib/package-card");
    manager = new PackageManager();
    spyOn(manager, "getAvatarCache").and.returnValue({
      avatar: (_login, callback) => callback(null, null),
    });
    const client = manager.getCatalogClient();
    spyOn(client, "selectRef").and.callFake(async (pack, selector) => ({
      ...pack,
      selectedRef: selector,
      version: selector.value.slice(1),
      status: "ready",
      engines: { lumine: selector.value === "v2.0.0" ? ">=100.0.0" : "^1.0.0" },
    }));
    card = new PackageCard(
      {
        name: "owned-ref-compatibility",
        version: "2.0.0",
        repository: "https://github.com/lumine-code/owned-ref-compatibility",
        originKey: "github.com/lumine-code/owned-ref-compatibility",
        status: "ready",
        engines: { lumine: ">=100.0.0" },
        selectedRef: { type: "tag", value: "v2.0.0" },
        refs: {
          tags: [
            { name: "v2.0.0", sha: "2".repeat(40) },
            { name: "v1.0.0", sha: "1".repeat(40) },
          ],
        },
      },
      {},
      manager,
    );
    jasmine.attachToDOM(card.element);
    selecting = spyOn(card, "selectRef").and.callThrough();
  });

  afterEach(async () => {
    await card?.destroy();
    manager.emitter.dispose();
  });

  async function choose(value) {
    card.refs.versionValue.setValue(`tag:${value}`, { emit: true });
    await selecting.calls.mostRecent().returnValue;
  }

  it("offers Install after replacing an incompatible tag with a compatible tag", async () => {
    expect(card.installBlocked).toBe(true);
    await choose("v1.0.0");
    expect(card.pack.version).toBe("1.0.0");
    expect(
      manager.satisfiesVersion(
        manager.normalizeVersion(lumine.application.getVersion()),
        card.pack,
      ),
    ).toBe(true);
    expect(card.installBlocked).toBe(false);
    expect(card.refs.installButton.classList.contains("disabled")).toBe(false);
  });

  it("recomputes compatibility through compatible, incompatible, then compatible tags", async () => {
    await choose("v1.0.0");
    await choose("v2.0.0");
    expect(card.installBlocked).toBe(true);
    await choose("v1.0.0");
    expect(card.installBlocked).toBe(false);
    expect(card.refs.installButton.classList.contains("disabled")).toBe(false);
  });
});
