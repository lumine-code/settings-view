const InstallPanel = require("../lib/install-panel");
const PackageManager = require("../lib/package-manager");
const SettingsView = require("../lib/settings-view");

let packageManager;
let panel;
let gitUrlInfo;
let catalogClient;

describe("InstallPanel", function () {
  beforeEach(function () {
    const settingsView = new SettingsView();
    packageManager = new PackageManager();
    lumine.config.set("settings-view.packageCatalogs", ["official/catalog"]);
    catalogClient = {
      load: jasmine
        .createSpy("load")
        .and.returnValue(Promise.resolve({ schemaVersion: 1, packages: [] })),
      loadAll: jasmine.createSpy("loadAll").and.returnValue(
        Promise.resolve({
          schemaVersion: 2,
          packages: [],
          lastFetch: Date.now(),
          errors: [],
        }),
      ),
      cancel: jasmine.createSpy("cancel"),
      mergeInstalledUpdates: jasmine.createSpy("mergeInstalledUpdates"),
      hydrateSource: jasmine.createSpy("hydrateSource").and.callFake((source, catalogSource) =>
        Promise.resolve({
          name: source.split("/").pop(),
          repository: source,
          catalogSources: [catalogSource ?? "external"],
        }),
      ),
    };
    spyOn(packageManager, "getCatalogClient").and.returnValue(catalogClient);
    panel = new InstallPanel(settingsView, packageManager);
  });

  it("uses one repository input for packages and themes", function () {
    expect(panel.refs.searchPackagesButton).toBeUndefined();
    expect(panel.refs.searchThemesButton).toBeUndefined();
    expect(panel.refs.installHeading.textContent).toContain("Install Packages");
    expect(panel.refs.browseHeading.textContent).toContain("Packages");
  });

  it("keeps legacy package and theme install URIs as source aliases", function () {
    expect(panel.extractQueryFromURI("lumine://config/install/package:sample-package")).toBe(
      "sample-package",
    );
    expect(panel.extractQueryFromURI("lumine://config/install/theme:sample-theme")).toBe(
      "sample-theme",
    );
  });

  it("adds and removes catalog repository sources", function () {
    expect(panel.refs.catalogSourcesList.children.length).toBe(1);
    expect(panel.sourceEditors.length).toBe(1);
    expect(panel.sourceEditors[0].getText()).toBe("official/catalog");
    expect(panel.refs.catalogSourcesList.querySelector("lumine-text-editor")).toBeTruthy();
    expect(panel.refs.catalogSourcesList.querySelector("button")).toHaveClass("icon-x");
    expect(
      panel.refs.catalogSourcesList.compareDocumentPosition(panel.refs.catalogEditor.element) &
        Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
    panel.refs.catalogEditor.setText("extra/catalog");
    panel.refs.addCatalogButton.click();

    expect(lumine.config.get("settings-view.packageCatalogs")).toEqual([
      "official/catalog",
      "extra/catalog",
    ]);
    expect(panel.refs.catalogSourcesList.children.length).toBe(2);

    panel.refs.catalogSourcesList.querySelector("button").click();
    expect(lumine.config.get("settings-view.packageCatalogs")).toEqual(["extra/catalog"]);
  });

  it("adds a catalog source when the add editor confirms with enter", function () {
    panel.refs.catalogEditor.setText("extra/catalog");
    lumine.commands.dispatch(panel.refs.catalogEditor.element, "core:confirm");

    expect(lumine.config.get("settings-view.packageCatalogs")).toEqual([
      "official/catalog",
      "extra/catalog",
    ]);
    expect(panel.refs.catalogEditor.getText()).toBe("");
  });

  it("saves edits to configured catalog sources", function () {
    const editor = panel.sourceEditors[0];
    editor.setText("updated/catalog");
    lumine.commands.dispatch(editor.element, "core:confirm");

    expect(lumine.config.get("settings-view.packageCatalogs")).toEqual(["updated/catalog"]);
  });

  it("rejects duplicate catalog sources after URL normalization", function () {
    panel.refs.catalogEditor.setText("https://github.com/official/catalog");
    panel.refs.addCatalogButton.click();

    expect(panel.refs.catalogSourceError.style.display).not.toBe("none");
    expect(panel.refs.catalogSourceErrorMessage.textContent).toContain("already configured");
    expect(lumine.config.get("settings-view.packageCatalogs")).toEqual(["official/catalog"]);
  });

  it("dismisses the catalog source error when its close button is clicked", function () {
    panel.refs.catalogEditor.setText("https://github.com/official/catalog");
    panel.refs.addCatalogButton.click();
    expect(panel.refs.catalogSourceError.style.display).not.toBe("none");

    panel.refs.catalogSourceErrorClose.click();
    expect(panel.refs.catalogSourceError.style.display).toBe("none");
  });

  it("reports catalog fetch failures as a notification", async () => {
    spyOn(lumine.notifications, "addError").and.callThrough();
    catalogClient.loadAll.and.returnValue(Promise.reject(new Error("boom")));
    panel.refs.fetchButton.click();

    await panel.catalogPromise;
    expect(lumine.notifications.addError).toHaveBeenCalled();
    const [message] = lumine.notifications.addError.calls.mostRecent().args;
    expect(message).toContain("boom");
  });

  it("restores the default catalog sources", function () {
    panel.refs.restoreDefaultsButton.click();

    expect(lumine.config.get("settings-view.packageCatalogs")).toEqual(
      lumine.config.getSchema("settings-view.packageCatalogs").default,
    );
  });

  it("does not load any catalogs just from constructing the panel", function () {
    expect(catalogClient.loadAll).not.toHaveBeenCalled();
    expect(panel.catalogFetched).toBe(false);
  });

  it("fetches the catalogs the first time the tab is shown", async () => {
    catalogClient.loadAll.reset();
    panel.beforeShow();
    await panel.catalogPromise;
    expect(panel.catalogFetched).toBe(true);
    expect(catalogClient.loadAll.calls.count()).toBe(2);
    expect(catalogClient.loadAll.calls.argsFor(0)[1].cacheOnly).toBe(true);
    expect(catalogClient.loadAll.calls.mostRecent().args[1].refresh).toBe(true);
  });

  it("does not re-fetch on later shows", async () => {
    panel.beforeShow();
    await panel.catalogPromise;
    expect(panel.catalogFetched).toBe(true);
    catalogClient.loadAll.reset();
    panel.beforeShow();
    expect(catalogClient.loadAll).not.toHaveBeenCalled();
  });

  it("downloads the catalogs without the cache when fetch is clicked", function () {
    catalogClient.loadAll.reset();
    panel.refs.fetchButton.click();
    expect(catalogClient.loadAll.calls.mostRecent().args[0]).toEqual(["official/catalog"]);
    expect(catalogClient.loadAll.calls.mostRecent().args[1].refresh).toBe(true);
  });

  it("auto-downloads the catalogs on the first search if never fetched", function () {
    expect(panel.catalogFetched).toBe(false);
    catalogClient.loadAll.reset();

    panel.refs.searchEditor.setText("something");
    panel.performSearch();

    expect(panel.catalogFetched).toBe(true);
    expect(catalogClient.loadAll).toHaveBeenCalled();
  });

  it("does not auto-download again once the catalogs have been fetched", function () {
    panel.refs.fetchButton.click();
    expect(panel.catalogFetched).toBe(true);
    catalogClient.loadAll.reset();

    panel.refs.searchEditor.setText("something");
    panel.performSearch();

    expect(catalogClient.loadAll).not.toHaveBeenCalled();
  });

  it("aggregates catalogs in order and dedupes packages by repository", async () => {
    catalogClient.loadAll.and.returnValue(
      Promise.resolve({
        schemaVersion: 2,
        packages: [
          {
            name: "shared",
            description: "first/catalog",
            repository: "owner/shared",
            installSource: "owner/shared",
          },
          {
            name: "second-only",
            repository: "owner/second-only",
            installSource: "owner/second-only",
          },
        ],
        errors: [],
      }),
    );
    lumine.config.set("settings-view.packageCatalogs", ["first/catalog", "second/catalog"]);
    panel.refs.fetchButton.click();

    await panel.catalogPromise;
    // The same repository from both catalogs is deduped; the first wins.
    expect(panel.catalogPackages.map(({ name }) => name)).toEqual(["shared", "second-only"]);
    expect(panel.catalogPackages[0].description).toBe("first/catalog");
  });

  it("keeps same-named packages from different repositories", async () => {
    catalogClient.loadAll.and.returnValue(
      Promise.resolve({
        schemaVersion: 2,
        packages: [
          { name: "twin", repository: "author-one/twin", installSource: "author-one/twin" },
          { name: "twin", repository: "author-two/twin", installSource: "author-two/twin" },
        ],
        errors: [],
      }),
    );
    panel.refs.fetchButton.click();

    await panel.catalogPromise;
    expect(panel.catalogPackages.map(({ repository }) => repository)).toEqual([
      "author-one/twin",
      "author-two/twin",
    ]);
  });

  it("erases the current catalog list when a fetch starts, then loads incrementally", async () => {
    panel.catalogPackages = [
      { name: "old-package", repository: "owner/old", installSource: "owner/old" },
    ];
    panel.renderBrowseList();
    expect(panel.refs.browseContainer.querySelectorAll(".package-card").length).toBe(1);

    let listAtFetchStart = null;
    catalogClient.loadAll.and.callFake((sources, opts) => {
      // The old list is erased before any records arrive.
      listAtFetchStart = panel.catalogPackages.slice();
      opts.onRecord({ name: "new-1", repository: "owner/new-1", installSource: "owner/new-1" });
      return Promise.resolve({
        schemaVersion: 2,
        packages: [
          { name: "new-1", repository: "owner/new-1", installSource: "owner/new-1" },
          { name: "new-2", repository: "owner/new-2", installSource: "owner/new-2" },
        ],
        errors: [],
      });
    });

    panel.refs.fetchButton.click();

    await panel.catalogPromise;
    expect(listAtFetchStart).toEqual([]);
    expect(panel.catalogPackages.map(({ name }) => name)).toEqual(["new-1", "new-2"]);
  });

  it("reuses cards across a filter switch instead of rebuilding them", function () {
    panel.catalogPackages = [
      { name: "pkg-a", repository: "owner/pkg-a", installSource: "owner/pkg-a" },
      {
        name: "theme-b",
        repository: "owner/theme-b",
        installSource: "owner/theme-b",
        theme: "syntax",
      },
      { name: "pkg-c", repository: "owner/pkg-c", installSource: "owner/pkg-c" },
    ];

    panel.filterType = "all";
    panel.renderBrowseList();
    const cardByName = {};
    for (const card of panel.browsePackageCards) cardByName[card.pack.name] = card;
    expect(Object.keys(cardByName).sort()).toEqual(["pkg-a", "pkg-c", "theme-b"]);

    // Switching to Packages drops the theme card but reuses the exact same card
    // instances for the packages that remain.
    panel.filterType = "packages";
    panel.renderBrowseList();
    expect(panel.browsePackageCards.map((card) => card.pack.name).sort()).toEqual([
      "pkg-a",
      "pkg-c",
    ]);
    expect(panel.browsePackageCards.find((card) => card.pack.name === "pkg-a")).toBe(
      cardByName["pkg-a"],
    );
    expect(panel.browsePackageCards.find((card) => card.pack.name === "pkg-c")).toBe(
      cardByName["pkg-c"],
    );
  });

  it("searches all hydrated records but renders at most 50 cards per page", function () {
    panel.catalogPackages = Array.from({ length: 1000 }, (_value, index) => ({
      name: `package-${String(index).padStart(4, "0")}`,
      repository: `owner/package-${index}`,
      installSource: `owner/package-${index}`,
      engines: { lumine: "*" },
    }));
    panel.renderBrowseList();

    expect(panel.browsePackageCards.length).toBe(50);
    expect(panel.refs.browseContainer.querySelectorAll(".package-card").length).toBe(50);
    expect(panel.refs.pageStatus.textContent).toContain("1000 result(s)");

    panel.nextPage();
    expect(panel.page).toBe(2);
    expect(panel.browsePackageCards.length).toBe(50);
  });

  it("marks progressively available search results as incomplete while indexing", function () {
    panel.catalogPackages = [
      {
        name: "sample-package",
        repository: "owner/sample-package",
        originKey: "github.com/owner/sample-package",
        status: "ready",
      },
    ];
    panel.catalogIndexing = true;

    panel.renderIncompleteSearch("sample");

    expect(panel.searchPackages.map(({ name }) => name)).toEqual(["sample-package"]);
    expect(panel.refs.resultsContainer.querySelectorAll(".package-card").length).toBe(1);
    expect(panel.refs.searchMessage.textContent).toContain("incomplete");
  });

  describe("results from several catalogs", function () {
    beforeEach(function () {
      panel.catalogPackages = [
        {
          name: "shared",
          repository: "owner/shared",
          installSource: "owner/shared",
          catalogSources: ["owner/catalog"],
          catalogSelectors: [
            { catalogSource: "owner/catalog", selector: { type: "latest", value: null } },
          ],
        },
        // The same repository listed again by a second catalog, under a
        // different name: identity is the origin, so this is one package.
        {
          name: "shared-fork",
          repository: "https://github.com/owner/shared",
          installSource: "owner/shared",
          catalogSources: ["other/catalog"],
          catalogSelectors: [
            { catalogSource: "other/catalog", selector: { type: "latest", value: null } },
          ],
        },
      ];
      panel.catalogPromise = Promise.resolve({ schemaVersion: 1, packages: panel.catalogPackages });
    });

    it("shows one card per repository and records every catalog that lists it", async () => {
      const results = await panel.search("shared");
      expect(results.map(({ name }) => name)).toEqual(["shared"]);
      expect(results[0].catalogSources).toEqual(["owner/catalog", "other/catalog"]);
      expect(panel.refs.resultsContainer.querySelectorAll(".package-card").length).toBe(1);
    });
  });

  describe("searching packages", () =>
    it("does not query the package registry", async () => {
      await panel.search("first");
      expect(panel.refs.searchMessage.textContent).toContain("owner/repo");
    }));

  it("searches catalog metadata and preserves the repository install source", async () => {
    panel.catalogPackages = [
      {
        name: "sample-package",
        description: "Useful sample tools",
        keywords: ["example"],
        repository: "owner/sample-package",
        installSource: "owner/sample-package@2.1.0",
      },
    ];
    panel.catalogPromise = Promise.resolve({ schemaVersion: 1, packages: panel.catalogPackages });

    const results = await panel.search("sample");
    expect(results.length).toBe(1);
    expect(results[0].installSource).toBe("owner/sample-package@2.1.0");
    expect(panel.refs.resultsContainer.querySelectorAll(".package-card").length).toBe(1);
  });

  it("matches by name and keywords but not by description text", async () => {
    panel.catalogPackages = [
      {
        name: "seti-ui",
        description: "An icon-rich UI theme",
        keywords: ["ui", "dark"],
        repository: "owner/seti-ui",
        installSource: "owner/seti-ui",
        theme: "ui",
      },
      {
        name: "seti-syntax",
        description: "A dark syntax theme to pair with Seti UI",
        keywords: ["syntax", "dark"],
        repository: "owner/seti-syntax",
        installSource: "owner/seti-syntax",
        theme: "syntax",
      },
    ];
    panel.catalogPromise = Promise.resolve({ schemaVersion: 1, packages: panel.catalogPackages });

    const results = await panel.search("ui");
    // seti-syntax only mentions "UI" in its description and must not match.
    expect(results.map(({ name }) => name)).toEqual(["seti-ui"]);
  });

  it("filters search results by package and theme", async () => {
    panel.catalogPackages = [
      {
        name: "sample-package",
        description: "Useful sample tools",
        repository: "owner/sample-package",
        installSource: "owner/sample-package",
      },
      {
        name: "sample-theme",
        description: "A colorful sample",
        repository: "owner/sample-theme",
        installSource: "owner/sample-theme",
        theme: "ui",
      },
    ];
    panel.catalogPromise = Promise.resolve({ schemaVersion: 1, packages: panel.catalogPackages });

    panel.filterType = "themes";
    let results = await panel.search("sample");
    expect(results.map(({ name }) => name)).toEqual(["sample-theme"]);

    panel.filterType = "packages";
    results = await panel.search("sample");
    expect(results.map(({ name }) => name)).toEqual(["sample-package"]);
  });

  it("browses all catalog packages matching the active filter", function () {
    panel.catalogPackages = [
      {
        name: "browse-package",
        repository: "owner/browse-package",
        installSource: "owner/browse-package",
      },
      {
        name: "browse-theme",
        repository: "owner/browse-theme",
        installSource: "owner/browse-theme",
        theme: "ui",
      },
    ];

    panel.renderBrowseList();
    expect(panel.browsePackageCards.length).toBe(2);

    panel.setFilterType("themes");
    expect(panel.refs.filterThemesButton).toHaveClass("selected");
    expect(panel.refs.filterAllButton).not.toHaveClass("selected");
    expect(panel.browsePackageCards.length).toBe(1);
    expect(panel.browsePackageCards[0].pack.name).toBe("browse-theme");
  });

  it("hides the browse area while a search query is active", function () {
    panel.catalogPromise = Promise.resolve({ schemaVersion: 1, packages: [] });
    panel.refs.searchEditor.setText("sample");
    panel.performSearch();
    expect(panel.refs.browseArea.style.display).toBe("none");

    panel.refs.searchEditor.setText("");
    panel.performSearch();
    expect(panel.refs.browseArea.style.display).toBe("");
  });

  describe("searching git packages", function () {
    beforeEach(() => {
      return spyOn(panel, "showGitInstallPackageCard").and.callThrough();
    });

    it("shows a git installation card with git specific info for ssh URLs", function () {
      const query = "git@github.com:user/repo.git";
      panel.performSearchForQuery(query);
      const args = panel.showGitInstallPackageCard.calls.argsFor(0)[0];
      expect(args.name).toEqual(query);
      expect(args.gitUrlInfo).toBeTruthy();
    });

    it("shows a git installation card with git specific info for https URLs", function () {
      const query = "https://github.com/user/repo.git";
      panel.performSearchForQuery(query);
      const args = panel.showGitInstallPackageCard.calls.argsFor(0)[0];
      expect(args.name).toEqual(query);
      expect(args.gitUrlInfo).toBeTruthy();
    });

    it("shows a git installation card with git specific info for shortcut URLs", function () {
      const query = "user/repo";
      panel.performSearchForQuery(query);
      const args = panel.showGitInstallPackageCard.calls.argsFor(0)[0];
      expect(args.name).toEqual(query);
      expect(args.gitUrlInfo).toBeTruthy();
    });

    it("keeps a version selector in the install source, not just the repository", function () {
      const query = "asiloisad/community-invert-colors@0.4.0";
      panel.performSearchForQuery(query);
      const args = panel.showGitInstallPackageCard.calls.argsFor(0)[0];
      expect(args.name).toEqual(query);
      expect(args.installSource).toEqual(query);
      expect(args.repository).toEqual("asiloisad/community-invert-colors");
    });

    it("doesn't show a git installation card for normal packages", async () => {
      const query = "this-package-is-so-normal";
      await panel.performSearchForQuery(query);
      expect(panel.showGitInstallPackageCard).not.toHaveBeenCalled();
      expect(panel.refs.searchMessage.textContent).toContain("owner/repo");
    });

    describe("when a package with the same gitUrlInfo property is installed", function () {
      beforeEach(function () {
        gitUrlInfo = jasmine.createSpy("gitUrlInfo");
        return panel.showGitInstallPackageCard({ gitUrlInfo: gitUrlInfo });
      });

      it("replaces the package card with the newly installed pack object", function () {
        const newPack = { gitUrlInfo: gitUrlInfo };
        spyOn(panel, "updateGitPackageCard");
        packageManager.emitter.emit("package-installed", { pack: newPack });
        expect(panel.updateGitPackageCard).toHaveBeenCalledWith(newPack);
      });
    });
  });
});
