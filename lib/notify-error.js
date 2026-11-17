// Surfaces a package-operation failure as an editor notification instead of an
// in-panel message. In-panel error boxes were easy to miss behind a scrolled
// panel or a different tab; a notification is always visible. This preserves
// what the old in-panel ErrorView showed: the failure message, stderr and stack,
// and the Windows "missing build tools" hint. Diagnostics are literal details;
// callers can provide a concise, authored Markdown title for their operation.
//
// Returns the error Notification so callers that re-run an operation can dismiss
// a stale one.
module.exports = function notifyPackageError(packageManager, error, fallbackMessage) {
  error = error || {};
  const message = fallbackMessage || "The package operation failed.";
  const options = { dismissable: true };
  const detail = [...new Set([error.message, error.stderr, error.stack].filter(Boolean))];
  if (detail.length) options.detail = detail.map(String).join("\n\n");
  const notification = lumine.notifications.addError(message, options);

  // A native-module build failure on Windows almost always means the C/C++
  // toolchain is missing; point the user at it, mirroring the old ErrorView.
  if (error.packageInstallError && process.platform === "win32" && packageManager) {
    packageManager.checkNativeBuildTools().catch(() => {
      lumine.notifications.addWarning("Compiler tools not found", {
        dismissable: true,
        description:
          "Packages that depend on modules containing C/C++ code will fail to " +
          "install. Please install Python and Visual Studio, then run " +
          "`lumine -p install --check` to test compiling a native module.",
      });
    });
  }

  return notification;
};
