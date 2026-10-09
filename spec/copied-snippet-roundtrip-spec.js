const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

describe("Snippet Copy serialization", () => {
  let directory, temporaryRoot, view, entry, extension;

  beforeEach(async () => {
    jasmine.useRealClock();
    for (const method of ["openPath", "openExternal", "openApplication", "showItemInFolder"])
      spyOn(lumine.shell, method).and.returnValue(Promise.resolve());
    spyOn(lumine.application, "openWindow").and.returnValue(Promise.resolve());
    spyOn(lumine.clipboard, "write");
    temporaryRoot = fs.realpathSync.native(os.tmpdir());
    directory = fs.realpathSync.native(
      fs.mkdtempSync(path.join(temporaryRoot, "snippet-copy-roundtrip-")),
    );
    extension = ".json";
    entry = { name: "Fraction", selector: ".source.latex", prefix: "frac", body: "fraction" };
    await lumine.packages.activatePackage("snippets");
    await conditionPromise(
      () => lumine.packages.getLoadedPackage("snippets").mainModule.loaded,
      "current snippet generation load",
    );
    await lumine.packages.activatePackage("settings-view");
    const PackageSnippetsView = require("../lib/package-snippets-view");
    view = new PackageSnippetsView(
      { name: "owned-snippet-copy", path: directory },
      {
        getUserSnippetsPath: () => path.join(directory, `snippets${extension}`),
        getSnippets: () => [
          {
            name: path.join(directory, "snippets", "main.json"),
            properties: { snippets: { owned: entry } },
          },
        ],
      },
    );
    jasmine.attachToDOM(view.element);
    await conditionPromise(
      () => view.element.querySelector(".snippet-copy-btn"),
      "rendered native snippet Copy button",
    );
  });

  afterEach(async () => {
    await view?.destroy();
    const relative = path.relative(temporaryRoot, fs.realpathSync.native(directory));
    if (
      !relative ||
      path.isAbsolute(relative) ||
      relative === ".." ||
      relative.startsWith(`..${path.sep}`)
    )
      throw new Error("Unsafe snippet copy cleanup");
    fs.rmSync(directory, { recursive: true, force: true });
  });

  async function copy() {
    view.updateSnippetsView();
    await conditionPromise(
      () => view.element.querySelector(".snippet-copy-btn"),
      "current Copy button",
    );
    await new Promise((resolve) => setImmediate(resolve));
    view.element.querySelector(".snippet-copy-btn").click();
    expect(lumine.clipboard.write).toHaveBeenCalledTimes(1);
    const text = lumine.clipboard.write.calls.mostRecent().args[0];
    return extension === ".cson"
      ? require("@lumine-code/season").parse(text)
      : JSON.parse(`{${text}}`);
  }

  function expected() {
    return {
      [entry.selector]: {
        [entry.name]: {
          ...(entry.prefix ? { prefix: entry.prefix } : {}),
          ...(entry.command ? { command: entry.command } : {}),
          body: entry.body,
        },
      },
    };
  }

  it("copies an ordinary triggered snippet as a valid JSON property fragment", async () => {
    expect(await copy()).toEqual(expected());
  });

  it("preserves literal backslashes, quotes, tabs and names in JSON", async () => {
    entry = {
      name: "quote's \\\" name",
      selector: ".source.latex",
      prefix: '\\frac"',
      command: "insert\\snippet",
      body: '\\frac{${1:x}}{${2:y}}\n\t"quoted"',
    };
    expect(await copy()).toEqual(expected());
  });

  it("preserves literal backslashes and quoted fields in CSON", async () => {
    extension = ".cson";
    entry = {
      name: "quote's \\ name",
      selector: ".source.latex",
      prefix: "\\frac'",
      command: "insert'snippet",
      body: "\\frac{${1:x}}{${2:y}}\n\t'quoted'",
    };
    expect(await copy()).toEqual(expected());
  });
});
