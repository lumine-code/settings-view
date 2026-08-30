const SettingsPanel = require("../lib/settings-panel");
const PredefinedValuesEditor = require("../lib/predefined-values-editor");
const scopeContext = require("../lib/scope-context");
const _ = require("@lumine-code/underscore-plus");

describe("SettingsPanel", () => {
  let settingsPanel = null;

  beforeEach(() => scopeContext.set(null));
  afterEach(() => scopeContext.set(null));

  describe("sorted settings", () => {
    beforeEach(() => {
      const config = {
        type: "object",
        properties: {
          bar: {
            title: "Bar",
            description: "The bar setting",
            type: "boolean",
            default: true,
          },
          haz: {
            title: "Haz",
            description: "The haz setting",
            type: "string",
            default: "haz",
          },
          zing: {
            title: "Zing",
            description: "The zing setting",
            type: "string",
            default: "zing",
            order: 1,
          },
          zang: {
            title: "Zang",
            description: "The baz setting",
            type: "string",
            default: "zang",
            order: 100,
          },
          enum: {
            title: "An enum",
            type: "string",
            default: "one",
            enum: [{ value: "one", description: "One" }, "Two"],
          },
          radio: {
            title: "An enum with radio buttons",
            radio: true,
            type: "string",
            default: "Two",
            enum: [{ value: "one", description: "One" }, "Two"],
          },
        },
      };
      lumine.config.setSchema("foo", config);
      lumine.config.setDefaults("foo", { gong: "gong" });
      expect(_.size(lumine.config.get("foo"))).toBe(7);
      settingsPanel = new SettingsPanel({ namespace: "foo", includeTitle: false });
    });

    it("sorts settings by order, then by schema definition order", () => {
      const settings = lumine.config.get("foo");
      expect(_.size(settings)).toBe(7);
      const sortedSettings = settingsPanel.sortSettings("foo", settings);
      // Explicit `order` wins first, then settings fall back to the order they
      // are declared in the schema (not alphabetical). `gong` has no schema
      // entry, so it sinks to the end.
      expect(sortedSettings[0]).toBe("zing");
      expect(sortedSettings[1]).toBe("zang");
      expect(sortedSettings[2]).toBe("bar");
      expect(sortedSettings[3]).toBe("haz");
      expect(sortedSettings[4]).toBe("enum");
      expect(sortedSettings[5]).toBe("radio");
      expect(sortedSettings[6]).toBe("gong");
    });

    it("gracefully deals with a null settings object", () => {
      const sortedSettings = settingsPanel.sortSettings("foo", null);
      expect(sortedSettings).not.toBeNull;
      expect(_.size(sortedSettings)).toBe(0);
    });

    it("presents enum options with their descriptions", () => {
      const select = settingsPanel.element.querySelector("#foo\\.enum");
      const pairs = Array.from(select.children).map((opt) => [opt.value, opt.innerText]);
      expect(pairs).toEqual([
        ["one", "One"],
        ["Two", "Two"],
      ]);
    });

    it("presents radio options with their descriptions", () => {
      const radio = settingsPanel.element.querySelector("#foo\\.radio");
      const options = (() => {
        const result = [];
        for (let label of Array.from(radio.querySelectorAll("label"))) {
          const button = label.querySelector('input[type=radio][name="foo.radio"]');
          result.push([button.id, button.value, label.innerText]);
        }
        return result;
      })();
      expect(options).toEqual([
        ["foo.radio[one]", "one", "One"],
        ["foo.radio[Two]", "Two", "Two"],
      ]);
    });
  });

  describe("hidden settings", () => {
    beforeEach(() => {
      lumine.config.setSchema("hidden-settings", {
        type: "object",
        properties: {
          visible: {
            title: "Visible",
            type: "boolean",
            default: true,
          },
          private: {
            title: "Private",
            type: "boolean",
            default: true,
            hidden: true,
          },
        },
      });
      settingsPanel = new SettingsPanel({ namespace: "hidden-settings", includeTitle: false });
    });

    afterEach(() => settingsPanel.destroy());

    it("keeps hidden values configurable without rendering their controls", () => {
      const visibleControl = settingsPanel.element.querySelector(
        '[data-setting-key="hidden-settings.visible"]',
      );
      const privateControl = settingsPanel.element.querySelector(
        '[data-setting-key="hidden-settings.private"]',
      );

      expect(lumine.config.get("hidden-settings.private")).toBe(true);
      expect(visibleControl).not.toBeNull();
      expect(privateControl).toBeNull();
    });
  });

  describe("copying a setting key", () => {
    beforeEach(() => {
      lumine.config.setSchema("kopy", {
        type: "object",
        properties: {
          flag: {
            title: "Flag",
            description: "A boolean, so its key sits inside the label",
            type: "boolean",
            default: false,
          },
          group: {
            title: "Group",
            description: "An object, so its key sits inside the collapsible heading",
            type: "object",
            properties: {
              nested: {
                title: "Nested",
                description: "The nested setting",
                type: "string",
                default: "nested",
              },
            },
          },
        },
      });
      settingsPanel = new SettingsPanel({ namespace: "kopy", includeTitle: false });
      jasmine.attachToDOM(settingsPanel.element);
      lumine.clipboard.write("");
    });

    afterEach(() => {
      settingsPanel.destroy();
    });

    const keyElementFor = (keyPath) =>
      Array.from(settingsPanel.element.querySelectorAll(".setting-key")).find(
        (element) => element.textContent === keyPath,
      );

    it("writes the key path to the clipboard and flashes the span", () => {
      const keyElement = keyElementFor("kopy.flag");
      keyElement.click();

      expect(lumine.clipboard.read()).toBe("kopy.flag");
      expect(keyElement.classList.contains("copied")).toBe(true);

      advanceClock(1200);
      expect(keyElement.classList.contains("copied")).toBe(false);
    });

    it("does not toggle the setting when the key belongs to a checkbox", () => {
      expect(lumine.config.get("kopy.flag")).toBe(false);

      keyElementFor("kopy.flag").click();

      expect(lumine.clipboard.read()).toBe("kopy.flag");
      expect(lumine.config.get("kopy.flag")).toBe(false);
    });

    it("does not collapse the group when the key belongs to a sub-section heading", () => {
      const section = settingsPanel.element.querySelector(".sub-section");
      expect(section.classList.contains("collapsed")).toBe(false);

      keyElementFor("kopy.group").click();

      expect(lumine.clipboard.read()).toBe("kopy.group");
      expect(section.classList.contains("collapsed")).toBe(false);
    });

    it("moves the flash to the most recently copied key", () => {
      const flag = keyElementFor("kopy.flag");
      const nested = keyElementFor("kopy.group.nested");

      flag.click();
      nested.click();

      expect(flag.classList.contains("copied")).toBe(false);
      expect(nested.classList.contains("copied")).toBe(true);
    });
  });

  describe("default settings", () => {
    beforeEach(() => {
      const config = {
        type: "object",
        properties: {
          haz: {
            name: "haz",
            title: "Haz",
            description: "The haz setting",
            type: "string",
            default: "haz",
          },
          qux: {
            name: "qux",
            title: "Qux",
            description: "The qux setting",
            type: "string",
            default: "a",
            enum: [
              { value: "a", description: "Alice" },
              { value: "b", description: "Bob" },
            ],
          },
          testZero: {
            name: "testZero",
            title: "Test Zero",
            description: "Setting for testing zero as a default",
            type: "integer",
            default: 0,
          },
          radio: {
            title: "An enum with radio buttons",
            radio: true,
            type: "string",
            default: "Two",
            enum: [{ value: "one", description: "One" }, "Two", "Three"],
          },
        },
      };
      lumine.config.setSchema("foo", config);
      lumine.config.setDefaults("foo", { gong: "gong" });
      expect(_.size(lumine.config.get("foo"))).toBe(5);
      settingsPanel = new SettingsPanel({ namespace: "foo", includeTitle: false });
    });

    it("ensures default stays default", () => {
      expect(settingsPanel.getDefault("foo.haz")).toBe("haz");
      expect(settingsPanel.isDefault("foo.haz")).toBe(true);
      settingsPanel.set("foo.haz", "haz");
      expect(settingsPanel.isDefault("foo.haz")).toBe(true);
    });

    it("can be overwritten", () => {
      expect(settingsPanel.getDefault("foo.haz")).toBe("haz");
      expect(settingsPanel.isDefault("foo.haz")).toBe(true);
      settingsPanel.set("foo.haz", "newhaz");
      expect(settingsPanel.isDefault("foo.haz")).toBe(false);
      expect(lumine.config.get("foo.haz")).toBe("newhaz");
    });

    it("ignores project-specific overrides", () => {
      lumine.project.replace({
        originPath: "TEST",
        config: {
          foo: {
            haz: "newhaz",
          },
        },
      });
      expect(settingsPanel.isDefault("foo.haz")).toBe(true);
      expect(lumine.config.get("foo.haz")).toBe("newhaz");
    });

    it("has a tooltip showing the default value", () => {
      const hazEditor = settingsPanel.element.querySelector('[id="foo.haz"]');
      const tooltips = lumine.tooltips.findTooltips(hazEditor);
      expect(tooltips).toHaveLength(1);
      const { title } = tooltips[0].options;
      expect(title()).toBe("Default: haz");
    });

    it("has a tooltip showing the description of the default value", () => {
      const quxEditor = settingsPanel.element.querySelector('[id="foo.qux"]');
      const tooltips = lumine.tooltips.findTooltips(quxEditor);
      expect(tooltips).toHaveLength(1);
      const { title } = tooltips[0].options;
      expect(title()).toBe("Default: Alice");
    });

    // Regression test for #783
    it("allows 0 to be a default", () => {
      const zeroEditor = settingsPanel.element.querySelector('[id="foo.testZero"]');
      expect(zeroEditor.getModel().getText()).toBe("");
      expect(zeroEditor.getModel().getPlaceholderText()).toBe("Default: 0");

      expect(settingsPanel.getDefault("foo.testZero")).toBe(0);
      expect(settingsPanel.isDefault("foo.testZero")).toBe(true);

      settingsPanel.set("foo.testZero", 15);
      expect(settingsPanel.isDefault("foo.testZero")).toBe(false);

      settingsPanel.set("foo.testZero", 0);
      expect(settingsPanel.isDefault("foo.testZero")).toBe(true);
    });

    it("selects the default choice for radio options", () => {
      expect(settingsPanel.getDefault("foo.radio")).toBe("Two");
      settingsPanel.set("foo.radio", "Two");
      expect(settingsPanel.element.querySelector("#foo\\.radio\\[Two\\]")).toBeChecked();
    });

    describe("scoped settings", () => {
      beforeEach(() => {
        const schema = {
          scopes: {
            ".source.python": {
              default: 4,
            },
          },
        };

        lumine.config.setScopedDefaultsFromSchema("editor.tabLength", schema);
        expect(lumine.config.get("editor.tabLength")).toBe(2);
      });

      it("displays the scoped default", () => {
        scopeContext.set(".source.python");
        settingsPanel = new SettingsPanel({
          namespace: "editor",
          includeTitle: false,
        });
        const tabLengthEditor = settingsPanel.element.querySelector('[id="editor.tabLength"]');
        expect(tabLengthEditor.getModel().getText()).toBe("");
        expect(tabLengthEditor.getModel().getPlaceholderText()).toBe("Default: 4");
      });

      it("allows the scoped setting to be changed to its normal default if the unscoped value is different", () => {
        lumine.config.set("editor.tabLength", 8);
        scopeContext.set(".source.js");

        settingsPanel = new SettingsPanel({
          namespace: "editor",
          includeTitle: false,
        });
        const tabLengthEditor = settingsPanel.element.querySelector('[id="editor.tabLength"]');
        expect(tabLengthEditor.getModel().getText()).toBe("");
        expect(tabLengthEditor.getModel().getPlaceholderText()).toBe("Default: 8");

        // This is the unscoped default, but it differs from the current unscoped value
        settingsPanel.set("editor.tabLength", 2);
        expect(tabLengthEditor.getModel().getText()).toBe("2");
        expect(lumine.config.get("editor.tabLength", { scope: ["source.js"] })).toBe(2);
      });

      it("allows the scoped setting to be changed to the unscoped default if it is different", () => {
        scopeContext.set(".source.python");
        settingsPanel = new SettingsPanel({
          namespace: "editor",
          includeTitle: false,
        });
        const tabLengthEditor = settingsPanel.element.querySelector('[id="editor.tabLength"]');
        expect(tabLengthEditor.getModel().getText()).toBe("");
        expect(tabLengthEditor.getModel().getPlaceholderText()).toBe("Default: 4");

        // This is the unscoped default, but it differs from the scoped default
        settingsPanel.set("editor.tabLength", 2);
        expect(tabLengthEditor.getModel().getText()).toBe("2");
        expect(lumine.config.get("editor.tabLength", { scope: ["source.python"] })).toBe(2);
      });
    });
  });

  describe("grouped settings", () => {
    beforeEach(() => {
      const config = {
        type: "object",
        properties: {
          barGroup: {
            type: "object",
            title: "Bar group",
            description: "description of bar group",
            properties: {
              bar: {
                title: "Bar",
                description: "The bar setting",
                type: "boolean",
                default: false,
              },
            },
          },
          bazGroup: {
            type: "object",
            collapsed: true,
            properties: {
              baz: {
                title: "Baz",
                description: "The baz setting",
                type: "boolean",
                default: false,
              },
            },
          },
          zing: {
            type: "string",
            default: "",
          },
        },
      };
      lumine.config.setSchema("foo", config);
      expect(_.size(lumine.config.get("foo"))).toBe(3);
      settingsPanel = new SettingsPanel({ namespace: "foo", includeTitle: false });
    });

    it("ensures that only grouped settings have a group title", () => {
      expect(
        settingsPanel.element.querySelectorAll(".section-container > .section-body"),
      ).toHaveLength(1);
      const controlGroups = settingsPanel.element.querySelectorAll(
        ".section-body > .control-group",
      );
      expect(controlGroups).toHaveLength(3);
      expect(controlGroups[0].querySelectorAll(".sub-section .sub-section-heading")).toHaveLength(
        1,
      );
      // The heading holds the title text node followed by a `.setting-key`
      // span with the key path, so compare only the title text node.
      expect(
        controlGroups[0].querySelector(".sub-section .sub-section-heading").childNodes[0]
          .textContent,
      ).toBe("Bar group");
      expect(controlGroups[0].querySelectorAll(".sub-section .sub-section-body")).toHaveLength(1);
      let subsectionBody = controlGroups[0].querySelector(".sub-section .sub-section-body");
      expect(subsectionBody.querySelectorAll(".control-group")).toHaveLength(1);
      expect(controlGroups[1].querySelectorAll(".sub-section .sub-section-heading")).toHaveLength(
        1,
      );
      expect(
        controlGroups[1].querySelector(".sub-section .sub-section-heading").childNodes[0]
          .textContent,
      ).toBe("Baz Group");
      expect(controlGroups[1].querySelectorAll(".sub-section .sub-section-body")).toHaveLength(1);
      subsectionBody = controlGroups[1].querySelector(".sub-section .sub-section-body");
      expect(subsectionBody.querySelectorAll(".control-group")).toHaveLength(1);
      expect(controlGroups[2].querySelectorAll(".sub-section")).toHaveLength(0);
      expect(controlGroups[2].querySelectorAll(".sub-section-heading")).toHaveLength(0);
    });

    it("ensures grouped settings are collapsable", () => {
      expect(
        settingsPanel.element.querySelectorAll(".section-container > .section-body"),
      ).toHaveLength(1);
      const controlGroups = settingsPanel.element.querySelectorAll(
        ".section-body > .control-group",
      );
      expect(controlGroups).toHaveLength(3);
      // Bar group
      expect(controlGroups[0].querySelectorAll(".sub-section .sub-section-heading")).toHaveLength(
        1,
      );
      expect(
        controlGroups[0]
          .querySelector(".sub-section .sub-section-heading")
          .classList.contains("has-items"),
      ).toBe(true);
      // Baz Group
      expect(controlGroups[1].querySelectorAll(".sub-section .sub-section-heading")).toHaveLength(
        1,
      );
      expect(
        controlGroups[1]
          .querySelector(".sub-section .sub-section-heading")
          .classList.contains("has-items"),
      ).toBe(true);
      // Should be already collapsed
      expect(
        controlGroups[1]
          .querySelector(".sub-section .sub-section-heading")
          .parentElement.classList.contains("collapsed"),
      ).toBe(true);
    });

    it("ensures grouped settings can have a description", () => {
      expect(
        settingsPanel.element.querySelectorAll(".section-container > .section-body"),
      ).toHaveLength(1);
      const controlGroups = settingsPanel.element.querySelectorAll(
        ".section-body > .control-group",
      );
      expect(controlGroups).toHaveLength(3);
      expect(controlGroups[0].querySelectorAll(".sub-section > .setting-description")).toHaveLength(
        1,
      );
      expect(
        controlGroups[0].querySelector(".sub-section > .setting-description").textContent,
      ).toBe("description of bar group");
    });
  });

  describe("settings validation", () => {
    beforeEach(() => {
      const config = {
        type: "object",
        properties: {
          minMax: {
            name: "minMax",
            title: "Min max",
            description: "The minMax setting",
            type: "integer",
            default: 10,
            minimum: 1,
            maximum: 100,
          },
          commaValueArray: {
            name: "commaValueArray",
            title: "Comma value in array",
            description: "An array with a comma value",
            type: "array",
            default: [],
          },
          numberArray: {
            name: "numberArray",
            title: "Number array",
            description: "An array of numbers",
            type: "array",
            items: { type: "integer" },
            default: [],
          },
        },
      };

      lumine.config.setSchema("foo", config);
      settingsPanel = new SettingsPanel({ namespace: "foo", includeTitle: false });
    });

    it("prevents setting a value below the minimum", () => {
      const minMaxEditor = settingsPanel.element.querySelector('[id="foo.minMax"]');
      minMaxEditor.getModel().setText("0");
      advanceClock(minMaxEditor.getModel().getBuffer().getStoppedChangingDelay());
      expect(minMaxEditor.getModel().getText()).toBe("1");

      minMaxEditor.getModel().setText("-5");
      advanceClock(minMaxEditor.getModel().getBuffer().getStoppedChangingDelay());
      expect(minMaxEditor.getModel().getText()).toBe("1");
    });

    it("prevents setting a value above the maximum", () => {
      const minMaxEditor = settingsPanel.element.querySelector('[id="foo.minMax"]');
      minMaxEditor.getModel().setText("1000");
      advanceClock(minMaxEditor.getModel().getBuffer().getStoppedChangingDelay());
      expect(minMaxEditor.getModel().getText()).toBe("100");

      minMaxEditor.getModel().setText("10000");
      advanceClock(minMaxEditor.getModel().getBuffer().getStoppedChangingDelay());
      expect(minMaxEditor.getModel().getText()).toBe("100");
    });

    it("prevents setting a value that cannot be coerced to the correct type", () => {
      const minMaxEditor = settingsPanel.element.querySelector('[id="foo.minMax"]');
      minMaxEditor.getModel().setText('"abcde"');
      advanceClock(minMaxEditor.getModel().getBuffer().getStoppedChangingDelay());
      expect(minMaxEditor.getModel().getText()).toBe(""); // aka default

      minMaxEditor.getModel().setText("15");
      advanceClock(minMaxEditor.getModel().getBuffer().getStoppedChangingDelay());
      expect(minMaxEditor.getModel().getText()).toBe("15");

      minMaxEditor.getModel().setText('"abcde"');
      advanceClock(minMaxEditor.getModel().getBuffer().getStoppedChangingDelay());
      expect(minMaxEditor.getModel().getText()).toBe("15");
    });

    it("allows setting a valid scoped value", () => {
      scopeContext.set(".source.js");
      settingsPanel = new SettingsPanel({
        namespace: "foo",
        includeTitle: false,
      });
      const toggle = settingsPanel.element.querySelector(
        '.scope-override-toggle[data-setting-key="foo.minMax"]',
      );
      toggle.checked = true;
      toggle.dispatchEvent(new Event("change"));
      settingsPanel.set("foo.minMax", 15);
      expect(lumine.config.get("foo.minMax", { scope: ["source.js"] })).toBe(15);
    });

    describe("commaValueArray", () => {
      it("comma in value is escaped", () => {
        const commaValueArrayEditor = settingsPanel.element.querySelector(
          '[id="foo.commaValueArray"]',
        );
        commaValueArrayEditor.getModel().setText("1, \\,, 2");
        advanceClock(commaValueArrayEditor.getModel().getBuffer().getStoppedChangingDelay());
        expect(lumine.config.get("foo.commaValueArray")).toEqual(["1", ",", "2"]);

        commaValueArrayEditor.getModel().setText("1\\, 2");
        advanceClock(commaValueArrayEditor.getModel().getBuffer().getStoppedChangingDelay());
        expect(lumine.config.get("foo.commaValueArray")).toEqual(["1, 2"]);

        commaValueArrayEditor.getModel().setText("1\\,");
        advanceClock(commaValueArrayEditor.getModel().getBuffer().getStoppedChangingDelay());
        expect(lumine.config.get("foo.commaValueArray")).toEqual(["1,"]);

        commaValueArrayEditor.getModel().setText("\\, 2");
        advanceClock(commaValueArrayEditor.getModel().getBuffer().getStoppedChangingDelay());
        expect(lumine.config.get("foo.commaValueArray")).toEqual([", 2"]);
      });

      it("renders an escaped comma", () => {
        const commaValueArrayEditor = settingsPanel.element.querySelector(
          '[id="foo.commaValueArray"]',
        );
        lumine.config.set("foo.commaValueArray", ["3", ",", "4"]);
        advanceClock(1000);
        expect(commaValueArrayEditor.getModel().getText()).toBe("3, \\,, 4");

        lumine.config.set("foo.commaValueArray", ["3, 4"]);
        advanceClock(1000);
        expect(commaValueArrayEditor.getModel().getText()).toBe("3\\, 4");

        lumine.config.set("foo.commaValueArray", ["3,"]);
        advanceClock(1000);
        expect(commaValueArrayEditor.getModel().getText()).toBe("3\\,");

        lumine.config.set("foo.commaValueArray", [", 4"]);
        advanceClock(1000);
        expect(commaValueArrayEditor.getModel().getText()).toBe("\\, 4");
      });
    });

    describe("numberArray", () => {
      // The field is only rendered for an array it can round-trip, and it was
      // rendered for an empty one whatever the item type. So a setting whose
      // items coerce to numbers appeared until it had a value, then vanished
      // from the page and could no longer be edited or cleared.
      it("stays on the page once it holds numbers", () => {
        lumine.config.set("foo.numberArray", [2307, 7016]);
        settingsPanel = new SettingsPanel({ namespace: "foo", includeTitle: false });
        const editor = settingsPanel.element.querySelector('[id="foo.numberArray"]');
        expect(editor).not.toBeNull();
        expect(editor.getModel().getText()).toBe("2307, 7016");
      });

      it("coerces what is typed back to numbers", () => {
        const editor = settingsPanel.element.querySelector('[id="foo.numberArray"]');
        editor.getModel().setText("2307, 7016");
        advanceClock(editor.getModel().getBuffer().getStoppedChangingDelay());
        expect(lumine.config.get("foo.numberArray")).toEqual([2307, 7016]);
      });
    });
  });

  describe("schema-less grouped settings", () => {
    beforeEach(() => {
      lumine.config.setSchema("schema-less-groups", { type: "object" });
      lumine.config.setDefaults("schema-less-groups", {
        codeLens: { enabled: false },
        semanticTokens: {},
      });
      settingsPanel = new SettingsPanel({
        namespace: "schema-less-groups",
        includeTitle: false,
      });
    });

    afterEach(() => settingsPanel.destroy());

    it("marks only the rendered leaves as scope-aware", () => {
      const objectGroup = settingsPanel.element.querySelector(
        '.control-group[data-setting-key="schema-less-groups.codeLens"]',
      );
      const leafGroup = settingsPanel.element.querySelector(
        '.control-group[data-setting-key="schema-less-groups.codeLens.enabled"]',
      );

      expect(objectGroup).not.toHaveClass("scope-has-toggle");
      expect(objectGroup.querySelector(":scope > .scope-resolution-indicator")).toBeNull();
      expect(leafGroup).toHaveClass("scope-has-toggle");
      expect(leafGroup.querySelector(":scope > .scope-resolution-indicator")).not.toBeNull();
      expect(
        settingsPanel.element.querySelector(
          '.control-group[data-setting-key="schema-less-groups.semanticTokens"]',
        ),
      ).toBeNull();
    });
  });

  describe("scope context transitions", () => {
    beforeEach(() => {
      lumine.config.setSchema("scope-transition", {
        type: "object",
        properties: {
          enabled: {
            type: "boolean",
            default: true,
            scopeResolution: "grammar",
          },
          tabLength: {
            type: "integer",
            default: 2,
            scopeResolution: "grammar",
          },
        },
      });
      lumine.config.setScopedDefaultsFromSchema("scope-transition.enabled", {
        scopes: {
          ".source.js": { default: false },
        },
      });
      lumine.config.setScopedDefaultsFromSchema("scope-transition.tabLength", {
        scopes: {
          ".source.js": { default: 4 },
        },
      });
      settingsPanel = new SettingsPanel({
        namespace: "scope-transition",
        includeTitle: false,
      });
    });

    afterEach(() => settingsPanel.destroy());

    it("switches between Default and a scope without rebuilding the panel", () => {
      const container = settingsPanel.element.querySelector(".section-container");
      const group = settingsPanel.element.querySelector(
        '.control-group[data-setting-key="scope-transition.enabled"]',
      );
      const value = settingsPanel.element.querySelector('[id="scope-transition.enabled"]');
      const toggle = group.querySelector(".scope-override-toggle");
      const indicator = group.querySelector(".scope-resolution-indicator");
      const tabLengthElement = settingsPanel.element.querySelector(
        '[id="scope-transition.tabLength"]',
      );
      const tabLengthEditor = tabLengthElement.getModel();
      const tabLengthTooltip = lumine.tooltips.findTooltips(tabLengthElement)[0];
      const indicatorTooltip = lumine.tooltips.findTooltips(indicator)[0];
      const pickerElement = settingsPanel.element.querySelector(".settings-scope-editor");
      const picker = PredefinedValuesEditor.forElement(pickerElement);
      const pickerModel = picker.editor;

      expect(toggle.hidden).toBe(true);
      expect(indicator.hidden).toBe(false);
      expect(indicator).toHaveClass("scope-resolution-grammar");
      expect(indicator.dataset.tooltip).toContain("Per grammar");
      expect(indicatorTooltip.options.title).toBe(indicator.dataset.tooltip);
      expect(value).toBeChecked();
      expect(value.disabled).toBe(false);
      expect(tabLengthEditor.getPlaceholderText()).toBe("Default: 2");
      expect(tabLengthEditor.isReadOnly()).toBe(false);
      expect(tabLengthTooltip.options.title()).toBe("Default: 2");

      picker.setText(".source.js");
      lumine.commands.dispatch(picker.editor.element, "core:confirm");

      expect(scopeContext.get()).toBe(".source.js");
      expect(settingsPanel.element.querySelector(".section-container")).toBe(container);
      expect(settingsPanel.element.querySelector(".settings-scope-editor")).toBe(pickerElement);
      expect(picker.editor).toBe(pickerModel);
      expect(pickerModel.isDestroyed()).toBe(false);
      expect(
        settingsPanel.element.querySelector(
          '.control-group[data-setting-key="scope-transition.enabled"]',
        ),
      ).toBe(group);
      expect(settingsPanel.element.querySelector('[id="scope-transition.enabled"]')).toBe(value);
      expect(settingsPanel.element.querySelector('[id="scope-transition.tabLength"]')).toBe(
        tabLengthElement,
      );
      expect(toggle.hidden).toBe(false);
      expect(indicator.hidden).toBe(true);
      expect(toggle).not.toBeChecked();
      expect(group).toHaveClass("scope-inherited");
      expect(value).not.toBeChecked();
      expect(value.disabled).toBe(true);
      expect(tabLengthEditor.getPlaceholderText()).toBe("Default: 4");
      expect(tabLengthEditor.isReadOnly()).toBe(true);
      expect(tabLengthTooltip.options.title()).toBe("Default: 4");

      picker.setText("*");
      lumine.commands.dispatch(picker.editor.element, "core:confirm");

      expect(scopeContext.get()).toBeNull();
      expect(picker.getText()).toBe("");
      expect(settingsPanel.element.querySelector(".section-container")).toBe(container);
      expect(settingsPanel.element.querySelector(".settings-scope-editor")).toBe(pickerElement);
      expect(settingsPanel.element.querySelector('[id="scope-transition.enabled"]')).toBe(value);
      expect(toggle.hidden).toBe(true);
      expect(indicator.hidden).toBe(false);
      expect(group).not.toHaveClass("scope-inherited");
      expect(value).toBeChecked();
      expect(value.disabled).toBe(false);
      expect(settingsPanel.element.querySelector('[id="scope-transition.tabLength"]')).toBe(
        tabLengthElement,
      );
      expect(tabLengthEditor.getPlaceholderText()).toBe("Default: 2");
      expect(tabLengthEditor.isReadOnly()).toBe(false);
      expect(tabLengthTooltip.options.title()).toBe("Default: 2");
    });
  });

  describe("scope overrides", () => {
    beforeEach(() => {
      lumine.config.setSchema("scope-test", {
        type: "object",
        properties: {
          enabled: {
            type: "boolean",
            default: true,
            scopeResolution: "grammar",
          },
        },
      });
      scopeContext.set(".source.js");
      settingsPanel = new SettingsPanel({ namespace: "scope-test", includeTitle: false });
    });

    afterEach(() => settingsPanel.destroy());

    it("shows inheritance and creates or removes an exact override", () => {
      let toggle = settingsPanel.element.querySelector(".scope-override-toggle");
      let value = settingsPanel.element.querySelector('[id="scope-test.enabled"]');
      const originalToggle = toggle;
      const originalValue = value;
      expect(toggle).not.toBeChecked();
      expect(toggle).toHaveClass("scope-resolution-grammar");
      expect(settingsPanel.element.querySelector(".scope-resolution-indicator").hidden).toBe(true);
      expect(toggle.dataset.tooltip).toContain("Per grammar");
      expect(value.disabled).toBe(true);
      expect(settingsPanel.element.textContent).not.toContain("Override in");
      expect(toggle.nextElementSibling).toHaveClass("controls");
      expect(toggle.parentElement.style.getPropertyValue("--scope-indent")).toBe("0px");

      toggle.checked = true;
      toggle.dispatchEvent(new Event("change"));
      expect(lumine.config.inspect("scope-test.enabled", { scopeSelector: ".source.js" })).toEqual(
        jasmine.objectContaining({ hasOverride: true, overrideValue: true }),
      );

      toggle = settingsPanel.element.querySelector(".scope-override-toggle");
      value = settingsPanel.element.querySelector('[id="scope-test.enabled"]');
      expect(toggle).toBe(originalToggle);
      expect(value).toBe(originalValue);
      expect(toggle).toBeChecked();
      expect(value.disabled).toBe(false);

      toggle.checked = false;
      toggle.dispatchEvent(new Event("change"));
      expect(
        lumine.config.inspect("scope-test.enabled", { scopeSelector: ".source.js" }).hasOverride,
      ).toBe(false);
    });
  });
});
