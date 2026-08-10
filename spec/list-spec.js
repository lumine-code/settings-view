const List = require("../lib/list");

describe("List", () => {
  let list = null;

  beforeEach(() => (list = new List("name")));

  it("emits add and remove events when setting items", () => {
    const addHandler = jasmine.createSpy();
    const removeHandler = jasmine.createSpy();
    list.onDidAddItem(addHandler);
    list.onDidRemoveItem(removeHandler);

    let items = [
      { name: "one", text: "a" },
      { name: "two", text: "b" },
    ];
    list.setItems(items);
    expect(addHandler.calls.count()).toBe(2);
    expect(removeHandler.calls.count()).toBe(0);

    addHandler.calls.reset();
    removeHandler.calls.reset();

    items = [
      { name: "three", text: "c" },
      { name: "two", text: "b" },
    ];
    list.setItems(items);
    expect(addHandler.calls.count()).toBe(1);
    expect(removeHandler.calls.count()).toBe(1);
    expect(addHandler.calls.mostRecent().args[0]).toEqual({ name: "three", text: "c" });
    expect(removeHandler.calls.mostRecent().args[0]).toEqual({ name: "one", text: "a" });
    expect(list.getItems()).toEqual(items);

    addHandler.calls.reset();
    removeHandler.calls.reset();
    items.push({ name: "four" });
    list.setItems(items);
    expect(addHandler.calls.count()).toBe(1);
  });
});
