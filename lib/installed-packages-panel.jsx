/** @jsx etch.dom */
const { CompositeDisposable, TextEditor } = require("lumine");
const etch = require("@lumine-code/etch");

const CollapsibleSectionPanel = require("./collapsible-section-panel");
const PackageCard = require("./package-card");

const List = require("./list");
const ListView = require("./list-view");
const focusWithHiddenContent = require("./focus-with-hidden-content");
const { ownerFromRepository, packageComparatorAscending, packageOrigin } = require("./utils");

// One directory is one entry, so entries are told apart by where they live —
// two directories may provide the same package name.
//
// Whether the copy loads is part of the key as well: a card decides at build
// time whether it is the live package or a shadowed copy, and the two are
// different cards. Keying on it means a copy that gains or loses the name is
// rebuilt rather than left rendering its old self.
const packageEntryKey = (pack) =>
  `${pack.path || pack.name}${pack.isShadowed ? " (shadowed)" : ""}`;

module.exports = class InstalledPackagesPanel extends CollapsibleSectionPanel {
  static loadPackagesDelay() {
    return 300;
  }

  static packageCardBatchSize() {
    return 20;
  }

  constructor(settingsView, packageManager) {
    super();
    etch.initialize(this);
    this.destroyed = false;
    this.settingsView = settingsView;
    this.packageManager = packageManager;
    this.items = {
      dev: new List(packageEntryKey),
      core: new List(packageEntryKey),
      installed: new List(packageEntryKey),
    };
    this.itemViews = {
      dev: new ListView(this.items.dev, this.refs.devPackages, this.createPackageCard.bind(this)),
      core: new ListView(
        this.items.core,
        this.refs.corePackages,
        this.createPackageCard.bind(this),
      ),
      installed: new ListView(
        this.items.installed,
        this.refs.installedPackages,
        this.createPackageCard.bind(this),
      ),
    };

    this.subscriptions = new CompositeDisposable();
    this.subscriptions.add(
      this.refs.filterEditor.onDidStopChanging(() => {
        this.matchPackages();
      }),
    );
    const reloadSoon = () => {
      clearTimeout(this.loadPackagesTimeout);
      this.loadPackagesTimeout = setTimeout(() => {
        this.loadPackagesTimeout = null;
        this.loadPackages();
      }, InstalledPackagesPanel.loadPackagesDelay());
    };
    // Rebuild the list when a package is installed or updated.
    this.subscriptions.add(this.packageManager.on("package-updated package-installed", reloadSoon));
    this.availableUpdates = this.packageManager.getAvailableUpdates();
    this.subscriptions.add(
      this.packageManager.onDidChangeAvailableUpdates((updates) => {
        this.availableUpdates = updates;
        this.displayPackageUpdates(updates);
      }),
    );

    // An uninstall usually leaves its card in place, flipped to the
    // not-installed state, which reads better than the whole list flickering —
    // but not when more than one directory provides the package's name. The
    // copy that was removed has no not-installed state to fall back to (an
    // entry is a directory, and that directory is gone), and removing the copy
    // that loaded hands the name to another entry, which has to stop rendering
    // as shadowed. Neither can be done to a card in place.
    this.subscriptions.add(
      this.packageManager.on("package-uninstalled theme-uninstalled", ({ pack }) => {
        if (!pack || !this.packages) return;
        if (pack.isShadowed || this.countCopies(pack.name) > 1) reloadSoon();
      }),
    );

    this.subscriptions.add(this.handleEvents());
    this.subscriptions.add(
      lumine.commands.add(this.element, {
        "core:move-up": () => {
          this.scrollUp();
        },
        "core:move-down": () => {
          this.scrollDown();
        },
        "core:page-up": () => {
          this.pageUp();
        },
        "core:page-down": () => {
          this.pageDown();
        },
        "core:move-to-top": () => {
          this.scrollToTop();
        },
        "core:move-to-bottom": () => {
          this.scrollToBottom();
        },
      }),
    );

    this.loadPackages();
  }

  focus({ preserveLayout = false } = {}) {
    if (preserveLayout) {
      this.refs.filterEditor.element.focus({ preventScroll: true });
      return;
    }
    const sections = [
      this.refs.installedPackagesHeader.parentElement,
      this.refs.corePackagesHeader.parentElement,
      this.refs.devPackagesHeader.parentElement,
    ];
    focusWithHiddenContent(this.refs.filterEditor.element, sections);
  }

  show() {
    this.element.style.display = "";
  }

  destroy() {
    this.destroyed = true;
    clearTimeout(this.loadPackagesTimeout);
    this.loadPackagesTimeout = null;
    this.packageLoadRequestGeneration = (this.packageLoadRequestGeneration || 0) + 1;
    this.packageLoadGeneration = (this.packageLoadGeneration || 0) + 1;
    this.subscriptions.dispose();
    return etch.destroy(this);
  }

  update() {}

  render() {
    return (
      <div className="panels-item" tabIndex="-1">
        <section className="section">
          <div className="section-container">
            <div className="section-heading icon icon-package">
              Installed Packages
              <span ref="totalPackages" className="section-heading-count badge badge-flexible">
                …
              </span>
              <button
                type="button"
                className="icon-sync section-heading-refresh"
                title="Refresh list"
                onclick={() => this.loadPackages()}
              />
            </div>
            <div className="editor-container">
              <TextEditor ref="filterEditor" mini placeholderText="Filter packages by name" />
            </div>

            <section className="sub-section installed-packages">
              <h3 ref="installedPackagesHeader" className="sub-section-heading icon icon-package">
                Installed Packages
                <span ref="installedCount" className="section-heading-count badge badge-flexible">
                  …
                </span>
              </h3>
              <div ref="installedPackages" className="container package-container">
                <div
                  ref="installedLoadingArea"
                  className="alert alert-info loading-area icon icon-hourglass"
                >
                  Loading packages…
                </div>
              </div>
            </section>

            <section className="sub-section core-packages">
              <h3 ref="corePackagesHeader" className="sub-section-heading icon icon-package">
                Bundled Packages
                <span ref="coreCount" className="section-heading-count badge badge-flexible">
                  …
                </span>
              </h3>
              <div ref="corePackages" className="container package-container">
                <div
                  ref="coreLoadingArea"
                  className="alert alert-info loading-area icon icon-hourglass"
                >
                  Loading packages…
                </div>
              </div>
            </section>

            <section className="sub-section dev-packages">
              <h3 ref="devPackagesHeader" className="sub-section-heading icon icon-package">
                Development Packages
                <span ref="devCount" className="section-heading-count badge badge-flexible">
                  …
                </span>
              </h3>
              <div ref="devPackages" className="container package-container">
                <div
                  ref="devLoadingArea"
                  className="alert alert-info loading-area icon icon-hourglass"
                >
                  Loading packages…
                </div>
              </div>
            </section>
          </div>
        </section>
      </div>
    );
  }

  // How many directories the list is showing for a package name.
  countCopies(name) {
    return ["dev", "core", "installed"].reduce(
      (total, type) =>
        total + (this.packages[type] || []).filter((pack) => pack.name === name).length,
      0,
    );
  }

  filterPackages(packages) {
    // A package is a theme (shown in the Themes panel, not here) when it
    // declares a `theme` type or provides multiple themes via a `themes` array.
    const isTheme = ({ theme, themes }) => theme || (Array.isArray(themes) && themes.length > 0);
    packages.dev = packages.dev.filter((p) => !isTheme(p));
    packages.user = packages.user.filter((p) => !isTheme(p));
    packages.core = packages.core.filter((p) => !isTheme(p));
    packages.git = (packages.git || []).filter((p) => !isTheme(p));
    packages.installed = packages.user.concat(packages.git);

    for (let packageType of ["dev", "core", "installed"]) {
      for (let pack of packages[packageType]) {
        pack.owner = ownerFromRepository(pack.repository);
      }
    }

    return packages;
  }

  sortPackages(packages) {
    packages.dev.sort(packageComparatorAscending);
    packages.core.sort(packageComparatorAscending);
    packages.installed.sort(packageComparatorAscending);
    return packages;
  }

  loadPackages() {
    if (this.destroyed) return;
    const requestGeneration = (this.packageLoadRequestGeneration || 0) + 1;
    this.packageLoadRequestGeneration = requestGeneration;
    this.packageManager.getOutdated().then((packages) => {
      if (this.destroyed || requestGeneration !== this.packageLoadRequestGeneration) return;
      this.availableUpdates = packages;
      this.displayPackageUpdates(packages);
    });

    this.packageManager
      .getInstalled()
      .then(async (packages) => {
        if (this.destroyed || requestGeneration !== this.packageLoadRequestGeneration) return;
        if (this.packageRenderPromise) await this.packageRenderPromise;
        if (this.destroyed || requestGeneration !== this.packageLoadRequestGeneration) return;
        const loadGeneration = (this.packageLoadGeneration || 0) + 1;
        this.packageLoadGeneration = loadGeneration;
        this.packages = this.sortPackages(this.filterPackages(packages));
        const renderPromise = (async () => {
          for (const [packageType, loadingArea] of [
            ["installed", this.refs.installedLoadingArea],
            ["core", this.refs.coreLoadingArea],
            ["dev", this.refs.devLoadingArea],
          ]) {
            loadingArea.remove();
            const completed = await this.setPackageItems(
              packageType,
              this.packages[packageType],
              loadGeneration,
            );
            if (!completed) return false;
          }
          return true;
        })();
        this.packageRenderPromise = renderPromise;
        let completed;
        try {
          completed = await renderPromise;
        } finally {
          if (this.packageRenderPromise === renderPromise) this.packageRenderPromise = null;
        }
        if (!completed) return;

        // TODO show empty mesage per section

        this.updateSectionCounts();
        this.displayPackageUpdates(this.availableUpdates);

        this.matchPackages();
      })
      .catch((error) => {
        console.error(error.message, error.stack);
      });
  }

  async setPackageItems(packageType, packages, loadGeneration) {
    const list = this.items[packageType];
    const batchSize = InstalledPackagesPanel.packageCardBatchSize();
    if (list.getItems().length > 0 || packages.length <= batchSize) {
      if (loadGeneration !== this.packageLoadGeneration) return false;
      list.setItems(packages);
      return true;
    }

    for (let end = batchSize; end < packages.length; end += batchSize) {
      if (loadGeneration !== this.packageLoadGeneration) return false;
      list.setItems(packages.slice(0, end));
      await new Promise((resolve) => requestAnimationFrame(resolve));
    }
    if (loadGeneration !== this.packageLoadGeneration) return false;
    list.setItems(packages);
    return true;
  }

  displayPackageUpdates(updates) {
    if (!this.packages) return;
    const updatesByOrigin = new Map();
    for (const update of updates || []) {
      const originKey = packageOrigin(update);
      if (originKey && !updatesByOrigin.has(originKey)) updatesByOrigin.set(originKey, update);
    }
    for (const packageType of ["dev", "core", "installed"]) {
      for (const packageCard of this.itemViews[packageType].getViews()) {
        // A shadowed copy does not own its name, so an update found for that
        // name belongs to the copy that loads, not to this one.
        if (packageCard.pack.isShadowed) continue;
        const update = updatesByOrigin.get(packageOrigin(packageCard.pack));
        if (update) packageCard.displayAvailableUpdate(update);
        else packageCard.clearAvailableUpdate();
      }
    }
  }

  createPackageCard(pack) {
    return new PackageCard(pack, this.settingsView, this.packageManager, { back: "Packages" });
  }

  filterPackageListByText(text) {
    if (!this.packages) {
      return;
    }

    for (let packageType of ["dev", "core", "installed"]) {
      const allViews = this.itemViews[packageType].getViews();
      const activeViews = this.itemViews[packageType].filterViews((pack) => {
        if (text === "") {
          return true;
        } else {
          const owner = pack.owner != null ? pack.owner : ownerFromRepository(pack.repository);
          const filterText = `${pack.name} ${owner}`;
          return lumine.tools.fuzzyMatcher.score(filterText, text) > 0;
        }
      });

      for (const view of allViews) {
        if (view) {
          view.element.style.display = "none";
          view.element.classList.add("hidden");
        }
      }

      for (const view of activeViews) {
        if (view) {
          view.element.style.display = "";
          view.element.classList.remove("hidden");
        }
      }
    }

    this.updateSectionCounts();
  }

  updateUnfilteredSectionCounts() {
    this.updateSectionCount(
      this.refs.installedPackagesHeader,
      this.refs.installedCount,
      this.packages.installed.length,
    );
    this.updateSectionCount(
      this.refs.corePackagesHeader,
      this.refs.coreCount,
      this.packages.core.length,
    );
    this.updateSectionCount(
      this.refs.devPackagesHeader,
      this.refs.devCount,
      this.packages.dev.length,
    );
    const totalPackages =
      this.packages.installed.length + this.packages.core.length + this.packages.dev.length;
    this.refs.totalPackages.textContent = totalPackages.toString();
  }

  updateFilteredSectionCounts() {
    const installed = this.notHiddenCardsLength(this.refs.installedPackages);
    this.updateSectionCount(
      this.refs.installedPackagesHeader,
      this.refs.installedCount,
      installed,
      this.packages.installed.length,
    );

    const core = this.notHiddenCardsLength(this.refs.corePackages);
    this.updateSectionCount(
      this.refs.corePackagesHeader,
      this.refs.coreCount,
      core,
      this.packages.core.length,
    );

    const dev = this.notHiddenCardsLength(this.refs.devPackages);
    this.updateSectionCount(
      this.refs.devPackagesHeader,
      this.refs.devCount,
      dev,
      this.packages.dev.length,
    );

    const shownPackages = dev + core + installed;
    const totalPackages =
      this.packages.installed.length + this.packages.core.length + this.packages.dev.length;
    this.refs.totalPackages.textContent = `${shownPackages}/${totalPackages}`;
  }

  resetSectionHasItems() {
    this.resetCollapsibleSections([
      this.refs.installedPackagesHeader,
      this.refs.corePackagesHeader,
      this.refs.devPackagesHeader,
    ]);
  }

  matchPackages() {
    this.filterPackageListByText(this.refs.filterEditor.getText());
  }

  scrollUp() {
    this.element.scrollTop -= document.body.offsetHeight / 20;
  }

  scrollDown() {
    this.element.scrollTop += document.body.offsetHeight / 20;
  }

  pageUp() {
    this.element.scrollTop -= this.element.offsetHeight;
  }

  pageDown() {
    this.element.scrollTop += this.element.offsetHeight;
  }

  scrollToTop() {
    this.element.scrollTop = 0;
  }

  scrollToBottom() {
    this.element.scrollTop = this.element.scrollHeight;
  }
};
