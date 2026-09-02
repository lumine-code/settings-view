const EditorPanel = require("../lib/editor-panel");
const scopeContext = require("../lib/scope-context");
const { forElement: selectBoxForElement } = require("../lib/select-box");

describe("EditorPanel", function () {
  let panel = null;

  const getValueForId = function (id) {
    const element = panel.element.querySelector(`#${id.replace(/\./g, "\\.")}`);
    if (element?.tagName === "INPUT") {
      return element.checked;
    } else if (element?.getAttribute("role") === "combobox") {
      return selectBoxForElement(element).value;
    } else if (element != null) {
      return element.getModel().getText();
    } else {
      return;
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

  beforeEach(function () {
    scopeContext.set(null);
    lumine.config.set("editor.boolean", true);
    lumine.config.set("editor.string", "hey");
    lumine.config.set("editor.object", { boolean: true, int: 3, string: "test" });
    lumine.config.set("editor.simpleArray", ["a", "b", "c"]);
    lumine.config.set("editor.complexArray", ["a", "b", { c: true }]);

    lumine.config.setSchema("", { type: "object" });

    return (panel = new EditorPanel());
  });

  it("automatically binds named fields to their corresponding config keys", function () {
    expect(getValueForId("editor.boolean")).toBeTruthy();
    expect(getValueForId("editor.string")).toBe("hey");
    expect(getValueForId("editor.object.boolean")).toBeTruthy();
    expect(getValueForId("editor.object.int")).toBe("3");
    expect(getValueForId("editor.object.string")).toBe("test");

    lumine.config.set("editor.boolean", false);
    lumine.config.set("editor.string", "hey again");
    lumine.config.set("editor.object.boolean", false);
    lumine.config.set("editor.object.int", 6);
    lumine.config.set("editor.object.string", "hi");

    expect(getValueForId("editor.boolean")).toBeFalsy();
    expect(getValueForId("editor.string")).toBe("hey again");
    expect(getValueForId("editor.object.boolean")).toBeFalsy();
    expect(getValueForId("editor.object.int")).toBe("6");
    expect(getValueForId("editor.object.string")).toBe("hi");

    setValueForId("editor.string", "oh hi");
    setValueForId("editor.boolean", true);
    setValueForId("editor.object.boolean", true);
    setValueForId("editor.object.int", 9);
    setValueForId("editor.object.string", "yo");

    expect(lumine.config.get("editor.boolean")).toBe(true);
    expect(lumine.config.get("editor.string")).toBe("oh hi");
    expect(lumine.config.get("editor.object.boolean")).toBe(true);
    expect(lumine.config.get("editor.object.int")).toBe(9);
    expect(lumine.config.get("editor.object.string")).toBe("yo");

    setValueForId("editor.string", "");
    setValueForId("editor.object.int", "");
    setValueForId("editor.object.string", "");

    expect(lumine.config.get("editor.string")).toBeUndefined();
    expect(lumine.config.get("editor.object.int")).toBeUndefined();
    expect(lumine.config.get("editor.object.string")).toBeUndefined();
  });

  it("does not save the config value until it has been changed to a new value", function () {
    const observeHandler = jasmine.createSpy("observeHandler");
    lumine.config.observe("editor.simpleArray", observeHandler);
    observeHandler.calls.reset();

    window.advanceClock(10000); // wait for contents-modified to be triggered
    expect(observeHandler).not.toHaveBeenCalled();

    setValueForId("editor.simpleArray", 2);
    expect(observeHandler).toHaveBeenCalled();
    observeHandler.calls.reset();

    setValueForId("editor.simpleArray", 2);
    expect(observeHandler).not.toHaveBeenCalled();
  });

  it("does not update the editor text unless the value it parses to changes", function () {
    setValueForId("editor.simpleArray", "a, b,");
    expect(lumine.config.get("editor.simpleArray")).toEqual(["a", "b"]);
    expect(getValueForId("editor.simpleArray")).toBe("a, b,");
  });

  it("only adds editors for arrays when all the values in the array are strings", function () {
    expect(getValueForId("editor.simpleArray")).toBe("a, b, c");
    expect(getValueForId("editor.complexArray")).toBeUndefined();

    setValueForId("editor.simpleArray", "a, d");

    expect(lumine.config.get("editor.simpleArray")).toEqual(["a", "d"]);
    expect(lumine.config.get("editor.complexArray")).toEqual(["a", "b", { c: true }]);
  });

  it("hides technical metadata", function () {
    expect(panel.element.querySelector('[id="editor.nonWordCharacters"]')).toExist();
    expect(panel.element.querySelector('[id="editor.commentStart"]')).not.toExist();
    expect(panel.element.querySelector('[id="editor.commentDelimiters"]')).not.toExist();
  });
});
