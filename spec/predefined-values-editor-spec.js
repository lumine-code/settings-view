const PredefinedValuesEditor = require("../lib/predefined-values-editor");

describe("PredefinedValuesEditor", () => {
  let editor;

  beforeEach(() => {
    editor = new PredefinedValuesEditor({
      text: ".source.js",
      placeholderText: "Enter a selector",
      values: [{ value: "", label: "Default" }, ".source.js", ".source.python"],
    });
  });

  afterEach(() => editor.destroy());

  it("renders a mini TextEditor backed by a native select", () => {
    expect(editor.editor.isMini()).toBe(true);
    expect(editor.getText()).toBe(".source.js");
    expect(editor.select).toHaveClass("form-control");
    expect(editor.select.selectedIndex).toBe(1);
  });

  it("opens the native picker from the arrow button", () => {
    spyOn(editor.select, "showPicker");
    editor.button.click();
    expect(editor.select.showPicker).toHaveBeenCalled();
  });

  it("writes a selected predefined value into the TextEditor and commits it", () => {
    const committed = jasmine.createSpy("committed");
    editor.onDidCommit(committed);
    editor.select.selectedIndex = 2;
    editor.select.dispatchEvent(new Event("change"));
    expect(editor.getText()).toBe(".source.python");
    expect(committed).toHaveBeenCalledWith(".source.python");
  });

  it("does not select an unrelated predefined value for custom text", () => {
    editor.setText(".custom.scope");
    expect(editor.select.selectedIndex).toBe(-1);
  });
});
