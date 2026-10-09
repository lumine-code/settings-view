describe("Package Detail README publication ownership", () => {
  let manager, settings, view, requests, PackageDetailView;
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
    const path = require("node:path");
    const root = path.join(pack.path, "lib");
    PackageDetailView = require(path.join(root, "package-detail-view"));
    manager = new (require(path.join(root, "package-manager")))();
    requests = [];
    spyOn(manager, "getAvatarCache").and.returnValue({ avatar() {} });
    spyOn(manager, "getCatalogClient").and.returnValue({
      loadReadme: jasmine.createSpy("owned README boundary").and.callFake(() => {
        const request = deferred();
        requests.push(request);
        return request.promise;
      }),
    });
    settings = new (require(path.join(root, "settings-view")))();
    const metadata = {
      name: "owned-detail",
      repository: "audit/owned-detail",
      version: "1.0.0",
      originKey: "github:audit/owned-detail",
      resolvedSha: "old-owned-sha",
    };
    view = new PackageDetailView({ name: metadata.name, metadata }, settings, manager, {
      getSnippets: () => ({}),
    });
    jasmine.attachToDOM(view.element);
  });
  afterEach(async () => {
    for (const request of requests) request.resolve(null);
    await Promise.resolve();
    if (view?.refs) await view.destroy();
    await settings?.destroy();
    await lumine.packages.deactivatePackage("settings-view");
  });
  it("keeps the README for the newly selected actual ref when the older ref finishes late", async () => {
    expect(requests.length).toBe(1);
    view.applySelectedRef({ resolvedSha: "new-owned-sha", previewVersion: true });
    expect(requests.length).toBe(2);
    requests[1].resolve({ body: "# New README", source: "https://example.invalid/new" });
    await Promise.resolve();
    await Promise.resolve();
    requests[0].resolve({ body: "# Old README", source: "https://example.invalid/old" });
    await Promise.resolve();
    await Promise.resolve();
    expect(view.pack.metadata.readme).toBe("# New README");
    expect(view.pack.metadata.readmeSource).toBe("https://example.invalid/new");
  });
  it("does not create a new README view after the actual detail view is destroyed", async () => {
    expect(requests.length).toBe(1);
    const destruction = view.destroy();
    await destruction;
    requests[0].resolve({ body: "# Late README", source: "https://example.invalid/late" });
    await Promise.resolve();
    await Promise.resolve();
    expect(view.readmeView).toBeNull();
    expect(view.pack.metadata.readme).toBeUndefined();
  });
  it("handles a real manager install event once after an earlier reload", () => {
    const update = spyOn(view, "loadPackage").and.callThrough();
    manager.emitter.emit("package-installed", { pack: view.pack });
    update.calls.reset();
    manager.emitter.emit("package-installed", { pack: view.pack });
    expect(update).toHaveBeenCalledTimes(1);
  });
});
