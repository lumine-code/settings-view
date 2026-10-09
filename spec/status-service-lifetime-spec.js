describe("Settings status service edge ownership", () => {
  let main, hub, bars, leases, connection, connections;
  beforeEach(async () => {
    for (const name of ["openPath", "openExternal", "openApplication", "showItemInFolder"])
      spyOn(lumine.shell, name).and.resolveTo();
    spyOn(lumine.application, "openWindow").and.resolveTo();
    await lumine.packages.activatePackage("status-bar");
    main = (await lumine.packages.activatePackage("settings-view")).mainModule;
    lumine.config.set("settings-view.showSettingsIconInStatusBar", true);
    const pack = lumine.packages.getActivePackage("status-bar");
    const Bar = require(require("node:path").join(pack.path, "lib", "status-bar-view"));
    bars = [new Bar(), new Bar()];
    for (const bar of bars) jasmine.attachToDOM(bar.element);
    leases = [];
    hub = new lumine.packages.serviceHub.constructor();
    connection = hub.consume("status-bar", "^1.0.0", (payload) => main.consumeStatusBar(payload));
    connections = [connection];
  });
  afterEach(async () => {
    for (const lease of leases) lease.dispose();
    for (const current of connections) current.dispose();
    await lumine.packages.deactivatePackage("settings-view");
    for (const bar of bars) bar.destroy();
    await lumine.packages.deactivatePackage("status-bar");
  });
  function provide(bar) {
    const lease = hub.provide("status-bar", "1.0.0", bar);
    leases.push(lease);
    return lease;
  }
  it("keeps its actual settings icon after one shared raw payload edge withdraws", () => {
    provide(bars[0]);
    connections.push(
      hub.consume("status-bar", "^1.0.0", (payload) => main.consumeStatusBar(payload)),
    );
    connection.dispose();
    expect(bars[0].element.querySelectorAll(".settings-icon").length).toBe(1);
    main.createSettingsView({});
    expect(bars[0].element.querySelectorAll(".package-updates-status").length).toBe(1);
  });
  it("restores the latest surviving actual bar in A-B-A edge order", () => {
    provide(bars[0]);
    provide(bars[1]);
    const newest = provide(bars[0]);
    newest.dispose();
    expect(bars[1].element.querySelectorAll(".settings-icon").length).toBe(1);
    expect(bars[0].element.querySelectorAll(".settings-icon").length).toBe(0);
  });
  it("keeps the new Package generation when an old manual lease withdraws", async () => {
    const oldLease = main.consumeStatusBar(bars[0]);
    await lumine.packages.deactivatePackage("settings-view");
    main = (await lumine.packages.activatePackage("settings-view")).mainModule;
    leases.push(main.consumeStatusBar(bars[0]));
    oldLease.dispose();
    expect(bars[0].element.querySelectorAll(".settings-icon").length).toBe(1);
  });
  it("publishes only the newest service if a real tile factory consumes another bar", () => {
    const allocate = bars[0].addRightTile.bind(bars[0]);
    spyOn(bars[0], "addRightTile").and.callFake((options) => {
      const tile = allocate(options);
      provide(bars[1]);
      return tile;
    });
    provide(bars[0]);
    expect(bars[0].element.querySelectorAll(".settings-icon").length).toBe(0);
    expect(bars[1].element.querySelectorAll(".settings-icon").length).toBe(1);
  });
  it("destroys the returned real tile if its allocation retires Settings", () => {
    const allocate = bars[0].addRightTile.bind(bars[0]);
    let tile;
    spyOn(bars[0], "addRightTile").and.callFake((options) => {
      tile = allocate(options);
      spyOn(tile, "destroy").and.callThrough();
      main.deactivate();
      return tile;
    });
    provide(bars[0]);
    expect(tile.destroy).toHaveBeenCalled();
    expect(bars[0].element.querySelectorAll(".settings-icon").length).toBe(0);
  });
});
