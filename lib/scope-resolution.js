const SCOPE_RESOLUTIONS = {
  base: {
    label: "Base value",
    description: "Designed to be read without a scope. A stored scoped override may be ignored.",
  },
  grammar: {
    label: "Per grammar",
    description: "Designed to resolve using a grammar scope, including an embedded grammar layer.",
  },
  syntax: {
    label: "Per syntax scope",
    description:
      "Designed to resolve using the full syntax scope at a position, including embedded languages.",
  },
};

function scopeResolutionForKeyPath(keyPath) {
  let schema = lumine.config.schema;
  let resolution = declaredResolution(schema);
  for (const key of keyPath.split(".")) {
    if (schema?.type !== "object") break;
    schema = schema.properties?.[key];
    if (!schema) break;
    resolution = declaredResolution(schema) || resolution;
  }
  return resolution || "base";
}

function declaredResolution(schema) {
  const resolution = schema?.scopeResolution;
  return Object.hasOwn(SCOPE_RESOLUTIONS, resolution) ? resolution : null;
}

function scopeResolutionDetailsForKeyPath(keyPath) {
  const resolution = scopeResolutionForKeyPath(keyPath);
  const { label, description } = SCOPE_RESOLUTIONS[resolution];
  return { resolution, label, description, tooltip: `${label}: ${description}` };
}

module.exports = {
  SCOPE_RESOLUTIONS,
  scopeResolutionForKeyPath,
  scopeResolutionDetailsForKeyPath,
};
