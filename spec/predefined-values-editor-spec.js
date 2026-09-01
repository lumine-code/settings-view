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

  it("renders a mini TextEditor backed by the shared SelectBox", () => {
    expect(editor.editor.isMini()).toBe(true);
    expect(editor.getText()).toBe(".source.js");
    expect(editor.select.element).toHaveClass("select-box");
    expect(editor.button).not.toHaveClass("icon-chevron-down");
    expect(editor.button.querySelector(".select-box-arrow")).toExist();
    expect(editor.select.value).toBe(".source.js");
  });

  it("opens the shared picker from the arrow button", async () => {
    spyOn(editor.select, "open").and.callThrough();
    editor.button.click();
    await Promise.resolve();
    expect(editor.select.open).toHaveBeenCalled();
  });

  it("matches the popup width to the whole editor rather than the arrow button", async () => {
    document.body.appendChild(editor.element);
    spyOn(editor.element, "getBoundingClientRect").and.returnValue({
      left: 20,
      right: 220,
      top: 20,
      bottom: 50,
      width: 200,
      height: 30,
    });
    await editor.openPicker();
    expect(document.querySelector(".select-box-list").style.width).toBe("200px");
  });

  it("writes a selected predefined value into the TextEditor and commits it", () => {
    const committed = jasmine.createSpy("committed");
    editor.onDidCommit(committed);
    editor.select.setValue(".source.python", { emit: true });
    expect(editor.getText()).toBe(".source.python");
    expect(committed).toHaveBeenCalledWith(".source.python");
  });

  it("does not select an unrelated predefined value for custom text", () => {
    editor.setText(".custom.scope");
    expect(editor.select.value).toBe(".custom.scope");
    expect(editor.select.items.find((item) => item.value === ".custom.scope").disabled).toBe(true);
  });
});
