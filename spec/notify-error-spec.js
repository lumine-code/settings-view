const notifyPackageError = require("../lib/notify-error");

describe("package error notifications", () => {
  beforeEach(() => spyOn(lumine.notifications, "addError"));

  it("keeps an authored heading and preserves every diagnostic as literal detail", () => {
    const diagnostic = String.raw`Cannot read C:\data\[project]\_cache_\package.json`;
    const error = {
      message: diagnostic,
      stderr: "<b>literal stderr</b>",
      stack: `${diagnostic}\n    at package installation`,
    };
    notifyPackageError(null, error, "Unable to update **tree-view**");
    expect(lumine.notifications.addError).toHaveBeenCalledOnceWith(
      "Unable to update **tree-view**",
      {
        detail: `${error.message}\n\n${error.stderr}\n\n${error.stack}`,
        dismissable: true,
      },
    );
  });

  it("uses a concise default when only an error is available", () => {
    notifyPackageError(null, { message: "ENOENT", stderr: "ENOENT" });
    expect(lumine.notifications.addError).toHaveBeenCalledOnceWith(
      "The package operation failed.",
      { detail: "ENOENT", dismissable: true },
    );
  });

  it("can report a failure without diagnostics", () => {
    notifyPackageError(null, null, "Unable to load the package catalog.");
    expect(lumine.notifications.addError).toHaveBeenCalledOnceWith(
      "Unable to load the package catalog.",
      { dismissable: true },
    );
  });
});
