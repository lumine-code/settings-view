const path = require("path");

const fs = require("@lumine-code/fs-plus");
const InstalledPackagesPanel = require("../lib/installed-packages-panel");
const PackageManager = require("../lib/package-manager");
const SettingsView = require("../lib/settings-view");

describe("InstalledPackagesPanel", function () {
  describe("when the packages are loading", () =>
    it("filters packages by name once they have loaded", async function () {
      const settingsView = new SettingsView();
      this.packageManager = new PackageManager();
      this.installed = JSON.parse(
        fs.readFileSync(path.join(__dirname, "fixtures", "installed.json")),
      );
      spyOn(this.packageManager, "getOutdated").and.returnValue(new Promise(function () {}));
      spyOn(this.packageManager, "loadCompatiblePackageVersion").and.callFake(function () {});
      spyOn(this.packageManager, "getInstalled").and.returnValue(Promise.resolve(this.installed));
      this.panel = new InstalledPackagesPanel(settingsView, this.packageManager);
      this.panel.refs.filterEditor.setText("user-");
      window.advanceClock(this.panel.refs.filterEditor.getBuffer().stoppedChangingDelay);

      await conditionPromise(() => {
        return (
          this.packageManager.getInstalled.calls.count() === 1 &&
          this.panel.refs.installedCount.textContent.indexOf("…") < 0
        );
      });

      expect(this.panel.refs.installedCount.textContent.trim()).toBe("1/1");
      expect(
        this.panel.refs.installedPackages.querySelectorAll(".package-card:not(.hidden)").length,
      ).toBe(1);

      expect(this.panel.refs.coreCount.textContent.trim()).toBe("0/1");
      expect(
        this.panel.refs.corePackages.querySelectorAll(".package-card:not(.hidden)").length,
      ).toBe(0);

      expect(this.panel.refs.devCount.textContent.trim()).toBe("0/1");
      expect(
        this.panel.refs.devPackages.querySelectorAll(".package-card:not(.hidden)").length,
      ).toBe(0);
    }));

  describe("when the packages have finished loading", function () {
    beforeEach(async function () {
      const settingsView = new SettingsView();
      this.packageManager = new PackageManager();
      this.installed = JSON.parse(
        fs.readFileSync(path.join(__dirname, "fixtures", "installed.json")),
      );
      spyOn(this.packageManager, "getOutdated").and.returnValue(new Promise(function () {}));
      spyOn(this.packageManager, "loadCompatiblePackageVersion").and.callFake(function () {});
      spyOn(this.packageManager, "getInstalled").and.returnValue(Promise.resolve(this.installed));
      this.panel = new InstalledPackagesPanel(settingsView, this.packageManager);

      await conditionPromise(() => {
        return (
          this.packageManager.getInstalled.calls.count() === 1 &&
          this.panel.refs.installedCount.textContent.indexOf("…") < 0
        );
      });
    });

    it("shows packages", function () {
      expect(this.panel.refs.installedCount.textContent.trim()).toBe("1");
      expect(
        this.panel.refs.installedPackages.querySelectorAll(".package-card:not(.hidden)").length,
      ).toBe(1);

      expect(this.panel.refs.coreCount.textContent.trim()).toBe("1");
      expect(
        this.panel.refs.corePackages.querySelectorAll(".package-card:not(.hidden)").length,
      ).toBe(1);

      expect(this.panel.refs.devCount.textContent.trim()).toBe("1");
      expect(
        this.panel.refs.devPackages.querySelectorAll(".package-card:not(.hidden)").length,
      ).toBe(1);
    });

    it("focuses the filter without laying out every package card", function () {
      const sections = [
        this.panel.refs.installedPackagesHeader.parentElement,
        this.panel.refs.corePackagesHeader.parentElement,
        this.panel.refs.devPackagesHeader.parentElement,
      ];
      const focus = spyOn(this.panel.refs.filterEditor.element, "focus").and.callFake(() => {
        expect(sections.every((section) => section.style.display === "none")).toBe(true);
      });

      this.panel.focus();

      expect(focus).toHaveBeenCalled();
      expect(sections.every((section) => section.style.display === "")).toBe(true);
    });

    it("adds a large initial package list in animation-frame batches", async function () {
      const list = jasmine.createSpyObj("list", ["getItems", "setItems"]);
      list.getItems.and.returnValue([]);
      this.panel.items.test = list;
      spyOn(InstalledPackagesPanel, "packageCardBatchSize").and.returnValue(2);
      const packages = [{ name: "one" }, { name: "two" }, { name: "three" }];

      const completion = this.panel.setPackageItems(
        "test",
        packages,
        this.panel.packageLoadGeneration,
      );

      expect(list.setItems.calls.mostRecent().args[0]).toEqual(packages.slice(0, 2));
      await completion;
      expect(list.setItems.calls.mostRecent().args[0]).toEqual(packages);
    });

    it("shows repository installs as installed packages", function () {
      const packages = this.panel.filterPackages({
        user: [{ name: "manual-package" }],
        git: [{ name: "repository-package", apmInstallSource: { type: "git" } }],
        core: [],
        dev: [],
      });

      expect(packages.installed.map(({ name }) => name)).toEqual([
        "manual-package",
        "repository-package",
      ]);
    });

    it("filters packages by name", function () {
      this.panel.refs.filterEditor.setText("user-");
      window.advanceClock(this.panel.refs.filterEditor.getBuffer().stoppedChangingDelay);
      expect(this.panel.refs.installedCount.textContent.trim()).toBe("1/1");
      expect(
        this.panel.refs.installedPackages.querySelectorAll(".package-card:not(.hidden)").length,
      ).toBe(1);

      expect(this.panel.refs.coreCount.textContent.trim()).toBe("0/1");
      expect(
        this.panel.refs.corePackages.querySelectorAll(".package-card:not(.hidden)").length,
      ).toBe(0);

      expect(this.panel.refs.devCount.textContent.trim()).toBe("0/1");
      expect(
        this.panel.refs.devPackages.querySelectorAll(".package-card:not(.hidden)").length,
      ).toBe(0);
    });

    it("adds newly installed packages to the list", async function () {
      expect(this.panel.refs.installedCount.textContent.trim()).toBe("1");
      expect(
        this.panel.refs.installedPackages.querySelectorAll(".package-card:not(.hidden)").length,
      ).toBe(1);

      this.installed.user.push({ name: "another-user-package" });
      this.packageManager.emitter.emit("package-installed", {
        pack: { name: "another-user-package" },
      });

      advanceClock(InstalledPackagesPanel.loadPackagesDelay());
      await timeoutPromise(1);
      expect(this.panel.refs.installedCount.textContent.trim()).toBe("2");
      expect(
        this.panel.refs.installedPackages.querySelectorAll(".package-card:not(.hidden)").length,
      ).toBe(2);
    });

    it("cancels a scheduled reload when destroyed", function () {
      this.packageManager.emitter.emit("package-installed", {
        pack: { name: "another-user-package" },
      });

      this.panel.destroy();
      advanceClock(InstalledPackagesPanel.loadPackagesDelay());

      expect(this.packageManager.getInstalled).toHaveBeenCalledTimes(1);
    });

    it("keeps uninstalled packages visible without rebuilding the list", async function () {
      expect(this.panel.refs.installedCount.textContent.trim()).toBe("1");
      expect(
        this.panel.refs.installedPackages.querySelectorAll(".package-card:not(.hidden)").length,
      ).toBe(1);

      spyOn(this.panel, "loadPackages").and.callThrough();
      this.installed.user = [];
      this.packageManager.emitter.emit("package-uninstalled", { pack: { name: "user-package" } });

      advanceClock(InstalledPackagesPanel.loadPackagesDelay());
      await timeoutPromise(1);
      // The list is not rebuilt; the card stays in place (the card itself
      // switches to the not-installed state).
      expect(this.panel.loadPackages).not.toHaveBeenCalled();
      expect(
        this.panel.refs.installedPackages.querySelectorAll(".package-card:not(.hidden)").length,
      ).toBe(1);
    });
  });

  describe("expanding and collapsing sub-sections", function () {
    beforeEach(async function () {
      const settingsView = new SettingsView();
      this.packageManager = new PackageManager();
      this.installed = JSON.parse(
        fs.readFileSync(path.join(__dirname, "fixtures", "installed.json")),
      );
      spyOn(this.packageManager, "getOutdated").and.returnValue(new Promise(function () {}));
      spyOn(this.packageManager, "loadCompatiblePackageVersion").and.callFake(function () {});
      spyOn(this.packageManager, "getInstalled").and.returnValue(Promise.resolve(this.installed));
      this.panel = new InstalledPackagesPanel(settingsView, this.packageManager);

      await conditionPromise(() => {
        return (
          this.packageManager.getInstalled.calls.count() === 1 &&
          this.panel.refs.installedCount.textContent.indexOf("…") < 0
        );
      });
    });

    it("collapses and expands a sub-section if its header is clicked", function () {
      this.panel.element
        .querySelector(".sub-section.installed-packages .sub-section-heading")
        .click();
      expect(this.panel.element.querySelector(".sub-section.installed-packages")).toHaveClass(
        "collapsed",
      );

      expect(this.panel.element.querySelector(".sub-section.core-packages")).not.toHaveClass(
        "collapsed",
      );
      expect(this.panel.element.querySelector(".sub-section.dev-packages")).not.toHaveClass(
        "collapsed",
      );

      this.panel.element
        .querySelector(".sub-section.installed-packages .sub-section-heading")
        .click();
      expect(this.panel.element.querySelector(".sub-section.installed-packages")).not.toHaveClass(
        "collapsed",
      );
    });

    it("can collapse and expand any of the sub-sections", function () {
      let element;
      expect(this.panel.element.querySelectorAll(".sub-section-heading.has-items").length).toBe(3);

      for (element of Array.from(
        this.panel.element.querySelectorAll(".sub-section-heading.has-items"),
      )) {
        element.click();
      }

      expect(this.panel.element.querySelector(".sub-section.installed-packages")).toHaveClass(
        "collapsed",
      );
      expect(this.panel.element.querySelector(".sub-section.core-packages")).toHaveClass(
        "collapsed",
      );
      expect(this.panel.element.querySelector(".sub-section.dev-packages")).toHaveClass(
        "collapsed",
      );

      for (element of Array.from(
        this.panel.element.querySelectorAll(".sub-section-heading.has-items"),
      )) {
        element.click();
      }

      expect(this.panel.element.querySelector(".sub-section.installed-packages")).not.toHaveClass(
        "collapsed",
      );
      expect(this.panel.element.querySelector(".sub-section.core-packages")).not.toHaveClass(
        "collapsed",
      );
      expect(this.panel.element.querySelector(".sub-section.dev-packages")).not.toHaveClass(
        "collapsed",
      );
    });

    it("can collapse sub-sections when filtering", function () {
      this.panel.refs.filterEditor.setText("user-");
      window.advanceClock(this.panel.refs.filterEditor.getBuffer().stoppedChangingDelay);

      const hasItems = this.panel.element.querySelectorAll(".sub-section-heading.has-items");
      expect(hasItems.length).toBe(1);
      expect(hasItems[0].textContent).toMatch(/Installed Packages/);
    });

    it("marks the sub-sections a filter empties, and unmarks them again", function () {
      this.panel.refs.filterEditor.setText("user-");
      window.advanceClock(this.panel.refs.filterEditor.getBuffer().stoppedChangingDelay);

      expect(this.panel.element.querySelector(".sub-section.installed-packages")).not.toHaveClass(
        "empty",
      );
      expect(this.panel.element.querySelector(".sub-section.core-packages")).toHaveClass("empty");
      expect(this.panel.element.querySelector(".sub-section.dev-packages")).toHaveClass("empty");

      this.panel.refs.filterEditor.setText("");
      window.advanceClock(this.panel.refs.filterEditor.getBuffer().stoppedChangingDelay);

      expect(this.panel.element.querySelector(".sub-section.core-packages")).not.toHaveClass(
        "empty",
      );
      expect(this.panel.element.querySelector(".sub-section.dev-packages")).not.toHaveClass(
        "empty",
      );
    });
  });

  describe("when there are no packages", function () {
    beforeEach(async function () {
      const settingsView = new SettingsView();
      this.packageManager = new PackageManager();
      this.installed = {
        dev: [],
        user: [],
        core: [],
      };
      spyOn(this.packageManager, "getOutdated").and.returnValue(new Promise(function () {}));
      spyOn(this.packageManager, "loadCompatiblePackageVersion").and.callFake(function () {});
      spyOn(this.packageManager, "getInstalled").and.returnValue(Promise.resolve(this.installed));
      this.panel = new InstalledPackagesPanel(settingsView, this.packageManager);

      await conditionPromise(() => {
        return (
          this.packageManager.getInstalled.calls.count() === 1 &&
          this.panel.refs.installedCount.textContent.indexOf("…") < 0
        );
      });
    });

    it("has a count of zero in all headings", function () {
      expect(this.panel.element.querySelector(".section-heading-count").textContent).toMatch(
        /^0+$/,
      );
      expect(this.panel.element.querySelectorAll(".sub-section .icon-package").length).toBe(3);
      expect(
        this.panel.element.querySelectorAll(".sub-section .icon-package.has-items").length,
      ).toBe(0);
    });

    it("marks every sub-section empty", function () {
      expect(this.panel.element.querySelector(".sub-section.installed-packages")).toHaveClass(
        "empty",
      );
      expect(this.panel.element.querySelector(".sub-section.core-packages")).toHaveClass("empty");
      expect(this.panel.element.querySelector(".sub-section.dev-packages")).toHaveClass("empty");
    });

    it("can not collapse and expand any of the sub-sections", function () {
      let element;
      for (element of Array.from(
        this.panel.element.querySelectorAll(".sub-section .icon-package"),
      )) {
        element.click();
      }

      expect(this.panel.element.querySelector(".sub-section.installed-packages")).not.toHaveClass(
        "collapsed",
      );
      expect(this.panel.element.querySelector(".sub-section.core-packages")).not.toHaveClass(
        "collapsed",
      );
      expect(this.panel.element.querySelector(".sub-section.dev-packages")).not.toHaveClass(
        "collapsed",
      );
    });

    it("does not allow collapsing on any section when filtering", function () {
      this.panel.refs.filterEditor.setText("user-");
      window.advanceClock(this.panel.refs.filterEditor.getBuffer().stoppedChangingDelay);

      expect(this.panel.element.querySelector(".section-heading-count").textContent).toMatch(
        /^(0\/0)+$/,
      );
      expect(this.panel.element.querySelectorAll(".sub-section .icon-package").length).toBe(3);
      expect(
        this.panel.element.querySelectorAll(".sub-section .icon-paintcan.has-items").length,
      ).toBe(0);
    });
  });
});
