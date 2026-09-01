const GeneralPanel = require("../lib/general-panel");
const scopeContext = require("../lib/scope-context");
const { forElement: selectBoxForElement } = require("../lib/select-box");

describe("GeneralPanel", () => {
  let panel = null;

  const getValueForId = function (id) {
    const element = panel.element.querySelector(`#${id.replace(/\./g, "\\.")}`);
    if (element.tagName === "INPUT") {
      return element.checked;
    } else if (element.getAttribute("role") === "combobox") {
      return selectBoxForElement(element).value;
    } else {
      return element.getModel().getText();
    }
  };

  const setValueForId = function (id, value) {
    const element = panel.element.querySelector(`#${id.replace(/\./g, "\\.")}`);
    if (element.tagName === "INPUT") {
      element.checked = value;
      return element.dispatchEvent(new Event("change", { bubbles: true }));
    } else if (element.getAttribute("role") === "combobox") {
      return selectBoxForElement(element).setValue(value, { emit: true });
    } else {
      element.getModel().setText(value?.toString());
      return window.advanceClock(10000); // wait for contents-modified to be triggered
    }
  };

  beforeEach(() => {
    scopeContext.set(null);
    lumine.config.set("core.enum", 4);
    lumine.config.set("core.int", 22);
    lumine.config.set("core.float", 0.1);

    lumine.config.setSchema("", { type: "object" });
    lumine.config.setSchema("core.enum", {
      type: "integer",
      default: 2,
      enum: [2, 4, 6, 8],
    });

    panel = new GeneralPanel();
  });

  it("automatically binds named fields to their corresponding config keys", () => {
    expect(getValueForId("core.enum")).toBe(4);
    expect(getValueForId("core.int")).toBe("22");
    expect(getValueForId("core.float")).toBe("0.1");

    lumine.config.set("core.enum", 6);
    lumine.config.set("core.int", 222);
    lumine.config.set("core.float", 0.11);

    expect(getValueForId("core.enum")).toBe(6);
    expect(getValueForId("core.int")).toBe("222");
    expect(getValueForId("core.float")).toBe("0.11");

    setValueForId("core.enum", 2);
    setValueForId("core.int", 90);
    setValueForId("core.float", 89.2);

    expect(lumine.config.get("core.enum")).toBe(2);
    expect(lumine.config.get("core.int")).toBe(90);
    expect(lumine.config.get("core.float")).toBe(89.2);

    setValueForId("core.int", "");
    setValueForId("core.float", "");

    expect(lumine.config.get("core.int")).toBeUndefined();
    expect(lumine.config.get("core.float")).toBeUndefined();
  });

  it("matches config SelectBox popup font sizes to their triggers", () => {
    const selectElement = panel.element.querySelector('[id="core.enum"]');
    const selectBox = selectBoxForElement(selectElement);

    expect(selectElement.classList).toContain("form-control");
    expect(selectBox.options.matchTriggerFontSize).toBe(true);
  });

  it("does not save the config value until it has been changed to a new value", () => {
    const observeHandler = jasmine.createSpy("observeHandler");
    lumine.config.observe("core.int", observeHandler);
    observeHandler.calls.reset();

    window.advanceClock(10000); // wait for contents-modified to be triggered
    expect(observeHandler).not.toHaveBeenCalled();

    setValueForId("core.int", 2);
    expect(observeHandler).toHaveBeenCalled();
    observeHandler.calls.reset();

    setValueForId("core.int", 2);
    expect(observeHandler).not.toHaveBeenCalled();
  });

  it("does not update the editor text unless the value it parses to changes", () => {
    setValueForId("core.int", "2.");
    expect(lumine.config.get("core.int")).toBe(2);
    expect(getValueForId("core.int")).toBe("2.");
  });
});
