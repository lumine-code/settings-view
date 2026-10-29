const path = require("node:path");

describe("Settings input theme roles", () => {
  it("preserves theme keyboard rings on enum, version and predefined-value buttons", () => {
    const theme = lumine.styles.addStyleSheet(
      ".select-box:focus-visible { outline: 2px solid rgb(10, 20, 30); box-shadow: 0 0 0 2px rgb(40, 50, 60); }",
    );
    const sheets = ["settings-view.css", "catalog-sources.css"].map((file) =>
      lumine.themes.requireStylesheet(path.join(__dirname, "../styles", file)),
    );
    const host = document.createElement("div");
    host.className = "settings-view";
    host.innerHTML =
      '<input type="text"><button class="select-box form-control">Enum</button><button class="select-box package-version-select">Version</button><button class="select-box predefined-values-editor-button">Value</button>';
    jasmine.attachToDOM(host);
    try {
      host.querySelector("input").focus();
      for (const button of host.querySelectorAll("button")) {
        button.focus();
        expect(button.matches(":focus-visible")).toBe(true);
        const style = getComputedStyle(button);
        expect(style.outlineStyle).withContext(button.textContent).toBe("solid");
        expect(style.boxShadow).withContext(button.textContent).toContain("rgb(40, 50, 60)");
      }
    } finally {
      host.remove();
      for (const sheet of sheets) sheet.dispose();
      theme.dispose();
    }
  });

  it("keeps input text opaque and uses the theme's selection colors", () => {
    const sheet = lumine.themes.requireStylesheet(
      path.join(__dirname, "../styles/settings-view.css"),
    );
    const host = document.createElement("div");
    host.className = "settings-view";
    host.style.cssText =
      "--input-selection-color: rgb(30,40,50); --input-selection-color-focus: rgb(60,70,80);";
    host.innerHTML =
      '<div class="section"><lumine-text-editor mini><div class="selection"><div class="region"></div></div></lumine-text-editor></div>';
    jasmine.attachToDOM(host);
    try {
      const input = host.querySelector("lumine-text-editor");
      const selection = host.querySelector(".region");
      expect(getComputedStyle(input).opacity).toBe("1");
      expect(getComputedStyle(selection).backgroundColor).toBe("rgb(30, 40, 50)");
      input.classList.add("is-focused");
      expect(getComputedStyle(selection).backgroundColor).toBe("rgb(60, 70, 80)");
    } finally {
      host.remove();
      sheet.dispose();
    }
  });
});
