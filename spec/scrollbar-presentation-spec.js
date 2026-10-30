const path = require("node:path");

describe("Settings View scrollbar presentation", () => {
  let view;

  beforeEach(async () => {
    jasmine.useRealClock();
    jasmine.attachToDOM(lumine.workspace.getElement());
    const packageRoot = path.resolve(__dirname, "..");
    const loaded = lumine.packages.getLoadedPackage("settings-view");
    if (loaded && path.resolve(loaded.path) !== packageRoot)
      await lumine.packages.unloadPackage("settings-view");
    const pack = await lumine.packages.activatePackage(packageRoot);
    expect(path.resolve(pack.path)).toBe(packageRoot);
    view = await lumine.workspace.open("lumine://config/core");
    await conditionPromise(() => !!view.element.querySelector(".panels > .panels-item"));
  });

  afterEach(async () => {
    if (view && !view.destroyed) await view.destroy();
  });

  it("uses transient overlays without a separator or reserved gutter in the center", () => {
    expect(view.element.dataset.scrollbarKind).toBe("panel");
    const panels = view.element.querySelector(".panels > .panels-item");
    const controller = lumine.scrollbars.attach(panels);
    controller.write(controller.read());
    expect(controller.geometry.layout).toBe("overlay");
    expect(controller.layer.classList.contains("is-document")).toBeFalse();
    expect(controller.layer.classList.contains("is-persistent")).toBeFalse();
    expect(getComputedStyle(controller.vertical.element).boxShadow).toBe("none");
    expect(panels.offsetWidth - panels.clientWidth).toBe(0);
    const input = document.createElement("input");
    panels.appendChild(input);
    const before = panels.clientWidth;
    input.focus();
    controller.syncVisibility();
    expect(controller.layer.classList.contains("is-revealed")).toBeTrue();
    expect(panels.clientWidth).toBe(before);
    input.remove();
  });
});
