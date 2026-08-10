const path = require("path");
const fs = require("fs");

const CSON = require("@lumine-code/season");

const PackageManager = require("../lib/package-manager");
const ThemesPanel = require("../lib/themes-panel");
const wait = timeoutPromise;

describe("ThemesPanel", function () {
  let [panel, packageManager, reloadedHandler] = [];
  const settingsView = null;

  beforeEach(async () => {
    jasmine.useRealClock();
    lumine.packages.loadPackage("one-theme");
    lumine.packages.packageDirPaths.push(path.join(__dirname, "fixtures"));
    lumine.config.set("theme.mode", "dark");
    lumine.config.set("theme.light", ["one-day-ui", "one-day-syntax"]);
    lumine.config.set("theme.dark", ["one-night-ui", "one-night-syntax"]);
    reloadedHandler = jasmine.createSpy("reloadedHandler");
    lumine.themes.onDidChangeActiveThemes(reloadedHandler);
    await lumine.themes.activatePackages();

    await conditionPromise(() => reloadedHandler.calls.count() === 1, "themes to be reloaded");

    packageManager = new PackageManager();
    const themeMetadata = CSON.readFileSync(
      path.join(__dirname, "fixtures", "a-theme", "package.json"),
    );
    spyOn(packageManager, "getFeatured").and.callFake((_) => Promise.resolve([themeMetadata]));
    panel = new ThemesPanel(settingsView, packageManager);

    // Make updates synchronous
    spyOn(panel, "scheduleUpdateThemeConfig").and.callFake(function () {
      return this.updateThemeConfig();
    });
  });

  afterEach(async () => {
    if (lumine.packages.isPackageLoaded("a-theme")) {
      lumine.packages.unloadPackage("a-theme");
    }
    await Promise.resolve(lumine.themes.deactivateThemes());
  }); // Ensure works on promise and non-promise versions

  it("selects the configured mode and theme pairs", function () {
    expect(panel.refs.modeMenu.value).toBe("dark");
    expect(panel.refs.darkUiMenu.value).toBe("one-night-ui");
    expect(panel.refs.darkSyntaxMenu.value).toBe("one-night-syntax");
    expect(panel.refs.lightUiMenu.value).toBe("one-day-ui");
    expect(panel.refs.lightSyntaxMenu.value).toBe("one-day-syntax");
    expect(panel.refs.darkActiveBadge.style.display).toBe("");
    expect(panel.refs.lightActiveBadge.style.display).toBe("none");
  });

  describe("when a UI theme is selected for the active pair", () =>
    it("updates the pair config key and switches the active themes", async () => {
      for (let child of Array.from(panel.refs.darkUiMenu.children)) {
        child.selected = child.value === "one-day-ui";
        child.dispatchEvent(new Event("change", { bubbles: true }));
      }
      await conditionPromise(() => reloadedHandler.calls.count() === 2);
      expect(lumine.config.get("theme.dark")).toEqual(["one-day-ui", "one-night-syntax"]);
      expect(lumine.config.get(lumine.themes.getActiveThemesKeyPath())).toEqual([
        "one-day-ui",
        "one-night-syntax",
      ]);
    }));

  describe("when a syntax theme is selected for the inactive pair", () =>
    it("updates the pair config key without switching the active themes", async () => {
      reloadedHandler.reset();
      for (let child of Array.from(panel.refs.lightSyntaxMenu.children)) {
        child.selected = child.value === "one-night-syntax";
        child.dispatchEvent(new Event("change", { bubbles: true }));
      }
      await conditionPromise(
        () => lumine.config.get("theme.light")[1] === "one-night-syntax",
        "the light pair to update",
      );
      expect(lumine.config.get("theme.light")).toEqual(["one-day-ui", "one-night-syntax"]);
      expect(lumine.config.get(lumine.themes.getActiveThemesKeyPath())).toEqual([
        "one-night-ui",
        "one-night-syntax",
      ]);
      expect(reloadedHandler.calls.count()).toBe(0);
    }));

  describe("when the theme mode is selected", () =>
    it("updates 'theme.mode' and switches to the matching pair", async () => {
      panel.refs.modeMenu.value = "light";
      panel.refs.modeMenu.dispatchEvent(new Event("change", { bubbles: true }));

      await conditionPromise(() => reloadedHandler.calls.count() === 2);
      expect(lumine.config.get("theme.mode")).toBe("light");
      expect(lumine.config.get(lumine.themes.getActiveThemesKeyPath())).toEqual([
        "one-day-ui",
        "one-day-syntax",
      ]);
      expect(panel.refs.lightActiveBadge.style.display).toBe("");
      expect(panel.refs.darkActiveBadge.style.display).toBe("none");
    }));

  describe("when the theme pair config keys change", () =>
    it("refreshes the theme menus", async () => {
      reloadedHandler.reset();
      lumine.config.set("theme.dark", ["one-day-ui", "one-day-syntax"]);

      await conditionPromise(() => reloadedHandler.calls.count() === 1);

      expect(panel.refs.darkUiMenu.value).toBe("one-day-ui");
      expect(panel.refs.darkSyntaxMenu.value).toBe("one-day-syntax");
    }));

  // `settingsView` is null throughout this file, so the spec that used to sit
  // here called `showPanel` on nothing. What the panel actually owes the
  // settings view is that focusing it puts the cursor in the filter.
  jasmine.describeWithDocumentFocus("when the themes panel is focused", () =>
    it("focuses the search filter", () => {
      jasmine.attachToDOM(panel.element);

      panel.focus();

      expect(panel.refs.filterEditor.element).toHaveFocus();
    }),
  );

  describe("theme lists", function () {
    let [installed] = [];
    beforeEach(async () => {
      installed = JSON.parse(fs.readFileSync(path.join(__dirname, "fixtures", "installed.json")));
      spyOn(packageManager, "loadCompatiblePackageVersion").and.callFake(function () {});
      spyOn(packageManager, "getInstalled").and.returnValue(Promise.resolve(installed));
      panel = new ThemesPanel(settingsView, packageManager);

      await conditionPromise(
        () =>
          packageManager.getInstalled.calls.count() === 1 &&
          panel.refs.installedCount.textContent.indexOf("…") < 0,
      );
    });

    it("shows the themes", function () {
      expect(panel.refs.installedCount.textContent.trim()).toBe("1");
      expect(
        panel.refs.installedPackages.querySelectorAll(".package-card:not(.hidden)").length,
      ).toBe(1);

      expect(panel.refs.coreCount.textContent.trim()).toBe("1");
      expect(panel.refs.corePackages.querySelectorAll(".package-card:not(.hidden)").length).toBe(1);

      expect(panel.refs.devCount.textContent.trim()).toBe("1");
      expect(panel.refs.devPackages.querySelectorAll(".package-card:not(.hidden)").length).toBe(1);
    });

    it("shows repository themes as installed themes", function () {
      const packages = panel.filterThemes({
        user: [{ name: "manual-theme", theme: "syntax" }],
        git: [{ name: "repository-theme", theme: "ui", apmInstallSource: { type: "git" } }],
        core: [],
        dev: [],
      });

      expect(packages.installed.map(({ name }) => name)).toEqual([
        "manual-theme",
        "repository-theme",
      ]);
    });

    it("treats packages with a `themes` array as themes", function () {
      const packages = panel.filterThemes({
        user: [],
        git: [],
        core: [
          {
            name: "multi-theme",
            themes: [
              { name: "multi-theme-ui", theme: "ui" },
              { name: "multi-theme-syntax", theme: "syntax" },
            ],
          },
          { name: "not-a-theme", version: "1.0.0" },
          { name: "empty-themes", themes: [] },
        ],
        dev: [],
      });

      expect(packages.core.map(({ name }) => name)).toEqual(["multi-theme"]);
    });

    it("filters themes by name", async () => {
      panel.refs.filterEditor.setText("user-");
      await wait(panel.refs.filterEditor.getBuffer().stoppedChangingDelay);
      expect(panel.refs.installedCount.textContent.trim()).toBe("1/1");
      expect(
        panel.refs.installedPackages.querySelectorAll(".package-card:not(.hidden)").length,
      ).toBe(1);

      expect(panel.refs.coreCount.textContent.trim()).toBe("0/1");
      expect(panel.refs.corePackages.querySelectorAll(".package-card:not(.hidden)").length).toBe(0);

      expect(panel.refs.devCount.textContent.trim()).toBe("0/1");
      expect(panel.refs.devPackages.querySelectorAll(".package-card:not(.hidden)").length).toBe(0);
    });

    it("adds newly installed themes to the list", async () => {
      // installGitHubPackage now loads the freshly installed package itself (via
      // its afterSwap hook → activateInstalledPackage); mirror that here so the
      // new theme shows up the next time the panel reads getInstalled().
      spyOn(packageManager, "installGitHubPackage").and.callFake((pack) => {
        packageManager.activateInstalledPackage(pack.name, { theme: "ui" });
        return Promise.resolve({ name: pack.name, theme: "ui" });
      });
      spyOn(lumine.packages, "loadPackage").and.callFake((name) =>
        installed.user.push({ name, theme: "ui" }),
      );

      expect(panel.refs.installedCount.textContent.trim()).toBe("1");
      expect(
        panel.refs.installedPackages.querySelectorAll(".package-card:not(.hidden)").length,
      ).toBe(1);

      packageManager.install({ name: "another-user-theme", theme: "ui" });

      await conditionPromise(() => panel.refs.installedCount.textContent.trim() === "2");
      expect(
        panel.refs.installedPackages.querySelectorAll(".package-card:not(.hidden)").length,
      ).toBe(2);
    });

    it("collapses/expands a sub-section if its header is clicked", function () {
      expect(panel.element.querySelectorAll(".sub-section-heading.has-items").length).toBe(3);
      panel.element
        .querySelector(".sub-section.installed-packages .sub-section-heading.has-items")
        .click();
      expect(panel.element.querySelector(".sub-section.installed-packages")).toHaveClass(
        "collapsed",
      );

      expect(panel.element.querySelector(".sub-section.core-packages")).not.toHaveClass(
        "collapsed",
      );
      expect(panel.element.querySelector(".sub-section.dev-packages")).not.toHaveClass("collapsed");

      panel.element
        .querySelector(".sub-section.installed-packages .sub-section-heading.has-items")
        .click();
      expect(panel.element.querySelector(".sub-section.installed-packages")).not.toHaveClass(
        "collapsed",
      );
    });

    it("can collapse and expand any of the sub-sections", function () {
      let heading;
      expect(panel.element.querySelectorAll(".sub-section-heading.has-items").length).toBe(3);

      for (heading of Array.from(
        panel.element.querySelectorAll(".sub-section-heading.has-items"),
      )) {
        heading.click();
      }
      expect(panel.element.querySelector(".sub-section.installed-packages")).toHaveClass(
        "collapsed",
      );
      expect(panel.element.querySelector(".sub-section.core-packages")).toHaveClass("collapsed");
      expect(panel.element.querySelector(".sub-section.dev-packages")).toHaveClass("collapsed");

      for (heading of Array.from(
        panel.element.querySelectorAll(".sub-section-heading.has-items"),
      )) {
        heading.click();
      }
      expect(panel.element.querySelector(".sub-section.installed-packages")).not.toHaveClass(
        "collapsed",
      );
      expect(panel.element.querySelector(".sub-section.core-packages")).not.toHaveClass(
        "collapsed",
      );
      expect(panel.element.querySelector(".sub-section.dev-packages")).not.toHaveClass("collapsed");
    });

    it("can collapse sub-sections when filtering", async () => {
      panel.refs.filterEditor.setText("user-");
      await wait(panel.refs.filterEditor.getBuffer().stoppedChangingDelay);

      const hasItems = panel.element.querySelectorAll(".sub-section-heading.has-items");
      expect(hasItems.length).toBe(1);
      expect(hasItems[0].textContent).toMatch(/^Installed Themes/);
    });
  });

  describe("when there are no themes", function () {
    beforeEach(async () => {
      const installed = {
        dev: [],
        user: [],
        core: [],
      };

      spyOn(packageManager, "loadCompatiblePackageVersion").and.callFake(function () {});
      spyOn(packageManager, "getInstalled").and.returnValue(Promise.resolve(installed));
      panel = new ThemesPanel(settingsView, packageManager);

      await conditionPromise(
        () =>
          packageManager.getInstalled.calls.count() === 1 &&
          panel.refs.installedCount.textContent.indexOf("…") < 0,
      );
    });

    afterEach(async () => {
      await Promise.resolve(lumine.themes.deactivateThemes());
    }); // Ensure works on promise and non-promise versions

    it("has a count of zero in all headings", function () {
      for (let heading of Array.from(panel.element.querySelector(".section-heading-count"))) {
        expect(heading.textContent).toMatch(/^0+$/);
      }
      expect(panel.element.querySelectorAll(".sub-section .icon-paintcan").length).toBe(3);
      expect(panel.element.querySelectorAll(".sub-section .icon-paintcan.has-items").length).toBe(
        0,
      );
    });

    it("can collapse and expand any of the sub-sections", function () {
      for (let heading of Array.from(panel.element.querySelectorAll(".sub-section-heading"))) {
        heading.click();
      }
      expect(panel.element.querySelector(".sub-section.installed-packages")).not.toHaveClass(
        "collapsed",
      );
      expect(panel.element.querySelector(".sub-section.core-packages")).not.toHaveClass(
        "collapsed",
      );
      expect(panel.element.querySelector(".sub-section.dev-packages")).not.toHaveClass("collapsed");
    });

    it("does not allow collapsing on any section when filtering", async () => {
      panel.refs.filterEditor.setText("user-");
      await wait(panel.refs.filterEditor.getBuffer().stoppedChangingDelay);

      for (let heading of Array.from(panel.element.querySelector(".section-heading-count"))) {
        expect(heading.textContent).toMatch(/^(0\/0)+$/);
      }
      expect(panel.element.querySelectorAll(".sub-section .icon-paintcan").length).toBe(3);
      expect(panel.element.querySelectorAll(".sub-section .icon-paintcan.has-items").length).toBe(
        0,
      );
    });
  });
});
