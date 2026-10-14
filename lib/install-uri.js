const requireCore = require("./require-core");

// Browser links may prepare the Install panel, never start an installation.
module.exports = function installSource(value) {
  if (typeof value !== "string" || !value.trim() || value.length > 2048) return null;
  try {
    return requireCore("package-source").assertSafeCatalogPackageSource(value).source;
  } catch {
    return null;
  }
};
