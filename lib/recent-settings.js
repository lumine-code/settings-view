// The settings most recently opened from the Search panel, newest first.
//
// The profile store outlives panels and package generations.
const MAX_RECENT_SETTINGS = 10;

let storage;

function normalize(paths) {
  return [
    ...new Set(
      (Array.isArray(paths) ? paths : []).filter((path) => typeof path === "string" && path),
    ),
  ].slice(0, MAX_RECENT_SETTINGS);
}

module.exports = {
  initialize(store) {
    storage = store;
  },
  // Move a key path to the front of the list, dropping any earlier visit to the
  // same setting so a path never appears twice.
  add(keyPath) {
    if (typeof keyPath !== "string" || !keyPath) return Promise.resolve();
    return storage.mutate("recentSettings", (paths) =>
      normalize([keyPath, ...normalize(paths).filter((path) => path !== keyPath)]),
    );
  },

  getPaths() {
    return normalize(storage.get("recentSettings", []));
  },

  clear() {
    return storage.update("recentSettings", undefined);
  },

  onDidChange(callback) {
    return storage.onDidChange("recentSettings", callback);
  },
};
