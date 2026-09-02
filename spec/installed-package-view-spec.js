/*
 * decaffeinate suggestions:
 * DS101: Remove unnecessary use of Array.from
 * DS102: Remove unnecessary code created because of implicit returns
 * DS104: Avoid inline assignments
 * DS207: Consider shorter variations of null checks
 * Full docs: https://github.com/decaffeinate/decaffeinate/blob/master/docs/suggestions.md
 */

const path = require("path");
const PackageDetailView = require("../lib/package-detail-view");
const PackageManager = require("../lib/package-manager");
const SettingsView = require("../lib/settings-view");
const PackageKeymapView = require("../lib/package-keymap-view");
const PackageSnippetsView = require("../lib/package-snippets-view");
const _ = require("@lumine-code/underscore-plus");

let SnippetsProvider = {
  getSnippets() {
    return lumine.config.scopedSettingsStore.propertySets;
  },
};

describe("InstalledPackageView", function () {
  let packageCard;
  beforeEach(() => {
    spyOn(PackageManager.prototype, "loadCompatiblePackageVersion").and.callFake(() => {});
  });

  it("displays the grammars registered by the package", async () => {
    await lumine.packages.activatePackage(path.join(__dirname, "fixtures", "language-test"));

    const pack = lumine.packages.getActivePackage("language-test");
    spyOn(lumine.grammars, "getGrammars").and.returnValue([
      {
        name: "A Grammar",
        scopeName: "source.a",
        type: "tree-sitter",
        packageName: pack.name,
        fileTypes: [".a", ".aa", "a"],
      },
      {
        name: "B Grammar",
        scopeName: "source.b",
        type: "tree-sitter",
        packageName: pack.name,
      },
      {
        scopeName: "source.c",
        type: "tree-sitter",
        packageName: pack.name,
      },
    ]);
    const view = new PackageDetailView(
      pack,
      new SettingsView(),
      new PackageManager(),
      SnippetsProvider,
    );
    const settingsPanels = view.element.querySelectorAll(".package-grammars .settings-panel");

    await conditionPromise(
      () => Array.from(settingsPanels).reduce((total, s) => total + s.children.length, 0) === 2,
      "both grammar panels to render",
    );

    expect(settingsPanels[0].querySelector(".grammar-scope").textContent).toBe("Scope: source.a");
    expect(settingsPanels[0].querySelector(".grammar-filetypes").textContent).toBe(
      "File Types: .a, .aa, a",
    );

    expect(settingsPanels[1].querySelector(".grammar-scope").textContent).toBe("Scope: source.b");
    expect(settingsPanels[1].querySelector(".grammar-filetypes").textContent).toBe("File Types: ");

    expect(settingsPanels[2]).toBeUndefined();
  });

  it("displays the snippets registered by the package", async () => {
    let snippetsTable = null;
    let snippetsModule = null;

    // Relies on behavior not present in the snippets package before 1.103.
    const shouldRunScopeTest = parseFloat(lumine.application.getVersion()) >= 1.103;

    await lumine.packages.activatePackage(path.join(__dirname, "fixtures", "language-test"));

    const p = await lumine.packages.activatePackage("snippets");
    snippetsModule = p.mainModule;
    if (snippetsModule.provideSnippets().getUnparsedSnippets == null) {
      return;
    }

    SnippetsProvider = {
      getSnippets() {
        return snippetsModule.provideSnippets().getUnparsedSnippets();
      },
    };

    await conditionPromise(() => {
      return snippetsModule.provideSnippets().bundledSnippetsLoaded();
    }, "snippets to load");

    const pack = lumine.packages.getActivePackage("language-test");
    const view = new PackageDetailView(
      pack,
      new SettingsView(),
      new PackageManager(),
      SnippetsProvider,
    );
    snippetsTable = view.element.querySelector(".package-snippets-table tbody");

    await conditionPromise(() => {
      return snippetsTable.children.length >= 2;
    }, "snippets table children to contain 2 items");

    expect(snippetsTable.querySelector("tr:nth-child(1) td:nth-child(1)").textContent).toBe("b");
    if (shouldRunScopeTest) {
      expect(snippetsTable.querySelector("tr:nth-child(1) td:nth-child(2)").textContent).toBe(
        "language-test:sample-command",
      );
    }
    expect(snippetsTable.querySelector("tr:nth-child(1) td:nth-child(3)").textContent).toBe("BAR");

    if (shouldRunScopeTest) {
      expect(snippetsTable.querySelector("tr:nth-child(1) td.snippet-scope-name").textContent).toBe(
        ".source.b",
      );
    }

    expect(snippetsTable.querySelector("tr:nth-child(2) td:nth-child(1)").textContent).toBe("f");

    //if (shouldRunScopeTest) { # TODO FIX
    //  expect(
    //    snippetsTable.querySelector('tr:nth-child(1) td:nth-child(2)').textContent
    //  ).toBe('');
    //}
    expect(snippetsTable.querySelector("tr:nth-child(2) td:nth-child(3)").textContent).toBe("FOO");

    if (shouldRunScopeTest) {
      expect(snippetsTable.querySelector("tr:nth-child(2) td.snippet-scope-name").textContent).toBe(
        ".source.a, .source.aa",
      );
    }
  });

  describe("when a snippet body is viewed", () =>
    it("shows a tooltip", async () => {
      let view;
      let snippetsTable = null;
      let snippetsModule = null;

      await lumine.packages.activatePackage(path.join(__dirname, "fixtures", "language-test"));

      const p = await lumine.packages.activatePackage("snippets");
      snippetsModule = p.mainModule;
      if (snippetsModule.provideSnippets().getUnparsedSnippets == null) {
        return;
      }

      SnippetsProvider = {
        getSnippets() {
          return snippetsModule.provideSnippets().getUnparsedSnippets();
        },
      };

      await conditionPromise(() => {
        return snippetsModule.provideSnippets().bundledSnippetsLoaded();
      }, "snippets to load");

      const pack = lumine.packages.getActivePackage("language-test");
      view = new PackageDetailView(
        pack,
        new SettingsView(),
        new PackageManager(),
        SnippetsProvider,
      );
      snippetsTable = view.element.querySelector(".package-snippets-table tbody");

      await conditionPromise(
        () => snippetsTable.children.length >= 2,
        "snippets table children to contain 2 items",
      );

      expect(view.element.ownerDocument.querySelector(".snippet-body-tooltip")).not.toExist();

      view.element
        .querySelector(
          ".package-snippets-table tbody tr:nth-child(1) td.snippet-body .snippet-view-btn",
        )
        .click();

      expect(view.element.ownerDocument.querySelector(".snippet-body-tooltip")).toExist();
    }));

  // Relies on behavior not present in the snippets package before 1.33.
  // TODO: These tests should always run once 1.33 is released.
  if (parseFloat(lumine.application.getVersion()) >= 1.33) {
    describe("when a snippet is copied", () => {
      let pack, card;
      let snippetsTable = null;
      let snippetsModule = null;

      beforeEach(async () => {
        await lumine.packages.activatePackage(path.join(__dirname, "fixtures", "language-test"));

        const p = await lumine.packages.activatePackage("snippets");
        snippetsModule = p.mainModule;
        if (snippetsModule.provideSnippets().getUnparsedSnippets == null) {
          return;
        }

        SnippetsProvider = {
          getSnippets() {
            return snippetsModule.provideSnippets().getUnparsedSnippets();
          },
          getUserSnippetsPath: () => snippetsModule.getUserSnippetsPath(),
        };

        await conditionPromise(() => {
          return snippetsModule.provideSnippets().bundledSnippetsLoaded();
        }, "snippets to load");

        pack = lumine.packages.getActivePackage("language-test");
        card = new PackageSnippetsView(pack, SnippetsProvider);
        snippetsTable = card.element.querySelector(".package-snippets-table tbody");

        await conditionPromise(
          () => snippetsTable.children.length >= 2,
          "snippets table children to contain 2 items",
        );
      });

      describe("when the snippets file ends in .cson", () =>
        it("writes a CSON snippet to the clipboard", () => {
          spyOn(SnippetsProvider, "getUserSnippetsPath").and.returnValue("snippets.cson");
          card.element
            .querySelector(
              ".package-snippets-table tbody tr:nth-child(1) td.snippet-body .snippet-copy-btn",
            )
            .click();
          expect(lumine.clipboard.read().replace(/\r\n/g, "\n")).toBe(`\
\n'.b.source':
  'BAR':
    'prefix': 'b'
    'body': 'bar?\\nline two'\n\
`);
        }));

      describe("when the snippets file ends in .json", () =>
        it("writes a JSON snippet to the clipboard", () => {
          spyOn(SnippetsProvider, "getUserSnippetsPath").and.returnValue("snippets.json");
          card.element
            .querySelector(
              ".package-snippets-table tbody tr:nth-child(1) td.snippet-body .btn:nth-child(2)",
            )
            .click();
          expect(lumine.clipboard.read().replace(/\r\n/g, "\n")).toBe(`\
\n  ".b.source": {
    "BAR": {
      "prefix": "b",
      "body": "bar?\\nline two"
    }
  }\n\
`);
        }));
    });
  }

  describe("when the snippets toggle is clicked", () =>
    it("sets the packagesWithSnippetsDisabled config to include the package name", async () => {
      await lumine.packages.activatePackage(path.join(__dirname, "fixtures", "language-test"));

      const { mainModule: snippetsModule } = await lumine.packages.activatePackage("snippets");
      SnippetsProvider = {
        getSnippets() {
          return snippetsModule.provideSnippets().getUnparsedSnippets();
        },
      };

      await conditionPromise(
        () => snippetsModule.provideSnippets().bundledSnippetsLoaded(),
        "the bundled snippets to load",
      );

      const pack = lumine.packages.getActivePackage("language-test");
      const card = new PackageSnippetsView(pack, SnippetsProvider);
      jasmine.attachToDOM(card.element);

      const disabledPackages = () => lumine.config.get("core.packagesWithSnippetsDisabled") || [];

      card.refs.snippetToggle.click();
      expect(card.refs.snippetToggle.checked).toBe(false);
      expect(_.include(disabledPackages(), "language-test")).toBe(true);

      await conditionPromise(
        () => card.refs.snippets.classList.contains("text-subtle"),
        "the snippets table to dim",
      );

      card.refs.snippetToggle.click();
      expect(card.refs.snippetToggle.checked).toBe(true);
      expect(_.include(disabledPackages(), "language-test")).toBe(false);

      await conditionPromise(
        () => !card.refs.snippets.classList.contains("text-subtle"),
        "the snippets table to undim",
      );
    }));

  it("does not display keybindings from other platforms", async () => {
    let keybindingsTable;
    await lumine.packages.activatePackage(path.join(__dirname, "fixtures", "language-test"));

    const pack = lumine.packages.getActivePackage("language-test");
    const view = new PackageDetailView(
      pack,
      new SettingsView(),
      new PackageManager(),
      SnippetsProvider,
    );
    keybindingsTable = view.element.querySelector(".package-keymap-table tbody");
    expect(keybindingsTable.children.length).toBe(1);
  });

  describe("when the keybindings toggle is clicked", () =>
    it("sets the packagesWithKeymapsDisabled config to include the package name", async () => {
      await lumine.packages.activatePackage(path.join(__dirname, "fixtures", "language-test"));

      let keybindingRows;
      const pack = lumine.packages.getActivePackage("language-test");
      const card = new PackageKeymapView(pack);
      jasmine.attachToDOM(card.element);

      card.refs.keybindingToggle.click();
      expect(card.refs.keybindingToggle.checked).toBe(false);
      let disabledKeymapsPackages = lumine.config.get("core.packagesWithKeymapsDisabled") || [];
      expect(_.include(disabledKeymapsPackages, "language-test")).toBe(true);

      if (lumine.keymaps.build) {
        keybindingRows = card.element.querySelectorAll(
          ".package-keymap-table tbody.text-subtle tr",
        );
        expect(keybindingRows.length).toBe(1);
      }

      card.refs.keybindingToggle.click();
      expect(card.refs.keybindingToggle.checked).toBe(true);
      disabledKeymapsPackages = lumine.config.get("core.packagesWithKeymapsDisabled") || [];

      expect(_.include(disabledKeymapsPackages, "language-test")).toBe(false);

      if (lumine.keymaps.build) {
        keybindingRows = card.element.querySelectorAll(".package-keymap-table tbody tr");
        expect(keybindingRows.length).toBe(1);
      }
    }));

  describe("when a keybinding is copied", () => {
    let [pack, card] = Array.from([]);

    beforeEach(async () => {
      await lumine.packages.activatePackage(path.join(__dirname, "fixtures", "language-test"));

      pack = lumine.packages.getActivePackage("language-test");
      card = new PackageKeymapView(pack);
    });

    describe("when the keybinding file ends in .cson", () =>
      it("writes a CSON snippet to the clipboard", () => {
        spyOn(lumine.keymaps, "getUserKeymapPath").and.returnValue("keymap.cson");
        card.element.querySelector(".copy-keybinding").click();
        expect(lumine.clipboard.read().replace(/\r\n/g, "\n")).toBe(`\
'test':
  'cmd-g': 'language-test:run'\
`);
      }));

    describe("when the keybinding file ends in .json", () => {
      it("writes a JSON snippet to the clipboard", () => {
        spyOn(lumine.keymaps, "getUserKeymapPath").and.returnValue("keymap.json");
        card.element.querySelector(".copy-keybinding").click();
        expect(lumine.clipboard.read().replace(/\r\n/g, "\n")).toBe(`\
"test": {
  "cmd-g": "language-test:run"
}\
`);
      });
    });
  });

  describe("when the package is active", () =>
    it("displays the correct enablement state", async () => {
      await lumine.packages.activatePackage("status-bar");

      expect(lumine.packages.isPackageActive("status-bar")).toBe(true);
      const pack = lumine.packages.getLoadedPackage("status-bar");
      const view = new PackageDetailView(
        pack,
        new SettingsView(),
        new PackageManager(),
        SnippetsProvider,
      );
      packageCard = view.element.querySelector(".package-card");

      // Trigger observeDisabledPackages() here
      // because it is not default in specs
      lumine.packages.observeDisabledPackages();
      lumine.packages.disablePackage("status-bar");
      expect(lumine.packages.isPackageDisabled("status-bar")).toBe(true);
      expect(packageCard.classList.contains("disabled")).toBe(true);
    }));

  describe("when the package is not active", () => {
    it("displays the correct enablement state", () => {
      lumine.packages.loadPackage("status-bar");
      expect(lumine.packages.isPackageActive("status-bar")).toBe(false);
      const pack = lumine.packages.getLoadedPackage("status-bar");
      const view = new PackageDetailView(
        pack,
        new SettingsView(),
        new PackageManager(),
        SnippetsProvider,
      );
      const packageCard = view.element.querySelector(".package-card");

      // Trigger observeDisabledPackages() here
      // because it is not default in specs
      lumine.packages.observeDisabledPackages();
      lumine.packages.disablePackage("status-bar");
      expect(lumine.packages.isPackageDisabled("status-bar")).toBe(true);
      expect(packageCard.classList.contains("disabled")).toBe(true);
    });

    it("still loads the config schema for the package", async () => {
      lumine.packages.loadPackage(path.join(__dirname, "fixtures", "package-with-config"));

      await conditionPromise(() => lumine.packages.isPackageLoaded("package-with-config") === true);

      expect(lumine.config.get("package-with-config.setting")).toBe(undefined);

      const pack = lumine.packages.getLoadedPackage("package-with-config");
      new PackageDetailView(pack, new SettingsView(), new PackageManager(), SnippetsProvider);

      expect(lumine.config.get("package-with-config.setting")).toBe("something");
    });
  });

  describe("when the package was not installed from lumine.io", () => {
    const normalizePackageDataReadmeError = "ERROR: No README data found!";

    it("still displays the Readme", async () => {
      lumine.packages.loadPackage(path.join(__dirname, "fixtures", "package-with-readme"));

      await conditionPromise(() => {
        return lumine.packages.isPackageLoaded("package-with-readme") === true;
      });

      const pack = lumine.packages.getLoadedPackage("package-with-readme");
      expect(pack.metadata.readme).toBe(normalizePackageDataReadmeError);

      const view = new PackageDetailView(
        pack,
        new SettingsView(),
        new PackageManager(),
        SnippetsProvider,
      );
      expect(view.refs.sections.querySelector(".package-readme").textContent).not.toBe(
        normalizePackageDataReadmeError,
      );
      expect(view.refs.sections.querySelector(".package-readme").textContent.trim()).toContain(
        "I am a Readme!",
      );
    });
  });
});
