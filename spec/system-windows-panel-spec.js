const { WinShell } = require("lumine");
const SystemWindowsPanel = require("../lib/system-windows-panel");

const describeOnWindows = process.platform === "win32" ? describe : xdescribe;

describeOnWindows("SystemWindowsPanel", () => {
  let panel;

  afterEach(() => panel?.destroy());

  it("checks registry integrations sequentially after the first show", () => {
    const callbacks = [];
    const fileHandler = spyOn(WinShell.fileHandler, "isRegistered").and.callFake((callback) => {
      callbacks.push(callback);
    });
    const fileContextMenu = spyOn(WinShell.fileContextMenu, "isRegistered").and.callFake(
      (callback) => {
        callbacks.push(callback);
      },
    );
    const folderContextMenu = spyOn(WinShell.folderContextMenu, "isRegistered").and.callFake(
      (callback) => {
        callbacks.push(callback);
      },
    );

    panel = new SystemWindowsPanel();
    jasmine.attachToDOM(panel.element);

    expect(fileHandler).not.toHaveBeenCalled();
    expect(fileContextMenu).not.toHaveBeenCalled();
    expect(folderContextMenu).not.toHaveBeenCalled();
    expect(panel.refs.fileHandlerCheckbox.disabled).toBe(true);
    expect(panel.refs.fileContextMenuCheckbox.disabled).toBe(true);
    expect(panel.refs.folderContextMenuCheckbox.disabled).toBe(true);

    panel.show();
    expect(fileHandler).not.toHaveBeenCalled();
    cancelAnimationFrame(panel.registrationCheckFrame);
    panel.registrationCheckFrame = null;
    panel.runNextRegistrationCheck();
    expect(fileHandler).toHaveBeenCalledTimes(1);
    expect(fileContextMenu).not.toHaveBeenCalled();

    callbacks.shift()(true);
    clearTimeout(panel.registrationCheckTimer);
    panel.runNextRegistrationCheck();
    expect(fileContextMenu).toHaveBeenCalledTimes(1);
    expect(panel.refs.fileHandlerCheckbox).toBeChecked();
    expect(panel.refs.fileHandlerCheckbox.disabled).toBe(false);
    expect(folderContextMenu).not.toHaveBeenCalled();

    callbacks.shift()(false);
    clearTimeout(panel.registrationCheckTimer);
    panel.runNextRegistrationCheck();
    expect(folderContextMenu).toHaveBeenCalledTimes(1);
    expect(panel.refs.fileContextMenuCheckbox).not.toBeChecked();
    expect(panel.refs.fileContextMenuCheckbox.disabled).toBe(false);

    callbacks.shift()(true);
    clearTimeout(panel.registrationCheckTimer);
    panel.runNextRegistrationCheck();
    expect(panel.refs.folderContextMenuCheckbox).toBeChecked();
    expect(panel.refs.folderContextMenuCheckbox.disabled).toBe(false);
    expect(panel.element.hasAttribute("aria-busy")).toBe(false);
  });
});
