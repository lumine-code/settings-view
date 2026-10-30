const path = require("node:path");

describe("Settings input theme roles", () => {
  it("lets a theme paint unchecked, checked and mixed setting checkboxes", () => {
    const sheets = ["settings-view.css", "ui-contract.css"].map((file) =>
      lumine.themes.requireStylesheet(path.join(__dirname, "../styles", file)),
    );
    const host = document.createElement("div");
    host.className = "settings-view";
    host.style.cssText =
      "--use-custom-controls:true;--background-color-selected:rgb(210,220,230);--accent-indicator-color:rgb(30,90,180);--accent-indicator-text-color:rgb(255,255,255)";
    const checkbox = document.createElement("input");
    checkbox.type = "checkbox";
    checkbox.className = "input-checkbox";
    host.appendChild(checkbox);
    jasmine.attachToDOM(host);
    try {
      for (const palette of [
        {
          name: "accent",
          off: "rgb(220, 225, 230)",
          on: "rgb(40, 100, 170)",
          mark: "rgb(245, 250, 255)",
        },
        {
          name: "neutral",
          off: "rgb(45, 50, 55)",
          on: "rgb(45, 50, 55)",
          mark: "rgb(215, 220, 225)",
        },
      ]) {
        // These ordinary theme selectors must not need Settings View's scope.
        const theme = lumine.styles.addStyleSheet(`
          .input-checkbox { background-color: ${palette.off}; transition: none; }
          .input-checkbox:checked, .input-checkbox:indeterminate { background-color: ${palette.on}; }
          .input-checkbox::before, .input-checkbox::after { background-color: ${palette.mark}; }
        `);
        try {
          for (const state of ["off", "on", "mixed"]) {
            checkbox.checked = state === "on";
            checkbox.indeterminate = state === "mixed";
            expect(getComputedStyle(checkbox).backgroundColor)
              .withContext(`${palette.name} ${state} background`)
              .toBe(state === "off" ? palette.off : palette.on);
            for (const pseudo of ["::before", "::after"]) {
              expect(getComputedStyle(checkbox, pseudo).backgroundColor)
                .withContext(`${palette.name} ${state} ${pseudo} mark`)
                .toBe(palette.mark);
            }
          }
        } finally {
          theme.dispose();
        }
      }
    } finally {
      host.remove();
      for (const sheet of sheets) sheet.dispose();
    }
  });

  it("preserves the intentional scope-resolution palette beside themed settings", () => {
    const sheets = ["settings-view.css", "ui-contract.css"].map((file) =>
      lumine.themes.requireStylesheet(path.join(__dirname, "../styles", file)),
    );
    const theme = lumine.styles.addStyleSheet(`
      .input-checkbox { background-color: rgb(45, 50, 55); transition: none; }
      .input-checkbox:checked { background-color: rgb(45, 50, 55); }
      .input-checkbox::before, .input-checkbox::after { background-color: rgb(215, 220, 225); }
    `);
    const host = document.createElement("div");
    host.className = "settings-view";
    host.style.cssText =
      "--use-custom-controls:true;--scope-resolution-grammar-color:rgb(40,120,80);--background-color-selected:rgb(220,225,230)";
    host.innerHTML =
      '<input class="input-checkbox scope-override-toggle scope-resolution-grammar" type="checkbox"><span></span>';
    jasmine.attachToDOM(host);
    try {
      const checkbox = host.querySelector("input");
      const probe = host.querySelector("span");
      probe.style.color =
        "color-mix(in srgb, var(--scope-resolution-grammar-color) 35%, var(--background-color-selected))";
      expect(getComputedStyle(checkbox).backgroundColor).toBe(getComputedStyle(probe).color);
      checkbox.checked = true;
      expect(getComputedStyle(checkbox).backgroundColor).toBe("rgb(40, 120, 80)");
      probe.style.color =
        "lch(from var(--scope-resolution-grammar-color) calc((49.44 - l) * infinity) 0 0)";
      for (const pseudo of ["::before", "::after"]) {
        expect(getComputedStyle(checkbox, pseudo).backgroundColor).toBe(
          getComputedStyle(probe).color,
        );
      }
    } finally {
      host.remove();
      theme.dispose();
      for (const sheet of sheets) sheet.dispose();
    }
  });

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
