const stopCommandPropagation = require("../lib/stop-command-propagation");

describe("Settings scrollbar navigation activity", () => {
  it("signals a handled panel command without observing arbitrary keyboard input", () => {
    const element = document.createElement("div");
    const move = jasmine.createSpy("move");
    const commands = stopCommandPropagation({ "core:move-down": move });
    const registration = lumine.commands.add(element, commands);
    const reveal = spyOn(lumine.scrollbars, "reveal");
    try {
      lumine.commands.dispatch(element, "core:move-down");
      expect(move).toHaveBeenCalledTimes(1);
      expect(reveal).toHaveBeenCalledOnceWith(element);
      reveal.calls.reset();
      element.dispatchEvent(new KeyboardEvent("keydown", { key: "q", bubbles: true }));
      lumine.commands.dispatch(element, "unrelated:unhandled");
      expect(reveal).not.toHaveBeenCalled();
    } finally {
      registration.dispose();
    }
  });
});
