describe("Settings command scopes", () => {
  jasmine.itWithDocumentFocus(
    "navigates actual README and documentation content through its owning panel",
    async () => {
      jasmine.useRealClock();
      const path = require("node:path");
      const { ipcRenderer } = require("electron");
      const PackageDetailView = require("../lib/package-detail-view");
      const PackageDocsView = require("../lib/package-docs-view");
      const PackageManager = require("../lib/package-manager");
      const SettingsView = require("../lib/settings-view");
      const settings = new SettingsView();
      const metadata = {
        name: "native-navigation-fixture",
        version: "1.0.0",
        engines: { lumine: "^1.0.0" },
        readme: "# Readme\n\n" + "Read-only package content.\n\n".repeat(80),
      };
      const panel = new PackageDetailView(
        { ...metadata, metadata },
        settings,
        new PackageManager(),
        { getSnippets: () => ({}) },
      );
      const docs = new PackageDocsView(path.join(__dirname, "fixtures", "package-with-docs"));
      panel.element.append(docs.element);
      panel.element.style.cssText =
        "position:fixed;left:-1000px;width:360px;height:140px;overflow:auto";
      jasmine.attachToDOM(panel.element);
      const reveal = spyOn(lumine.scrollbars, "reveal").and.callThrough();
      try {
        for (const content of [panel.readmeView.packageReadme, docs.packageDocs]) {
          panel.element.scrollTop = 0;
          content.focus({ preventScroll: true });
          reveal.calls.reset();
          for (const type of ["keyDown", "char", "keyUp"])
            await ipcRenderer.invoke("lumine:window", "sendInputEvent", { type, keyCode: "Down" });
          expect(panel.element.scrollTop).toBeGreaterThan(0);
          expect(reveal).toHaveBeenCalledOnceWith(panel.element);
        }
      } finally {
        docs.destroy();
        panel.destroy();
        settings.destroy();
      }
    },
  );

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
    const inner = spyOn(panel.element, "scrollTo").and.callThrough();
    const outer = spyOn(view.element, "scrollTo").and.callThrough();
    await lumine.commands.dispatch(panel.element, "core:move-down");
    expect(inner).toHaveBeenCalledTimes(1);
    expect(outer).not.toHaveBeenCalled();
    await pane.destroyItem(view);
  });
});
