const stopCommandPropagation = require("../lib/stop-command-propagation");

describe("Settings scrollbar navigation activity", () => {
  it("signals owned viewport commands without observing arbitrary keyboard input", () => {
    const element = document.createElement("div");
    const registration = lumine.scrollbars.bindNavigation(element);
    const reveal = spyOn(lumine.scrollbars, "reveal");
    try {
      lumine.commands.dispatch(element, "core:move-down");
      expect(reveal).toHaveBeenCalledOnceWith(element);
      reveal.calls.reset();
      element.dispatchEvent(new KeyboardEvent("keydown", { key: "q", bubbles: true }));
      lumine.commands.dispatch(element, "unrelated:unhandled");
      expect(reveal).not.toHaveBeenCalled();
    } finally {
      registration.dispose();
      lumine.scrollbars.documents.get(document)?.controllers.get(element)?.dispose();
    }
  });

  it("keeps input picker commands outside scrollbar activity", () => {
    const element = document.createElement("div");
    const openPicker = jasmine.createSpy("open picker");
    const registration = lumine.commands.add(
      element,
      stopCommandPropagation({ "core:move-down": openPicker }),
    );
    const reveal = spyOn(lumine.scrollbars, "reveal");
    try {
      lumine.commands.dispatch(element, "core:move-down");
      expect(openPicker).toHaveBeenCalledTimes(1);
      expect(reveal).not.toHaveBeenCalled();
    } finally {
      registration.dispose();
    }
  });
});
