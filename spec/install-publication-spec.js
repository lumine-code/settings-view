describe("Install Panel publication ownership", () => {
  let panel, settings, manager, client, completions;
  const deferred = () => {
    let resolve;
    const promise = new Promise((done) => (resolve = done));
    return { promise, resolve };
  };
  beforeEach(async () => {
    for (const name of ["openPath", "openExternal", "openApplication", "showItemInFolder"])
      spyOn(lumine.shell, name).and.resolveTo();
    spyOn(lumine.application, "openWindow").and.resolveTo();
    const pack = await lumine.packages.activatePackage("settings-view");
    const root = require("node:path").join(pack.path, "lib");
    const PackageManager = require(require("node:path").join(root, "package-manager"));
    const SettingsView = require(require("node:path").join(root, "settings-view"));
    const InstallPanel = require(require("node:path").join(root, "install-panel"));
    manager = new PackageManager();
    completions = [];
    client = {
      hydrateManualSource: jasmine.createSpy("owned manual hydration").and.callFake(() => {
        const completion = deferred();
        completions.push(completion);
        return completion.promise;
      }),
      loadAll: jasmine
        .createSpy("owned catalog boundary")
        .and.resolveTo({ schemaVersion: 2, packages: [], errors: [] }),
      cancel: () => {},
      mergeInstalledUpdates: () => {},
    };
    spyOn(manager, "getCatalogClient").and.returnValue(client);
    spyOn(manager, "getAvatarCache").and.returnValue({ avatar() {} });
    settings = new SettingsView();
    panel = new InstallPanel(settings, manager);
    jasmine.attachToDOM(panel.element);
  });
  afterEach(async () => {
    for (const completion of completions) completion.resolve({});
    await Promise.resolve();
    await panel?.destroy();
    await settings?.destroy();
    await lumine.packages.deactivatePackage("settings-view");
  });
  const source = (name) => ({ name, installSource: `audit/${name}`, repository: `audit/${name}` });
  it("keeps the newer actual manual source card when an older hydration finishes", async () => {
    panel.showGitInstallPackageCard(source("first"));
    panel.showGitInstallPackageCard(source("second"));
    completions[1].resolve({ name: "second", version: "2.0.0", status: "ready" });
    await Promise.resolve();
    await Promise.resolve();
    completions[0].resolve({ name: "first", version: "1.0.0", status: "ready" });
    await Promise.resolve();
    await Promise.resolve();
    expect(panel.currentGitPackageCard.pack.installSource).toBe("audit/second");
    expect(panel.refs.resultsContainer.textContent).toContain("second");
  });
  it("keeps an explicitly cleared query clear after a catalog search completes", async () => {
    const completion = deferred();
    panel.catalogPromise = completion.promise;
    panel.catalogPackages = [{ ...source("needle"), keywords: ["needle"], version: "1.0.0" }];
    const searching = panel.searchCatalog("needle");
    panel.clearSearchResults();
    completion.resolve();
    await searching;
    expect(panel.catalogPackageCards.length).toBe(0);
    expect(panel.refs.resultsContainer.children.length).toBe(0);
  });
  it("does not allocate a manual card after the actual panel is destroyed", async () => {
    panel.showGitInstallPackageCard(source("late"));
    await panel.destroy();
    const allocate = spyOn(panel, "getPackageCardView").and.callThrough();
    completions[0].resolve({ name: "late", status: "ready" });
    await Promise.resolve();
    await Promise.resolve();
    expect(allocate).not.toHaveBeenCalled();
  });
  it("does not allocate catalog cards after the actual panel is destroyed", async () => {
    const completion = deferred();
    panel.catalogPromise = completion.promise;
    panel.catalogPackages = [{ ...source("needle"), keywords: ["needle"], version: "1.0.0" }];
    const searching = panel.searchCatalog("needle");
    await panel.destroy();
    const allocate = spyOn(panel, "getPackageCardView").and.callThrough();
    completion.resolve();
    await searching;
    expect(allocate).not.toHaveBeenCalled();
  });
  it("retires the progressive render timer and copied record callback with the panel", async () => {
    const completion = deferred();
    let callbacks;
    client.loadAll.and.callFake((_sources, options) => {
      callbacks = options;
      return completion.promise;
    });
    const timeout = spyOn(window, "setTimeout").and.callThrough();
    const clear = spyOn(window, "clearTimeout").and.callThrough();
    const loading = panel.loadCatalog();
    callbacks.onRecord(source("first"));
    const timerCall = timeout.calls.all().find((call) => call.args[1] === 5000);
    expect(timerCall).toBeDefined();
    await panel.destroy();
    expect(clear.calls.allArgs().some((args) => args[0] === timerCall.returnValue)).toBe(true);
    timeout.calls.reset();
    callbacks.onRecord(source("late"));
    expect(timeout).not.toHaveBeenCalled();
    completion.resolve({ packages: [], errors: [] });
    await loading;
  });
  it("keeps the manual source surface during progressive catalog hydration", async () => {
    const completion = deferred();
    let callbacks;
    client.loadAll.and.callFake((_sources, options) => {
      callbacks = options;
      return completion.promise;
    });
    const loading = panel.loadCatalog();
    panel.refs.searchEditor.setText("audit/manual");
    panel.showGitInstallPackageCard(source("manual"));
    const card = panel.currentGitPackageCard;
    for (let index = 0; index < 50; index++) callbacks.onRecord(source(`audit-${index}`));
    expect(panel.currentGitPackageCard).toBe(card);
    expect(panel.refs.resultsContainer.contains(card.element)).toBe(true);
    completion.resolve({ packages: [], errors: [] });
    await loading;
  });
  it("disposes a card returned after its allocating panel retires", async () => {
    const allocate = panel.getPackageCardView.bind(panel);
    let card, destruction;
    spyOn(panel, "getPackageCardView").and.callFake((pack) => {
      destruction = panel.destroy();
      card = allocate(pack);
      spyOn(card, "destroy").and.callThrough();
      return card;
    });
    await panel.renderCardList(panel.refs.resultsContainer, panel.catalogPackageCards, [
      source("allocated"),
    ]);
    await destruction;
    expect(card.destroy).toHaveBeenCalled();
    expect(panel.catalogPackageCards.length).toBe(0);
  });
  it("finishes captured old-card cleanup when the first real card retires its panel", async () => {
    await panel.renderCardList(panel.refs.resultsContainer, panel.catalogPackageCards, [
      source("old-first"),
      source("old-second"),
    ]);
    const [first, second] = panel.catalogPackageCards;
    const destroy = first.destroy.bind(first);
    let destruction;
    spyOn(first, "destroy").and.callFake(() => {
      destruction = panel.destroy();
      return destroy();
    });
    spyOn(second, "destroy").and.callThrough();
    const update = spyOn(second, "updateDisabledState").and.callThrough();
    await panel.renderCardList(panel.refs.resultsContainer, panel.catalogPackageCards, [
      source("replacement"),
    ]);
    await destruction;
    expect(second.destroy).toHaveBeenCalled();
    expect(second.disposables.disposed).toBe(true);
    lumine.config.set("core.disabledPackages", ["old-second"]);
    expect(update).not.toHaveBeenCalled();
  });
});
