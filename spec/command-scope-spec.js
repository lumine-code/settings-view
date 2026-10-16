describe("Settings command scopes", () => {
  it("scrolls the focused panel without scrolling its Settings ancestor", async () => {
    jasmine.useRealClock();
    jasmine.attachToDOM(lumine.workspace.getElement());
    const pack = await lumine.packages.activatePackage("settings-view");
    lumine.config.set("settings-view.enableSettingsSearch", false);
    const view = pack.mainModule.createSettingsView({});
    const pane = lumine.workspace.getCenter().getActivePane();
    pane.addItem(view);
    pane.activateItem(view);
    view.initializePanels();
    view.showPanel("Editor");
    const panel = view.panelsByName.Editor;
    const inner = spyOn(panel, "scrollDown").and.stub();
    const outer = spyOn(view, "scrollDown").and.stub();
    await lumine.commands.dispatch(panel.element, "core:move-down");
    expect(inner).toHaveBeenCalledTimes(1);
    expect(outer).not.toHaveBeenCalled();
    await pane.destroyItem(view);
  });
});
