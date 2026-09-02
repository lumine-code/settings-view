const fs = require("@lumine-code/fs-plus");
const os = require("os");
const path = require("path");
const PackageManager = require("../lib/package-manager");

describe("PackageManager", function () {
  let [packageManager] = [];

  beforeEach(function () {
    packageManager = new PackageManager();
  });

  describe("::isPackageInstalled()", function () {
    it("returns false when a package is not installed", () =>
      expect(packageManager.isPackageInstalled("some-package")).toBe(false));

    it("returns true when a package is loaded", function () {
      spyOn(lumine.packages, "isPackageLoaded").and.returnValue(true);
      expect(packageManager.isPackageInstalled("some-package")).toBe(true);
    });

    it("returns true when a package is disabled", function () {
      spyOn(lumine.packages, "getAvailablePackageNames").and.returnValue(["some-package"]);
      expect(packageManager.isPackageInstalled("some-package")).toBe(true);
    });
  });

  describe("::getLocalPackages()", function () {
    let [configDirPath, devPackagesPath, bundledPackagesPath] = [];

    beforeEach(function () {
      configDirPath = path.join(os.tmpdir(), "settings-view-config");
      devPackagesPath = path.join(configDirPath, "packages-dev");
      bundledPackagesPath = path.join(path.sep, "app", "packages");
      spyOn(lumine, "getConfigDirPath").and.returnValue(configDirPath);
    });

    // A descriptor shaped like the ones PackageManager::scanAvailablePackages
    // produces: one per directory, carrying the tier it was found in.
    function descriptor(tier, directory, dirname, metadata = {}) {
      return {
        name: metadata.name || dirname,
        dirname,
        path: path.join(directory, dirname),
        tier,
        isBundled: tier === "bundled",
        metadata,
        nameSource: metadata.name ? "manifest" : "dirname",
        isWinner: true,
      };
    }

    function availablePackages(...packs) {
      spyOn(lumine.packages, "getAvailablePackages").and.returnValue(packs);
    }

    it("files a package found in the bundled directory under core", function () {
      // Running in dev mode from a source checkout, every packages/ entry
      // reports isBundled: false; the directory it was found in still says
      // what it is.
      availablePackages(descriptor("bundled", bundledPackagesPath, "tree-view"));

      const packages = packageManager.getLocalPackages();
      expect(packages.core.map((p) => p.name)).toEqual(["tree-view"]);
      expect(packages.user.map((p) => p.name)).toEqual([]);
    });

    it("files a installed package under user", function () {
      availablePackages(
        descriptor("installed", path.join(configDirPath, "packages"), "some-installed-package"),
      );

      const packages = packageManager.getLocalPackages();
      expect(packages.user.map((p) => p.name)).toEqual(["some-installed-package"]);
      expect(packages.core).toEqual([]);
    });

    it("files a dev override of a bundled name under dev and keeps the shadowed bundled entry", function () {
      const shadowedBundled = descriptor("bundled", bundledPackagesPath, "tree-view");
      shadowedBundled.isWinner = false;
      shadowedBundled.shadowedBy = {
        name: "tree-view",
        dirname: "tree-view",
        path: path.join(devPackagesPath, "tree-view"),
        tier: "dev",
      };
      availablePackages(descriptor("dev", devPackagesPath, "tree-view"), shadowedBundled);

      const packages = packageManager.getLocalPackages();
      expect(packages.dev.map((p) => p.name)).toEqual(["tree-view"]);
      expect(packages.core.map((p) => p.name)).toEqual(["tree-view"]);
      expect(packages.core[0].isShadowed).toBe(true);
      expect(packages.core[0].shadowedBy.tier).toBe("dev");
    });

    it("files a git-sourced package under git", function () {
      availablePackages(
        descriptor("installed", path.join(configDirPath, "packages"), "git-package", {
          name: "git-package",
          apmInstallSource: { type: "git" },
        }),
      );

      const packages = packageManager.getLocalPackages();
      expect(packages.git.map((p) => p.name)).toEqual(["git-package"]);
    });

    it("keeps a legacy Git install active but warns when its receipt has no origin", function () {
      availablePackages(
        descriptor("installed", path.join(configDirPath, "packages"), "legacy-package", {
          name: "legacy-package",
          repository: "owner/legacy-package",
          apmInstallSource: { type: "git", source: "owner/legacy-package", sha: "abc123" },
        }),
      );

      const packages = packageManager.getLocalPackages();
      expect(packages.git[0].originWarning).toContain("missing or mismatched");
    });

    it("records the directory a package lives in, whatever the package is called", function () {
      availablePackages(
        descriptor("bundled", bundledPackagesPath, "tree-view"),
        descriptor("installed", path.join(configDirPath, "packages"), "installed-as-other", {
          name: "some-installed-package",
        }),
      );

      const packages = packageManager.getLocalPackages();
      expect(packages.core[0].directoryName).toBe("tree-view");
      expect(packages.user[0].name).toBe("some-installed-package");
      expect(packages.user[0].directoryName).toBe("installed-as-other");
    });

    it("lists every directory providing one name, marking the copies that do not load", function () {
      const stale = descriptor("installed", path.join(configDirPath, "packages"), "zz-old-copy", {
        name: "duplicated-package",
      });
      stale.isWinner = false;
      stale.shadowedBy = {
        name: "duplicated-package",
        dirname: "duplicated-package",
        path: path.join(configDirPath, "packages", "duplicated-package"),
        tier: "installed",
      };
      availablePackages(
        descriptor("installed", path.join(configDirPath, "packages"), "duplicated-package"),
        stale,
      );

      const packages = packageManager.getLocalPackages();
      expect(packages.user.map((pack) => pack.directoryName)).toEqual([
        "duplicated-package",
        "zz-old-copy",
      ]);
      expect(packages.user.map((pack) => pack.isShadowed)).toEqual([false, true]);
    });
  });

  describe("::getInstalled()", function () {
    beforeEach(function () {
      jasmine.useRealClock();
      const configDirPath = path.join(os.tmpdir(), "settings-view-config");
      spyOn(lumine, "getConfigDirPath").and.returnValue(configDirPath);

      // More than one batch (BATCH_SIZE = 20) so the async path exercises its
      // yield-between-chunks loop rather than only the single-batch fast path.
      this.packs = [];
      for (let i = 0; i < 45; i++) {
        this.packs.push({
          name: `installed-${i}`,
          dirname: `installed-${i}`,
          path: path.join(configDirPath, "packages", `installed-${i}`),
          tier: "installed",
          isBundled: false,
          metadata: { name: `installed-${i}` },
          isWinner: true,
        });
      }
      spyOn(lumine.packages, "getAvailablePackages").and.returnValue(this.packs);
    });

    it("resolves to the same structure the synchronous getLocalPackages() returns", async () => {
      const sync = packageManager.getLocalPackages();
      const installed = await packageManager.getInstalled();
      expect(installed).toEqual(sync);
      expect(installed.user.length).toBe(45);
    });
  });

  describe("::getFeatured()", () =>
    it("does not query a package registry", async () => {
      const packages = await packageManager.getFeatured();
      expect(packages).toEqual([]);
    }));

  describe("::findInstalledPackageByOrigin()", function () {
    it("finds a installed install under its previous package name and ignores built-ins", function () {
      spyOn(packageManager, "getLocalPackages").and.returnValue({
        dev: [],
        user: [
          {
            name: "old-package-name",
            repository: "https://github.com/owner/repo",
          },
        ],
        git: [],
        core: [
          {
            name: "built-in",
            repository: "https://github.com/owner/builtin",
            packageKind: "builtin",
          },
        ],
      });

      expect(packageManager.findInstalledPackageByOrigin("github.com/owner/repo").name).toBe(
        "old-package-name",
      );
      expect(packageManager.findInstalledPackageByOrigin("github.com/owner/builtin")).toBe(null);
    });
  });

  describe("::install()", function () {
    it("fails for invalid repository names", async () => {
      const installCallback = jasmine.createSpy("installCallback");
      packageManager.install({ name: "something" }, installCallback);

      await conditionPromise(() => installCallback.calls.count() === 1);

      const installError = installCallback.calls.argsFor(0)[0];
      expect(installError.packageInstallError).toBe(true);
      expect(installError.message).toContain("owner/repo");
    });

    it("installs GitHub packages with names different from the repo name", async () => {
      const installCallback = jasmine.createSpy("installCallback");
      spyOn(packageManager, "emitPackageEvent").and.callThrough();
      // Activation happens once inside installGitHubPackage's afterSwap hook, not
      // in install(); a second activatePackage here would double-activate.
      spyOn(lumine.packages, "activatePackage").and.returnValue(Promise.resolve());
      spyOn(packageManager, "installGitHubPackage").and.returnValue(
        Promise.resolve({
          name: "real-package-name",
          version: "1.0.0",
          apmInstallSource: { type: "git", source: "user/repo", sha: "abc123" },
        }),
      );

      packageManager.install({ name: "user/repo" }, installCallback);

      await conditionPromise(() => installCallback.calls.count() === 1);

      expect(installCallback.calls.argsFor(0).length).toBe(0);
      // install() does not activate (installGitHubPackage is stubbed here, so
      // its afterSwap never runs) — proving activation isn't done twice.
      expect(lumine.packages.activatePackage).not.toHaveBeenCalled();
      const installed = packageManager.emitPackageEvent.calls
        .all()
        .find((call) => call.args[0] === "installed");
      expect(installed.args[1].name).toBe("real-package-name");
    });

    it("emits an installed event with a copy of the pack including package metadata", async () => {
      const installCallback = jasmine.createSpy("installCallback");
      const originalPackObject = { name: "user/repo", otherData: { will: "beCopied" } };
      spyOn(lumine.packages, "activatePackage");
      spyOn(packageManager, "emitPackageEvent");
      spyOn(packageManager, "installGitHubPackage").and.returnValue(
        Promise.resolve({
          name: "real-package-name",
          moreInfo: "yep",
          apmInstallSource: { type: "git", source: "user/repo", sha: "abc123" },
        }),
      );

      packageManager.install(originalPackObject, installCallback);

      await conditionPromise(() => installCallback.calls.count() === 1);

      let installEmittedCount = 0;
      for (let call of packageManager.emitPackageEvent.calls.all()) {
        if (call.args[0] === "installed") {
          expect(call.args[1]).not.toEqual(originalPackObject);
          expect(call.args[1].moreInfo).toEqual("yep");
          expect(call.args[1].otherData).toBe(originalPackObject.otherData);
          installEmittedCount++;
        }
      }
      expect(installEmittedCount).toBe(1);
    });
  });

  describe("::update()", function () {
    it("fails for non-GitHub packages", async () => {
      const updateCallback = jasmine.createSpy("updateCallback");

      packageManager.update({ name: "foo" }, "1.0.0", updateCallback);

      await conditionPromise(() => updateCallback.calls.count() === 1);

      const updateError = updateCallback.calls.argsFor(0)[0];
      expect(updateError.packageInstallError).toBe(true);
      expect(updateError.message).toContain("Only Git repository package updates");
    });

    it("updates GitHub packages through the built-in installer", async () => {
      const updateCallback = jasmine.createSpy("updateCallback");
      packageManager.replaceAvailableUpdates([
        { name: "foo", repository: "user/foo", latestSha: "d".repeat(40) },
      ]);
      spyOn(packageManager, "installGitHubPackage").and.returnValue(
        Promise.resolve({
          name: "foo",
          apmInstallSource: { type: "git", source: "user/foo", sha: "def456" },
        }),
      );

      packageManager.update(
        {
          name: "foo",
          latestSha: "d".repeat(40),
          resolvedRef: { type: "branch", value: "main" },
          apmInstallSource: {
            type: "git",
            source: "user/foo#branch:main",
            selector: { type: "branch", value: "main" },
            updatePolicy: "branch",
            sha: "abc123",
          },
        },
        null,
        updateCallback,
      );

      await conditionPromise(() => updateCallback.calls.count() === 1);

      expect(updateCallback.calls.argsFor(0).length).toBe(0);
      expect(packageManager.getAvailableUpdates()).toEqual([]);
      expect(packageManager.installGitHubPackage).toHaveBeenCalledWith({
        name: "user/foo#branch:main",
        latestSha: "d".repeat(40),
        resolvedSha: "d".repeat(40),
        resolvedRef: { type: "branch", value: "main" },
        selectedRef: { type: "branch", value: "main" },
        updatePolicy: "branch",
        apmInstallSource: {
          type: "git",
          source: "user/foo#branch:main",
          selector: { type: "branch", value: "main" },
          updatePolicy: "branch",
          sha: "abc123",
        },
      });
    });
  });

  describe("::uninstall()", function () {
    // Uninstalling removes one directory. Which directory that is comes from
    // the entry being uninstalled, never from the package's name — a name can
    // be provided by several directories.
    function installedAt(root, dirname) {
      const packagesDir = path.join(root, "packages");
      const packagePath = path.join(packagesDir, dirname);
      fs.makeTreeSync(packagePath);
      return packagePath;
    }

    function tempRoot(prefix) {
      return fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), prefix)));
    }

    it("removes the package from the core.disabledPackages list when no copy is left", async () => {
      const root = tempRoot("lumine-uninstall-disabled-");
      const packagePath = installedAt(root, "something");
      lumine.config.set("core.disabledPackages", ["something"]);
      spyOn(lumine.packages, "getAvailablePackage").and.returnValue(undefined);

      const uninstallCallback = jasmine.createSpy("uninstallCallback");
      await packageManager.uninstall({ name: "something", path: packagePath }, uninstallCallback);

      expect(uninstallCallback).toHaveBeenCalled();
      expect(lumine.config.get("core.disabledPackages")).not.toContain("something");
      expect(fs.existsSync(packagePath)).toBe(false);
      fs.removeSync(root);
    });

    it("awaits async deactivation before unloading an active package", async () => {
      // Reproduces the "Tried to unload active package" error: deactivation is
      // async, so unloading must wait for it to complete.
      const root = tempRoot("lumine-uninstall-active-");
      const packagePath = installedAt(root, "active-pkg");
      let deactivated = false;
      spyOn(lumine.packages, "getLoadedPackage").and.returnValue({
        name: "active-pkg",
        path: packagePath,
      });
      spyOn(lumine.packages, "isPackageActive").and.callFake(() => !deactivated);
      spyOn(lumine.packages, "deactivatePackage").and.callFake(() =>
        Promise.resolve().then(() => {
          deactivated = true;
        }),
      );
      spyOn(lumine.packages, "unloadPackage").and.callFake((name) => {
        if (lumine.packages.isPackageActive(name)) {
          throw new Error(`Tried to unload active package '${name}'`);
        }
      });
      spyOn(lumine.packages, "getAvailablePackage").and.returnValue(undefined);

      const uninstallCallback = jasmine.createSpy("uninstallCallback");
      await packageManager.uninstall({ name: "active-pkg", path: packagePath }, uninstallCallback);

      expect(lumine.packages.deactivatePackage).toHaveBeenCalledWith("active-pkg");
      expect(lumine.packages.unloadPackage).toHaveBeenCalledWith("active-pkg");
      expect(uninstallCallback).toHaveBeenCalled();
      expect(uninstallCallback.calls.mostRecent().args[0]).toBeUndefined();
      fs.removeSync(root);
    });

    it("leaves the loaded package alone when a shadowed copy is uninstalled", async () => {
      const root = tempRoot("lumine-uninstall-shadowed-");
      const loadedPath = installedAt(root, "duplicated-package");
      const shadowedPath = installedAt(root, "zz-old-copy");
      spyOn(lumine.packages, "getLoadedPackage").and.returnValue({
        name: "duplicated-package",
        path: loadedPath,
      });
      spyOn(lumine.packages, "deactivatePackage");
      spyOn(lumine.packages, "unloadPackage");
      spyOn(lumine.packages, "reconcilePackage");
      spyOn(lumine.packages, "getAvailablePackage").and.returnValue({
        name: "duplicated-package",
        path: loadedPath,
      });

      await packageManager.uninstall({ name: "duplicated-package", path: shadowedPath });

      expect(lumine.packages.deactivatePackage).not.toHaveBeenCalled();
      expect(lumine.packages.unloadPackage).not.toHaveBeenCalled();
      expect(lumine.packages.reconcilePackage).not.toHaveBeenCalled();
      expect(fs.existsSync(shadowedPath)).toBe(false);
      expect(fs.existsSync(loadedPath)).toBe(true);
      fs.removeSync(root);
    });

    it("loads whichever copy is left and preserves the disabled slot", async () => {
      const root = tempRoot("lumine-uninstall-promote-");
      const packagePath = installedAt(root, "search-panel");
      const bundledPath = path.join(path.sep, "app", "packages", "search-panel");
      lumine.config.set("core.disabledPackages", ["search-panel"]);
      spyOn(lumine.packages, "getLoadedPackage").and.returnValue({
        name: "search-panel",
        path: packagePath,
      });
      spyOn(lumine.packages, "isPackageActive").and.returnValue(false);
      spyOn(lumine.packages, "unloadPackage");
      spyOn(lumine.packages, "getAvailablePackage").and.returnValue({
        name: "search-panel",
        path: bundledPath,
        tier: "bundled",
      });
      spyOn(lumine.packages, "reconcilePackage").and.returnValue(Promise.resolve(null));

      await packageManager.uninstall({ name: "search-panel", path: packagePath });
      expect(lumine.packages.reconcilePackage).toHaveBeenCalledWith("search-panel", {
        activate: true,
      });
      expect(lumine.config.get("core.disabledPackages")).toContain("search-panel");
      fs.removeSync(root);
    });

    it("does not wait for the copy it loads to finish activating", async () => {
      // A package that defers activation never resolves activatePackage until
      // its trigger fires; awaiting it would hang the uninstall.
      const root = tempRoot("lumine-uninstall-deferred-");
      const packagePath = installedAt(root, "deferred-bundled");
      spyOn(lumine.packages, "getLoadedPackage").and.returnValue({
        name: "deferred-bundled",
        path: packagePath,
      });
      spyOn(lumine.packages, "isPackageActive").and.returnValue(false);
      spyOn(lumine.packages, "unloadPackage");
      spyOn(lumine.packages, "getAvailablePackage").and.returnValue({
        name: "deferred-bundled",
        path: path.join(path.sep, "app", "packages", "deferred-bundled"),
      });
      // Never resolves — mimics a package that defers activation.
      spyOn(lumine.packages, "reconcilePackage").and.returnValue(new Promise(() => {}));

      const uninstallCallback = jasmine.createSpy("uninstallCallback");
      await packageManager.uninstall(
        { name: "deferred-bundled", path: packagePath },
        uninstallCallback,
      );

      expect(lumine.packages.reconcilePackage).toHaveBeenCalled();
      // The uninstall completes even though activation never resolves.
      expect(uninstallCallback).toHaveBeenCalled();
      expect(uninstallCallback.calls.mostRecent().args[0]).toBeUndefined();
      fs.removeSync(root);
    });

    it("still completes the uninstall when loading the remaining copy fails", async () => {
      const root = tempRoot("lumine-uninstall-throw-");
      const packagePath = installedAt(root, "broken-bundled");
      spyOn(lumine.packages, "getLoadedPackage").and.returnValue({
        name: "broken-bundled",
        path: packagePath,
      });
      spyOn(lumine.packages, "isPackageActive").and.returnValue(false);
      spyOn(lumine.packages, "unloadPackage");
      spyOn(lumine.packages, "getAvailablePackage").and.returnValue({
        name: "broken-bundled",
        path: path.join(path.sep, "app", "packages", "broken-bundled"),
      });
      // Built inside the fake, not ahead of it: a rejected promise created
      // before the call it answers is unhandled until the caller gets to it.
      spyOn(lumine.packages, "reconcilePackage").and.callFake(() =>
        Promise.reject(new Error("cannot load bundled package")),
      );

      const uninstallCallback = jasmine.createSpy("uninstallCallback");
      await packageManager.uninstall(
        { name: "broken-bundled", path: packagePath },
        uninstallCallback,
      );

      // The on-disk removal succeeded, so the uninstall reports success even
      // though the best-effort load of the remaining copy failed.
      expect(uninstallCallback).toHaveBeenCalled();
      expect(uninstallCallback.calls.mostRecent().args[0]).toBeUndefined();
      fs.removeSync(root);
    });

    it("removes only a user package symlink and preserves its source directory", async () => {
      const root = tempRoot("lumine-uninstall-");
      const packagesDir = path.join(root, "packages");
      const sourceDir = path.join(root, "linked-package-source");
      const packagePath = path.join(packagesDir, "linked-package");
      const sourceFile = path.join(sourceDir, "keep.txt");
      fs.makeTreeSync(packagesDir);
      fs.makeTreeSync(sourceDir);
      fs.writeFileSync(sourceFile, "keep");
      fs.symlinkSync(sourceDir, packagePath, process.platform === "win32" ? "junction" : "dir");
      spyOn(lumine.packages, "getAvailablePackage").and.returnValue(undefined);

      await packageManager.uninstall({ name: "linked-package", path: packagePath });

      const packageEntryExists = fs.existsSync(packagePath);
      const sourceFileExists = fs.existsSync(sourceFile);
      try {
        fs.unlinkSync(packagePath);
      } catch (error) {
        if (error.code !== "ENOENT") throw error;
      }
      fs.removeSync(root);

      expect(packageEntryExists).toBe(false);
      expect(sourceFileExists).toBe(true);
    });
  });

  describe("::removePackageDir()", function () {
    it("removes a directory tree asynchronously, including nested folders", async () => {
      const dir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "lumine-rm-")));
      fs.makeTreeSync(path.join(dir, "node_modules", "dep", "deep"));
      fs.writeFileSync(path.join(dir, "node_modules", "dep", "deep", "index.js"), "x");
      expect(fs.existsSync(dir)).toBe(true);

      await packageManager.removePackageDir(dir);
      expect(fs.existsSync(dir)).toBe(false);
    });

    it("resolves without error when the directory is already gone", async () => {
      await packageManager.removePackageDir(path.join(os.tmpdir(), "lumine-not-there-xyz"));
    });
  });

  describe("::installGitHubPackage()", function () {
    it("reinstalls an installed package from its recorded source, not the bare name", async () => {
      spyOn(packageManager, "resolvePackageSource").and.returnValue(
        Promise.reject(new Error("stop")),
      );
      const pack = {
        name: "hydrogen-next",
        apmInstallSource: { type: "git", source: "lumine-code/hydrogen-next" },
      };

      let rejected = false;
      await packageManager.installGitHubPackage(pack).catch(() => (rejected = true));

      expect(rejected).toBe(true);
      expect(packageManager.resolvePackageSource).toHaveBeenCalledWith("lumine-code/hydrogen-next");
    });

    it("preserves an explicit version selector from installSource", async () => {
      spyOn(packageManager, "resolvePackageSource").and.returnValue(
        Promise.reject(new Error("stop")),
      );
      const pack = {
        name: "asiloisad/community-invert-colors@0.4.0",
        installSource: "asiloisad/community-invert-colors@0.4.0",
        repository: "asiloisad/community-invert-colors",
      };

      let rejected = false;
      await packageManager.installGitHubPackage(pack).catch(() => (rejected = true));

      expect(rejected).toBe(true);
      // The pinned tag must survive; installing the bare repo would grab latest.
      expect(packageManager.resolvePackageSource).toHaveBeenCalledWith(
        "asiloisad/community-invert-colors@0.4.0",
      );
    });

    it("installs from the repository when no installSource is present, not the bare name", async () => {
      spyOn(packageManager, "resolvePackageSource").and.returnValue(
        Promise.reject(new Error("stop")),
      );
      // A catalog/registry pack that carries only name + repository (+ version).
      const pack = {
        name: "hydrogen-next",
        repository: "lumine-code/hydrogen-next",
        version: "4.14.1",
      };

      let rejected = false;
      await packageManager.installGitHubPackage(pack).catch(() => (rejected = true));

      expect(rejected).toBe(true);
      // The pinned-version attempt must target the repository, never "hydrogen-next".
      const source = packageManager.resolvePackageSource.calls.mostRecent().args[0];
      expect(source).toContain("lumine-code/hydrogen-next");
    });

    it("does not block install completion on a package that defers activation", function () {
      spyOn(lumine.packages, "loadPackage");
      spyOn(lumine.packages, "isPackageDisabled").and.returnValue(false);
      // A package with activationCommands/hooks never resolves activatePackage
      // until its trigger fires; the install must not await that.
      spyOn(lumine.packages, "activatePackage").and.returnValue(new Promise(() => {}));

      const result = packageManager.activateInstalledPackage("deferred-package", { theme: false });

      expect(lumine.packages.loadPackage).toHaveBeenCalledWith("deferred-package");
      expect(lumine.packages.activatePackage).toHaveBeenCalledWith("deferred-package");
      // Returns synchronously — it must not await the (never-resolving) activation.
      expect(result).toBeUndefined();
    });
  });

  describe("::packageHasSettings", function () {
    it("returns true when the package has config", function () {
      lumine.packages.loadPackage(path.join(__dirname, "fixtures", "package-with-config"));
      expect(packageManager.packageHasSettings("package-with-config")).toBe(true);
    });

    it("returns false when the package does not have config and doesn't define language grammars", () =>
      expect(packageManager.packageHasSettings("random-package")).toBe(false));

    it("returns true when the package does not have config, but does define language grammars", () => {
      const packageName = "language-test";
      spyOn(lumine.grammars, "getGrammars").and.returnValue([
        {
          name: "Test",
          scopeName: "source.test",
          type: "tree-sitter",
          packageName,
        },
      ]);

      expect(packageManager.packageHasSettings(packageName)).toBe(true);
    });

    it("does not expose settings for a package with only an unnamed injection grammar", () => {
      const packageName = "language-injection-test";
      spyOn(lumine.grammars, "getGrammars").and.returnValue([
        {
          scopeName: "text.injection-test",
          type: "tree-sitter",
          packageName,
          grammarFilePath: path.join(
            __dirname,
            "fixtures",
            packageName,
            "grammars",
            "tree-sitter-test.json",
          ),
        },
      ]);

      expect(packageManager.packageHasSettings(packageName)).toBe(false);
    });
  });

  describe("::loadOutdated", function () {
    it("caches results", async () => {
      spyOn(packageManager, "getGitPackageUpdates").and.returnValue(
        Promise.resolve([{ name: "boop" }]),
      );

      await new Promise((resolve) => packageManager.loadOutdated(false, resolve));

      expect(packageManager.apmCache.loadOutdated.value).toEqual([{ name: "boop" }]);

      await new Promise((resolve) => packageManager.loadOutdated(false, resolve));

      expect(packageManager.getGitPackageUpdates.calls.count()).toBe(1);
    });

    it("expires results if it is called with clearCache set to true", async () => {
      packageManager.apmCache.loadOutdated = {
        value: ["hi"],
        expiry: Date.now() + 999999999,
      };
      spyOn(packageManager, "getGitPackageUpdates").and.returnValue(
        Promise.resolve([{ name: "boop" }]),
      );

      await new Promise((resolve) => packageManager.loadOutdated(true, resolve));

      expect(packageManager.getGitPackageUpdates.calls.count()).toBe(1);
      expect(packageManager.apmCache.loadOutdated.value).toEqual([{ name: "boop" }]);
    });
  });

  describe("::getGitPackageUpdates()", function () {
    it("finds a newer tag for packages installed with the default selector", async () => {
      spyOn(packageManager, "getLocalPackages").and.returnValue({
        git: [
          {
            name: "sample",
            version: "1.0.0",
            apmInstallSource: {
              type: "git",
              source: "owner/sample",
              updatePolicy: "latest-tag",
              sha: "1111111111111111111111111111111111111111",
            },
          },
        ],
      });
      spyOn(packageManager, "resolvePackageSource").and.returnValue(
        Promise.resolve({
          sha: "2222222222222222222222222222222222222222",
          version: "2.0.0",
          selector: { type: "latest", value: "v2.0.0" },
        }),
      );
      spyOn(packageManager, "inspectPackageUpdate").and.returnValue(
        Promise.resolve({ name: "sample" }),
      );

      const updates = await packageManager.getGitPackageUpdates();
      expect(updates.length).toBe(1);
      expect(updates[0].latestSha).toBe("2222222222222222222222222222222222222222");
      expect(updates[0].latestVersion).toBe("2.0.0");
      expect(updates[0].resolvedRef).toEqual({ type: "latest", value: "v2.0.0" });
      expect(packageManager.getAvailableUpdates()).toEqual(updates);
    });

    it("does not offer an update when the new commit changes the package name", async () => {
      spyOn(packageManager, "getLocalPackages").and.returnValue({
        git: [
          {
            name: "old-package-name",
            version: "1.0.0",
            apmInstallSource: {
              type: "git",
              source: "owner/sample",
              updatePolicy: "latest-tag",
              sha: "1111111111111111111111111111111111111111",
            },
          },
        ],
      });
      spyOn(packageManager, "resolvePackageSource").and.returnValue(
        Promise.resolve({
          sha: "2222222222222222222222222222222222222222",
          version: "2.0.0",
          selector: { type: "latest", value: "v2.0.0" },
        }),
      );
      spyOn(packageManager, "inspectPackageUpdate").and.returnValue(
        Promise.resolve({ name: "new-package-name" }),
      );

      const updates = await packageManager.getGitPackageUpdates();
      expect(updates.length).toBe(1);
      expect(updates[0].renamedPackage).toEqual({
        from: "old-package-name",
        to: "new-package-name",
        sha: "2222222222222222222222222222222222222222",
      });
      expect(updates[0].latestSha).toBeUndefined();
      expect(updates[0].originWarning).toContain("not an update");
    });

    it("does not check explicitly pinned tags or commits", async () => {
      spyOn(packageManager, "getLocalPackages").and.returnValue({
        git: [
          {
            name: "sample",
            apmInstallSource: {
              type: "git",
              source: "owner/sample#tag:v1.0.0",
              updatePolicy: "pinned",
              sha: "1111111111111111111111111111111111111111",
            },
          },
        ],
      });
      spyOn(packageManager, "resolvePackageSource");

      const updates = await packageManager.getGitPackageUpdates();
      expect(updates).toEqual([]);
      expect(packageManager.resolvePackageSource).not.toHaveBeenCalled();
    });

    it("reports a moved pinned tag as suspicious without offering a new SHA", async () => {
      spyOn(packageManager, "getLocalPackages").and.returnValue({
        git: [
          {
            name: "sample",
            apmInstallSource: {
              type: "git",
              source: "owner/sample#tag:v1.0.0",
              selector: { type: "tag", value: "v1.0.0" },
              updatePolicy: "pinned",
              sha: "1111111111111111111111111111111111111111",
            },
          },
        ],
      });
      spyOn(packageManager, "resolvePackageSource").and.returnValue(
        Promise.resolve({ sha: "2222222222222222222222222222222222222222" }),
      );

      const updates = await packageManager.getGitPackageUpdates();
      expect(updates.length).toBe(1);
      expect(updates[0].suspiciousTagMove.remoteSha).toBe(
        "2222222222222222222222222222222222222222",
      );
      expect(updates[0].latestSha).toBeUndefined();
    });
  });

  describe("catalog-discovered updates", function () {
    const installedPackage = (updatePolicy = "latest-tag") => ({
      name: "sample",
      version: "1.0.0",
      repository: "owner/sample",
      apmInstallSource: {
        type: "git",
        source: "owner/sample",
        origin: "github.com/owner/sample",
        updatePolicy,
        sha: "1".repeat(40),
      },
    });

    const catalogPackage = (version = "2.0.0") => ({
      name: "sample",
      version,
      repository: "owner/sample",
      originKey: "github.com/owner/sample",
      status: "ready",
      engines: { lumine: "*" },
      resolvedSha: "2".repeat(40),
      refs: {
        latestStable: { name: `v${version}`, version, sha: "2".repeat(40) },
      },
    });

    it("publishes a newer latest-tag snapshot without resolving or inspecting its ref", function () {
      spyOn(packageManager, "getLocalPackages").and.returnValue({
        git: [installedPackage()],
      });
      const resolve = spyOn(packageManager, "resolvePackageSource");
      const inspect = spyOn(packageManager, "inspectPackageUpdate");
      const changed = jasmine.createSpy("changed");
      packageManager.onDidChangeAvailableUpdates(changed);

      const updates = packageManager.mergeCatalogUpdates([catalogPackage()]);

      expect(resolve).not.toHaveBeenCalled();
      expect(inspect).not.toHaveBeenCalled();
      expect(updates.length).toBe(1);
      expect(updates[0].latestSha).toBe("2".repeat(40));
      expect(updates[0].latestVersion).toBe("2.0.0");
      expect(updates[0].resolvedRef).toEqual({ type: "latest", value: "v2.0.0" });
      expect(changed).toHaveBeenCalledWith(updates);
    });

    it("ignores equal releases, branches, and snapshots not matching their manifest", function () {
      const branch = installedPackage("default-branch");
      const latest = installedPackage();
      spyOn(packageManager, "getLocalPackages").and.returnValue({ git: [branch, latest] });
      const mismatched = catalogPackage("2.0.0");
      mismatched.resolvedSha = "3".repeat(40);

      expect(packageManager.mergeCatalogUpdates([mismatched])).toEqual([]);

      const equal = catalogPackage("1.0.0");
      expect(packageManager.mergeCatalogUpdates([equal])).toEqual([]);

      const older = catalogPackage("0.9.0");
      expect(packageManager.mergeCatalogUpdates([older])).toEqual([]);
    });

    it("removes a prior catalog result when the next snapshot no longer offers it", function () {
      spyOn(packageManager, "getLocalPackages").and.returnValue({
        git: [installedPackage()],
      });
      packageManager.mergeCatalogUpdates([catalogPackage()]);
      expect(packageManager.getAvailableUpdates().length).toBe(1);

      packageManager.mergeCatalogUpdates([]);

      expect(packageManager.getAvailableUpdates()).toEqual([]);
    });

    it("rejects renamed and engine-incompatible catalog manifests", function () {
      spyOn(packageManager, "getLocalPackages").and.returnValue({
        git: [installedPackage()],
      });
      const renamed = catalogPackage();
      renamed.name = "renamed-sample";
      expect(packageManager.mergeCatalogUpdates([renamed])).toEqual([]);

      const incompatible = catalogPackage();
      incompatible.engines = { lumine: ">=999.0.0" };
      expect(packageManager.mergeCatalogUpdates([incompatible])).toEqual([]);
    });

    it("lets a full direct check replace catalog-discovered state", async function () {
      spyOn(packageManager, "getLocalPackages").and.returnValues(
        { git: [installedPackage()] },
        { git: [] },
      );
      packageManager.mergeCatalogUpdates([catalogPackage()]);
      expect(packageManager.getAvailableUpdates().length).toBe(1);

      const updates = await packageManager.getGitPackageUpdates();

      expect(updates).toEqual([]);
      expect(packageManager.getAvailableUpdates()).toEqual([]);
    });
  });
});
