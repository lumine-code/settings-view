const {
  scopeResolutionDetailsForKeyPath,
  scopeResolutionForKeyPath,
} = require("../lib/scope-resolution");

describe("setting scope resolution", () => {
  beforeEach(() => {
    lumine.config.setSchema("resolution-test", {
      type: "object",
      properties: {
        globalValue: { type: "boolean", default: true },
        grammarValue: { type: "boolean", default: true, scopeResolution: "grammar" },
        syntaxGroup: {
          type: "object",
          scopeResolution: "syntax",
          properties: {
            nestedValue: { type: "string", default: "value" },
          },
        },
      },
    });
  });

  it("inherits the nearest declared resolution", () => {
    expect(scopeResolutionForKeyPath("resolution-test.globalValue")).toBe("base");
    expect(scopeResolutionForKeyPath("resolution-test.grammarValue")).toBe("grammar");
    expect(scopeResolutionForKeyPath("resolution-test.syntaxGroup.nestedValue")).toBe("syntax");
    expect(scopeResolutionForKeyPath("resolution-test.globalValue")).toBe("base");
  });

  it("describes the color and tooltip contract", () => {
    const details = scopeResolutionDetailsForKeyPath("resolution-test.grammarValue");
    expect(details.resolution).toBe("grammar");
    expect(details.label).toBe("Per grammar");
    expect(details.tooltip).toContain("grammar scope");
  });
});
