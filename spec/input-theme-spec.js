const path = require("node:path");

describe("Settings input theme roles", () => {
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
