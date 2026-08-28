const fs = require("fs");
const dns = require("dns");
const os = require("os");
const path = require("path");
const { fileURLToPath, pathToFileURL } = require("url");
const CSON = require("@lumine-code/season");
const JSONC = require("jsonc-parser");
const semver = require("semver");
const requireCore = require("./require-core");

const {
  MAX_REMOTE_REFS,
  assertSafeCatalogPackageSource,
  cloneUrlForRepository,
  listPackageRepositoryRefs,
  isPrivateAddress,
  normalizeRepositoryOrigin,
  parsePackageSource,
  resolvePackageSource,
} = requireCore("package-source");
const { validatePackageMetadata } = requireCore("package-validation");

const CACHE_SCHEMA_VERSION = 2;
const MAX_REPOSITORIES = 2000;
const GIT_CONCURRENCY = 8;
const HTTP_CONCURRENCY = 16;
const PER_HOST_CONCURRENCY = 8;
const REQUEST_TIMEOUT = 15000;
const GIT_REF_TIMEOUT = 30000;
const GIT_FETCH_TIMEOUT = 60000;
const HYDRATION_SCHEDULE_BATCH = 10;
const MAX_CATALOG_BYTES = 2 * 1024 * 1024;
const MAX_MANIFEST_BYTES = 1024 * 1024;
const MAX_README_BYTES = 2 * 1024 * 1024;
const README_CACHE_ENTRIES = 50;
// GitHub raw paths are case-sensitive, so try the common casings/extensions.
const LICENSE_FILENAMES = [
  "LICENSE",
  "LICENSE.md",
  "LICENSE.markdown",
  "LICENSE.txt",
  "LICENCE",
  "LICENCE.md",
  "LICENCE.txt",
  "COPYING",
  "COPYING.md",
  "UNLICENSE",
];
const LICENSE_FILE_PATTERN = /^(licen[cs]e|copying|unlicense)(?:\.|$)/i;
const SHA_PATTERN = /^[0-9a-f]{40}$/;
const SNAPSHOT_FIELDS = new Set([
  "source",
  "featured",
  "resolvedSha",
  "selectedRef",
  "refs",
  "metadata",
]);
const SELECTED_REF_FIELDS = new Set(["type", "value"]);
const RESOLVED_SELECTOR_TYPES = new Set(["latest", "default", "branch", "tag", "commit"]);
const SNAPSHOT_REF_FIELDS = new Set(["defaultBranch", "headSha", "latestStable", "tags"]);
const SNAPSHOT_TAG_FIELDS = new Set(["name", "version", "sha"]);
const SNAPSHOT_METADATA_FIELDS = new Set([
  "name",
  "version",
  "description",
  "keywords",
  "engines",
  "repository",
  "theme",
  "themes",
  "license",
  "licenses",
  "bugs",
  "homepage",
]);

class TaskQueue {
  constructor(limit, perKeyLimit = limit) {
    this.limit = limit;
    this.perKeyLimit = perKeyLimit;
    this.active = 0;
    this.activeByKey = new Map();
    this.pending = [];
  }

  add(task, key = "default", signal = null) {
    return new Promise((resolve, reject) => {
      this.pending.push({ task, key, signal, resolve, reject });
      this.scheduleDrain();
    });
  }

  scheduleDrain() {
    if (this.drainScheduled) return;
    this.drainScheduled = true;
    setImmediate(() => {
      this.drainScheduled = false;
      this.drain();
    });
  }

  drain() {
    if (this.active >= this.limit) return;
    const index = this.pending.findIndex(
      ({ key }) => (this.activeByKey.get(key) || 0) < this.perKeyLimit,
    );
    if (index === -1) return;
    const item = this.pending.splice(index, 1)[0];
    if (item.signal && item.signal.aborted) {
      item.reject(abortError());
      this.scheduleDrain();
      return;
    }
    this.active++;
    this.activeByKey.set(item.key, (this.activeByKey.get(item.key) || 0) + 1);
    Promise.resolve()
      .then(item.task)
      .then(item.resolve, item.reject)
      .finally(() => {
        this.active--;
        const activeForKey = (this.activeByKey.get(item.key) || 1) - 1;
        if (activeForKey) this.activeByKey.set(item.key, activeForKey);
        else this.activeByKey.delete(item.key);
        this.scheduleDrain();
      });
    this.scheduleDrain();
  }
}

function abortError() {
  const error = new Error("Catalog Fetch was cancelled.");
  error.name = "AbortError";
  return error;
}

function normalizeCatalogSource(source) {
  const value = String(source || "")
    .trim()
    .replace(/\/+$/, "");
  if (!value) throw new Error("Enter a catalog repository or index.json URL.");

  if (/^file:\/\//i.test(value)) {
    const filePath = fileURLToPath(value);
    return pathToFileURL(filePath.endsWith(".json") ? filePath : path.join(filePath, "index.json"))
      .href;
  }
  if (path.isAbsolute(value)) {
    const filePath = value.endsWith(".json") ? value : path.join(value, "index.json");
    return pathToFileURL(filePath).href;
  }

  // `HEAD` rather than a branch name: raw.githubusercontent resolves it to
  // whatever the repository calls its default branch, so a catalog on `master`
  // needs no special casing and a repository that renames its default branch
  // does not silently stop resolving.
  const shorthand = value.match(/^([\w.-]+)\/([\w.-]+)$/);
  if (
    shorthand &&
    shorthand[1] !== "." &&
    shorthand[1] !== ".." &&
    shorthand[2] !== "." &&
    shorthand[2] !== ".."
  ) {
    return `https://raw.githubusercontent.com/${shorthand[1]}/${shorthand[2]}/HEAD/index.json`;
  }
  const github = value.match(/^https:\/\/github\.com\/([\w.-]+)\/([\w.-]+?)(?:\.git)?$/i);
  if (github) {
    return `https://raw.githubusercontent.com/${github[1]}/${github[2]}/HEAD/index.json`;
  }
  if (/^https:\/\//i.test(value)) {
    const url = new URL(value);
    if (url.username || url.password) throw new Error("Catalog URLs must not contain credentials.");
    return value.endsWith(".json") ? value : `${value}/index.json`;
  }
  throw new Error("Catalog sources must be owner/repo, a public HTTPS URL, or a local file.");
}

function defaultCachePath() {
  try {
    return path.join(lumine.application.getPath("userData"), "Cache", "settings-view");
  } catch {
    return path.join(process.env.LUMINE_HOME || os.tmpdir(), "Cache", "settings-view");
  }
}

function hostForRepository(repository) {
  const originKey = normalizeRepositoryOrigin(repository);
  return originKey.split("/")[0] || "unknown";
}

function hostnameWithoutPort(host) {
  const bracketed = String(host).match(/^\[([^\]]+)\](?::\d+)?$/);
  return bracketed ? bracketed[1] : String(host).replace(/:\d+$/, "");
}

function assertPlainObject(value, label) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`${label} must be an object.`);
  }
}

function assertOnlyFields(value, allowed, label) {
  assertPlainObject(value, label);
  const unknown = Object.keys(value).find((key) => !allowed.has(key));
  if (unknown) throw new Error(`${label} contains unsupported field "${unknown}".`);
}

function normalizedSha(value, label, { nullable = false } = {}) {
  if (nullable && value == null) return null;
  if (typeof value !== "string" || !SHA_PATTERN.test(value.toLowerCase())) {
    throw new Error(`${label} must be a complete 40-character commit SHA.`);
  }
  return value.toLowerCase();
}

function validateSnapshotTag(value, label, { allowTextual = false } = {}) {
  assertOnlyFields(value, SNAPSHOT_TAG_FIELDS, label);
  if (typeof value.name !== "string" || !value.name.trim()) {
    throw new Error(`${label}.name must be a non-empty string.`);
  }
  const version = semver.valid(value.name);
  if (version) {
    if (value.version !== version) {
      throw new Error(`${label}.version must match its semantic tag name.`);
    }
  } else if (!allowTextual || value.version !== null) {
    throw new Error(`${label} must describe a semantic-version tag.`);
  }
  return {
    name: value.name,
    version: version || null,
    sha: normalizedSha(value.sha, `${label}.sha`),
  };
}

function selectedTagForSource(tags, requestedName) {
  const names = requestedName.startsWith("v")
    ? [requestedName]
    : [requestedName, `v${requestedName}`];
  return tags.find((tag) => names.includes(tag.name)) || null;
}

// A fetched manifest is parsed by the form its file name declares, exactly as
// CSON.readFileSync does for one on disk. Only a .cson manifest is CoffeeScript,
// and reading a JSON one that way misreads a `#{` inside a string — which any
// Liquid template such as `{% if n > 1 %} #{{ n }}{% endif %}` contains.
function parseManifestBody(filename, body) {
  if (path.extname(filename) === ".cson") return CSON.parse(body);
  const errors = [];
  const parsed = JSONC.parse(body, errors, { allowTrailingComma: true });
  if (errors.length > 0) {
    const lines = body.slice(0, errors[0].offset).split("\n");
    throw new SyntaxError(
      `Syntax error on line ${lines.length}, column ${
        lines[lines.length - 1].length + 1
      }: ${JSONC.printParseErrorCode(errors[0].error)}`,
    );
  }
  return parsed;
}

function selectedRefFromIndex(record, index) {
  const requested = parsePackageSource(record.installSource).selector;
  if (requested.type === "latest") {
    if (index.latestStable) {
      return {
        selector: { type: "latest", value: index.latestStable.name },
        resolvedSha: index.latestStable.sha,
        semanticTag: index.latestStable.name,
        updatePolicy: "latest-tag",
      };
    }
    if (!index.headSha) throw new Error("Repository does not expose HEAD or a stable tag.");
    return {
      selector: { type: "default", value: index.defaultBranch || "HEAD" },
      resolvedSha: index.headSha,
      semanticTag: null,
      updatePolicy: "default-branch",
    };
  }
  if (requested.type === "tag") {
    const names = requested.value.startsWith("v")
      ? [requested.value]
      : [requested.value, `v${requested.value}`];
    const tag = index.tags.find((candidate) => names.includes(candidate.name));
    if (!tag) throw new Error(`Tag "${requested.value}" was not found.`);
    return {
      selector: { type: "tag", value: tag.name },
      resolvedSha: tag.sha,
      semanticTag: tag.name,
      updatePolicy: "pinned",
    };
  }
  if (requested.type === "commit" && /^[0-9a-f]{40}$/i.test(requested.value)) {
    return {
      selector: requested,
      resolvedSha: requested.value.toLowerCase(),
      semanticTag: null,
      updatePolicy: "pinned",
    };
  }
  return null;
}

module.exports = class PackageCatalogClient {
  constructor({
    fetchImpl = (...args) => fetch(...args),
    packageManager = null,
    storage = null,
    cachePath = null,
    now = Date.now,
    delay = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds)),
    lumineVersion = () =>
      global.lumine && lumine.application.getVersion ? lumine.application.getVersion() : null,
  } = {}) {
    this.fetchImpl = fetchImpl;
    this.packageManager = packageManager;
    this.storage = storage;
    this.cachePath = cachePath || defaultCachePath();
    this.now = now;
    this.delay = delay;
    this.lumineVersion = lumineVersion;
    this.gitQueue = new TaskQueue(GIT_CONCURRENCY, PER_HOST_CONCURRENCY);
    this.httpQueue = new TaskQueue(HTTP_CONCURRENCY, PER_HOST_CONCURRENCY);
    this.dnsChecks = new Map();
  }

  async load(source, options = {}) {
    const result = await this.loadAll([source], options);
    return { schemaVersion: CACHE_SCHEMA_VERSION, packages: result.packages };
  }

  async loadAll(catalogSources, { refresh = false, cacheOnly = false, onProgress, onRecord } = {}) {
    const normalizedSources = catalogSources.map(normalizeCatalogSource);
    const cached = this.readCache();
    const cachedPackages = this.packagesForSources(cached, normalizedSources);
    const cachedSources = new Set((cached && cached.catalogSources) || []);
    const pendingSources = normalizedSources.filter((source) => !cachedSources.has(source));
    if (cacheOnly || (!refresh && cachedPackages.length)) {
      return {
        schemaVersion: CACHE_SCHEMA_VERSION,
        packages: cachedPackages,
        lastFetch: cached && cached.lastFetch,
        cached: true,
        pendingSources,
      };
    }

    const loadGeneration = (this.loadGeneration = (this.loadGeneration || 0) + 1);
    this.cancel();
    this.controller = new AbortController();
    const { signal } = this.controller;
    const catalogResults = await Promise.all(
      normalizedSources.map(async (url, index) => {
        try {
          const sources = await this.fetchCatalog(url, signal);
          return { url, configuredSource: catalogSources[index], sources };
        } catch (error) {
          return { url, configuredSource: catalogSources[index], error };
        }
      }),
    );

    const records = this.mergeCatalogs(catalogResults, cached);
    if (records.length > MAX_REPOSITORIES) {
      throw new Error(
        `Catalogs contain ${records.length} unique repositories; the safety limit is ${MAX_REPOSITORIES}.`,
      );
    }

    const nextCache = {
      schemaVersion: CACHE_SCHEMA_VERSION,
      lastFetch: this.now(),
      catalogSources: normalizedSources,
      manifests: cached && cached.manifests ? cached.manifests : {},
      readmes: cached && cached.readmes ? cached.readmes : {},
      packages: {},
      catalogErrors: catalogResults
        .filter((result) => result.error && result.error.name !== "AbortError")
        .map((result) => ({ source: result.configuredSource, message: result.error.message })),
    };
    let processed = 0;
    let errors = 0;
    const report = () => {
      if (onProgress) onProgress({ processed, total: records.length, errors });
    };
    report();

    const hydrationPromises = [];
    for (const [index, record] of records.entries()) {
      if (signal.aborted) break;
      hydrationPromises.push(
        (async () => {
          if (signal.aborted) return;
          let hydrated;
          try {
            hydrated = await this.hydrate(record, nextCache.manifests, signal);
          } catch (error) {
            if (signal.aborted || error.name === "AbortError") return;
            errors++;
            const previous = cached && cached.packages && cached.packages[record.originKey];
            hydrated = previous
              ? { ...previous, ...record, status: "stale", error: error.message }
              : {
                  ...record,
                  name: record.originKey.split("/").pop() || record.originKey,
                  unverifiedName: true,
                  status: "error",
                  error: error.message,
                };
          }
          nextCache.packages[record.originKey] = hydrated;
          processed++;
          if (onRecord) onRecord(hydrated, { processed, total: records.length, errors });
          report();
        })(),
      );
      if ((index + 1) % HYDRATION_SCHEDULE_BATCH === 0 && index + 1 < records.length) {
        await new Promise((resolve) => setImmediate(resolve));
      }
    }
    await Promise.all(hydrationPromises);

    if (!signal.aborted && loadGeneration === this.loadGeneration) {
      await this.writeCacheAsync(nextCache);
    } else {
      // Preserve every previous record from the still-configured catalogs and
      // overlay only repositories that completed hydration. This keeps a
      // cancelled refresh coherent instead of truncating the on-disk index.
      const completed = nextCache.packages;
      nextCache.packages = Object.fromEntries(cachedPackages.map((pack) => [pack.originKey, pack]));
      Object.assign(nextCache.packages, completed);
      if (cached && cached.lastFetch) nextCache.lastFetch = cached.lastFetch;
      nextCache.cancelled = true;
      if (loadGeneration === this.loadGeneration) {
        await this.writeCacheAsync(nextCache);
      }
    }
    return {
      schemaVersion: CACHE_SCHEMA_VERSION,
      packages: Object.values(nextCache.packages),
      lastFetch: nextCache.lastFetch,
      errors: nextCache.catalogErrors,
      cancelled: signal.aborted,
    };
  }

  cancel() {
    if (this.controller) this.controller.abort();
    this.controller = null;
  }

  validate(value, source = null) {
    if (!Array.isArray(value)) {
      if (value && value.schemaVersion === 1 && Array.isArray(value.packages)) {
        throw new Error(
          "The old metadata catalog format is not supported; index.json must be a JSON array of Git sources or snapshots.",
        );
      }
      throw new Error("A package catalog must be a JSON array of Git sources or snapshots.");
    }
    return value.map((entry, index) => {
      if (
        typeof entry !== "string" &&
        (!entry || typeof entry !== "object" || Array.isArray(entry))
      ) {
        throw new Error(`Catalog entry ${index + 1} must be a Git source string or snapshot.`);
      }
      const entrySource = typeof entry === "string" ? entry : entry.source;
      if (typeof entrySource !== "string") {
        throw new Error(`Catalog entry ${index + 1} snapshot must contain a Git source string.`);
      }
      const parsed = assertSafeCatalogPackageSource(entrySource);
      if (parsed.selector.type === "commit" && !/^[0-9a-f]{40}$/i.test(parsed.selector.value)) {
        throw new Error(`Catalog entry ${index + 1} must use a complete 40-character commit SHA.`);
      }
      const record = {
        source: parsed.source,
        repository: parsed.repository,
        originKey: parsed.originKey,
        selector: parsed.selector,
        catalogSource: source,
      };
      if (typeof entry === "string") return record;

      // A snapshot is an optimization, not a requirement for catalog
      // availability. If its safe source can be parsed but any pre-fetched data
      // is malformed or internally inconsistent, discard the snapshot and let
      // normal Git/manifest hydration provide an authoritative record.
      try {
        return { ...record, catalogSnapshot: this.validateSnapshot(entry, parsed, index) };
      } catch {
        return record;
      }
    });
  }

  validateSnapshot(entry, parsed, index = 0) {
    const label = `Catalog entry ${index + 1}`;
    assertOnlyFields(entry, SNAPSHOT_FIELDS, `${label} snapshot`);
    if (Object.hasOwn(entry, "featured") && entry.featured !== true) {
      throw new Error(`${label}.featured must be true when present.`);
    }

    const resolvedSha = normalizedSha(entry.resolvedSha, `${label}.resolvedSha`);
    assertOnlyFields(entry.selectedRef, SELECTED_REF_FIELDS, `${label}.selectedRef`);
    const selectedRef = entry.selectedRef;
    if (!RESOLVED_SELECTOR_TYPES.has(selectedRef.type)) {
      throw new Error(`${label}.selectedRef.type is not a resolved selector type.`);
    }
    if (typeof selectedRef.value !== "string" || !selectedRef.value.trim()) {
      throw new Error(`${label}.selectedRef.value must be a non-empty string.`);
    }

    assertOnlyFields(entry.refs, SNAPSHOT_REF_FIELDS, `${label}.refs`);
    const defaultBranch = entry.refs.defaultBranch;
    if (defaultBranch != null && (typeof defaultBranch !== "string" || !defaultBranch.trim())) {
      throw new Error(`${label}.refs.defaultBranch must be a non-empty string or null.`);
    }
    const headSha = normalizedSha(entry.refs.headSha, `${label}.refs.headSha`, {
      nullable: true,
    });
    if (!Array.isArray(entry.refs.tags)) {
      throw new Error(`${label}.refs.tags must be an array.`);
    }
    if (entry.refs.tags.length > MAX_REMOTE_REFS) {
      throw new Error(`${label}.refs.tags exceeds the ${MAX_REMOTE_REFS}-tag limit.`);
    }
    const requested = parsed.selector;
    const permitsTextualTag =
      (requested.type === "tag" || requested.type === "ref") && selectedRef.type === "tag";
    const tags = entry.refs.tags.map((tag, tagIndex) =>
      validateSnapshotTag(tag, `${label}.refs.tags[${tagIndex}]`, {
        allowTextual: permitsTextualTag && tag && tag.name === selectedRef.value,
      }),
    );
    if (new Set(tags.map(({ name }) => name)).size !== tags.length) {
      throw new Error(`${label}.refs.tags contains duplicate tag names.`);
    }

    let latestStable = null;
    if (entry.refs.latestStable != null) {
      latestStable = validateSnapshotTag(entry.refs.latestStable, `${label}.refs.latestStable`);
      if (semver.prerelease(latestStable.version) != null) {
        throw new Error(`${label}.refs.latestStable must not be a prerelease.`);
      }
      const matchingTag = tags.find(
        (tag) =>
          tag.name === latestStable.name &&
          tag.version === latestStable.version &&
          tag.sha === latestStable.sha,
      );
      if (!matchingTag) {
        throw new Error(`${label}.refs.latestStable must match an entry in refs.tags.`);
      }
      const greatestStable = tags
        .filter((tag) => tag.version && semver.prerelease(tag.version) == null)
        .sort((left, right) => semver.rcompare(left.version, right.version))[0];
      if (!greatestStable || greatestStable.name !== latestStable.name) {
        throw new Error(`${label}.refs.latestStable must be the greatest stable semantic tag.`);
      }
    } else if (tags.some((tag) => tag.version && semver.prerelease(tag.version) == null)) {
      throw new Error(`${label}.refs.latestStable is required when stable tags are present.`);
    }

    const selectedTag =
      selectedRef.type === "latest" || selectedRef.type === "tag"
        ? tags.find((tag) => tag.name === selectedRef.value)
        : null;
    if (selectedTag && selectedTag.sha !== resolvedSha) {
      throw new Error(`${label}.resolvedSha must match the selected tag.`);
    }

    if (requested.type === "latest") {
      if (latestStable) {
        if (
          selectedRef.type !== "latest" ||
          selectedRef.value !== latestStable.name ||
          resolvedSha !== latestStable.sha
        ) {
          throw new Error(`${label}.selectedRef must resolve the latest stable tag.`);
        }
      } else if (
        selectedRef.type !== "default" ||
        selectedRef.value !== (defaultBranch || "HEAD") ||
        !headSha ||
        resolvedSha !== headSha
      ) {
        throw new Error(`${label}.selectedRef must resolve the default branch HEAD.`);
      }
    } else if (requested.type === "tag") {
      const requestedTag = selectedTagForSource(tags, requested.value);
      if (
        selectedRef.type !== "tag" ||
        !requestedTag ||
        requestedTag.name !== selectedRef.value ||
        requestedTag.sha !== resolvedSha
      ) {
        throw new Error(`${label}.selectedRef does not match the requested tag.`);
      }
    } else if (requested.type === "branch") {
      if (selectedRef.type !== "branch" || selectedRef.value !== requested.value) {
        throw new Error(`${label}.selectedRef does not match the requested branch.`);
      }
      if (defaultBranch === requested.value && headSha && resolvedSha !== headSha) {
        throw new Error(`${label}.resolvedSha does not match the default branch HEAD.`);
      }
    } else if (requested.type === "commit") {
      if (
        selectedRef.type !== "commit" ||
        selectedRef.value.toLowerCase() !== requested.value.toLowerCase() ||
        resolvedSha !== requested.value.toLowerCase()
      ) {
        throw new Error(`${label}.selectedRef does not match the requested commit.`);
      }
    } else if (
      requested.type === "ref" &&
      (selectedRef.value !== requested.value ||
        (selectedRef.type === "commit" && resolvedSha !== selectedRef.value.toLowerCase()))
    ) {
      throw new Error(`${label}.selectedRef does not match the requested ref.`);
    }

    if ((selectedRef.type === "latest" || selectedRef.type === "tag") && !selectedTag) {
      throw new Error(`${label}.selectedRef must match an entry in refs.tags.`);
    }

    assertOnlyFields(entry.metadata, SNAPSHOT_METADATA_FIELDS, `${label}.metadata`);
    const metadata = Object.fromEntries(
      Object.entries(entry.metadata).filter(([key]) => SNAPSHOT_METADATA_FIELDS.has(key)),
    );
    if (typeof metadata.version !== "string" || !semver.valid(metadata.version)) {
      throw new Error(`${label}.metadata.version must be a semantic version.`);
    }
    if (metadata.description != null && typeof metadata.description !== "string") {
      throw new Error(`${label}.metadata.description must be a string.`);
    }
    if (
      metadata.keywords != null &&
      (!Array.isArray(metadata.keywords) ||
        metadata.keywords.some((keyword) => typeof keyword !== "string"))
    ) {
      throw new Error(`${label}.metadata.keywords must be an array of strings.`);
    }
    validatePackageMetadata(metadata, {
      originKey: parsed.originKey,
      semanticTag:
        selectedRef.type === "latest" || selectedRef.type === "tag" ? selectedRef.value : null,
      lumineVersion: null,
      allowIncompatible: true,
    });

    return {
      source: parsed.source,
      featured: entry.featured === true,
      resolvedSha,
      selectedRef: { type: selectedRef.type, value: selectedRef.value },
      refs: { defaultBranch: defaultBranch || null, headSha, latestStable, tags },
      metadata,
    };
  }

  async fetchCatalog(url, signal) {
    if (url.startsWith("file://")) {
      const body = await fs.promises.readFile(fileURLToPath(url), "utf8");
      if (Buffer.byteLength(body) > MAX_CATALOG_BYTES) throw new Error("Catalog is too large.");
      return this.validate(JSON.parse(body), url);
    }
    await this.assertPublicHostname(new URL(url).hostname);
    const host = new URL(url).hostname;
    const body = await this.httpQueue.add(
      () => this.requestText(url, { signal, maxBytes: MAX_CATALOG_BYTES }),
      host,
      signal,
    );
    return this.validate(JSON.parse(body), url);
  }

  mergeCatalogs(results, cached) {
    const byOrigin = new Map();
    for (const result of results) {
      const entries = result.error
        ? this.cachedEntriesForCatalog(cached, result.url)
        : result.sources;
      for (const entry of entries) {
        const existing = byOrigin.get(entry.originKey);
        if (!existing) {
          const catalogSnapshot = entry.catalogSnapshot || null;
          byOrigin.set(entry.originKey, {
            originKey: entry.originKey,
            repository: entry.repository,
            installSource: entry.source || entry.installSource,
            catalogSources: [result.url],
            catalogSelectors: [
              {
                catalogSource: result.url,
                selector: entry.selector,
                resolvedSha: catalogSnapshot && catalogSnapshot.resolvedSha,
              },
            ],
            catalogSnapshot,
            featured: catalogSnapshot ? catalogSnapshot.featured === true : entry.featured === true,
            status: "pending",
            catalogError: result.error ? result.error.message : null,
          });
        } else {
          if (!result.error) existing.catalogError = null;
          if (!existing.catalogSources.includes(result.url))
            existing.catalogSources.push(result.url);
          existing.catalogSelectors.push({
            catalogSource: result.url,
            selector: entry.selector,
            resolvedSha: entry.catalogSnapshot && entry.catalogSnapshot.resolvedSha,
          });
          const firstSelection = existing.catalogSelectors[0];
          existing.selectorConflict = existing.catalogSelectors.some(
            ({ selector, resolvedSha }) =>
              selector.type !== existing.catalogSelectors[0].selector.type ||
              selector.value !== existing.catalogSelectors[0].selector.value ||
              (firstSelection.resolvedSha &&
                resolvedSha &&
                resolvedSha !== firstSelection.resolvedSha),
          );
        }
      }
    }
    return Array.from(byOrigin.values());
  }

  cachedEntriesForCatalog(cache, catalogSource) {
    if (!cache || !cache.packages) return [];
    return Object.values(cache.packages)
      .filter((pack) => (pack.catalogSources || []).includes(catalogSource))
      .map((pack) => ({
        ...pack,
        source: pack.installSource,
        selector: parsePackageSource(pack.installSource).selector,
      }));
  }

  async hydrate(record, manifests, signal) {
    if (record.catalogSnapshot) return this.hydrateSnapshot(record);

    const host = hostForRepository(record.repository);
    const index = await this.gitQueue.add(
      async () => {
        if (!record.manualSource) await this.assertPublicHostname(hostnameWithoutPort(host));
        return this.listRefs(record.installSource, false);
      },
      host,
      signal,
    );
    let selected = selectedRefFromIndex(record, index);
    if (!selected) {
      const resolved = await this.gitQueue.add(
        () => this.resolveSource(record.installSource),
        host,
        signal,
      );
      if (!resolved.sha) {
        throw new Error("The selected ref could not be resolved to a complete commit SHA.");
      }
      selected = {
        selector: resolved.selector,
        resolvedSha: resolved.sha,
        semanticTag: resolved.selector.type === "tag" ? resolved.selector.value : null,
        updatePolicy: resolved.updatePolicy,
      };
    }
    const cacheKey = `${record.originKey}@${selected.resolvedSha}`;
    let metadata = manifests[cacheKey];
    if (!metadata) {
      metadata = await this.fetchManifest(record, selected.resolvedSha, signal);
      manifests[cacheKey] = metadata;
    }
    const currentLumineVersion = this.lumineVersion();
    const pack = validatePackageMetadata(metadata, {
      originKey: record.originKey,
      semanticTag: selected.semanticTag,
      lumineVersion:
        typeof currentLumineVersion === "string" ? currentLumineVersion.split("-")[0] : null,
      // A version whose engines.lumine does not match is shown (with a disabled
      // Install) rather than dropped, so another ref can be selected.
      allowIncompatible: true,
    });
    const { catalogSnapshot: _catalogSnapshot, ...catalogRecord } = record;
    return {
      ...catalogRecord,
      ...pack,
      // README content is intentionally lazy and badges may load remote images.
      // Neither is trusted from a package manifest for the catalog card.
      readme: undefined,
      badges: [],
      repository: record.repository,
      installSource: record.installSource,
      featured: record.featured === true,
      refs: {
        defaultBranch: index.defaultBranch,
        headSha: index.headSha,
        latestStable: index.latestStable,
        tags: index.tags,
        branches: record.refs && record.refs.branches ? record.refs.branches : null,
      },
      selectedRef: selected.selector,
      updatePolicy: selected.updatePolicy,
      resolvedSha: selected.resolvedSha,
      selectorConflict:
        record.selectorConflict ||
        record.catalogSelectors.some(
          ({ resolvedSha }) => resolvedSha && resolvedSha !== selected.resolvedSha,
        ),
      status: record.catalogError ? "stale" : "ready",
      error: record.catalogError,
      hydratedAt: this.now(),
    };
  }

  hydrateSnapshot(record) {
    const snapshot = record.catalogSnapshot;
    const currentLumineVersion = this.lumineVersion();
    const semanticTag =
      snapshot.selectedRef.type === "latest" || snapshot.selectedRef.type === "tag"
        ? snapshot.selectedRef.value
        : null;
    const pack = validatePackageMetadata(snapshot.metadata, {
      originKey: record.originKey,
      semanticTag,
      lumineVersion:
        typeof currentLumineVersion === "string" ? currentLumineVersion.split("-")[0] : null,
      allowIncompatible: true,
    });
    const { catalogSnapshot: _catalogSnapshot, ...catalogRecord } = record;
    return {
      ...catalogRecord,
      ...pack,
      readme: undefined,
      badges: [],
      repository: record.repository,
      installSource: record.installSource,
      featured: record.featured === true,
      refs: { ...snapshot.refs, branches: null },
      selectedRef: snapshot.selectedRef,
      updatePolicy:
        snapshot.selectedRef.type === "latest"
          ? "latest-tag"
          : snapshot.selectedRef.type === "default"
            ? "default-branch"
            : snapshot.selectedRef.type === "branch"
              ? "branch"
              : "pinned",
      resolvedSha: snapshot.resolvedSha,
      selectorConflict:
        record.selectorConflict ||
        record.catalogSelectors.some(
          ({ resolvedSha }) => resolvedSha && resolvedSha !== snapshot.resolvedSha,
        ),
      status: record.catalogError ? "stale" : "ready",
      error: record.catalogError,
      hydratedAt: this.now(),
    };
  }

  async loadBranches(pack) {
    const host = hostForRepository(pack.repository);
    const refs = await this.gitQueue.add(() => this.listRefs(pack.installSource, true), host);
    const updated = { ...pack, refs: { ...pack.refs, branches: refs.branches } };
    this.updateCachedPackage(updated);
    return updated;
  }

  // The Git source to list refs from. An installed fork's package.json
  // `repository` may point upstream, so prefer the install receipt's origin.
  repositoryForPack(pack) {
    const install = pack.apmInstallSource;
    if (install && install.type === "git" && install.repository) return install.repository;
    return pack.installSource || pack.repository;
  }

  // Lists tags + default branch for a card that has no ref index yet (an
  // installed package). Used to populate the version selector on demand.
  async loadRefs(pack) {
    const source = this.repositoryForPack(pack);
    const host = hostForRepository(source);
    const index = await this.gitQueue.add(() => this.listRefs(source, false), host);
    return {
      ...pack,
      refs: {
        defaultBranch: index.defaultBranch,
        headSha: index.headSha,
        latestStable: index.latestStable,
        tags: index.tags,
        branches: null,
      },
    };
  }

  async hydrateSource(source, catalogSource = "external") {
    const parsed = assertSafeCatalogPackageSource(source);
    const cache = this.readCache() || { manifests: {} };
    return this.hydrate(
      {
        originKey: parsed.originKey,
        repository: parsed.repository,
        installSource: parsed.source,
        catalogSources: [catalogSource],
        catalogSelectors: [{ catalogSource, selector: parsed.selector }],
        status: "pending",
      },
      cache.manifests || {},
      null,
    );
  }

  async hydrateManualSource(source) {
    const parsed = parsePackageSource(source);
    cloneUrlForRepository(parsed.repository);
    const originKey = normalizeRepositoryOrigin(parsed.repository);
    if (!originKey) throw new Error("Invalid Git repository source.");
    const cache = this.readCache() || { manifests: {} };
    return this.hydrate(
      {
        originKey,
        repository: parsed.repository,
        installSource: parsed.source,
        catalogSources: ["manual"],
        catalogSelectors: [{ catalogSource: "manual", selector: parsed.selector }],
        status: "pending",
        manualSource: true,
      },
      cache.manifests || {},
      null,
    );
  }

  async loadReadme(pack) {
    if (!pack.originKey || !/^[0-9a-f]{40}$/i.test(pack.resolvedSha || "")) return null;
    const cache = this.readCache() || {
      schemaVersion: CACHE_SCHEMA_VERSION,
      manifests: {},
      readmes: {},
      packages: {},
      catalogSources: [],
    };
    cache.readmes ||= {};
    const key = `${pack.originKey}@${pack.resolvedSha}`;
    if (cache.readmes[key]) {
      cache.readmes[key].accessedAt = this.now();
      this.writeCache(cache);
      return cache.readmes[key];
    }

    let entry = null;
    if (pack.originKey.startsWith("github.com/") && !pack.manualSource) {
      const repoPath = pack.originKey.slice("github.com/".length);
      for (const filename of ["README.md", "README.markdown", "README.mdown", "README.txt"]) {
        const rawUrl = `https://raw.githubusercontent.com/${repoPath}/${pack.resolvedSha}/${filename}`;
        const body = await this.httpQueue.add(
          () =>
            this.requestText(rawUrl, {
              maxBytes: MAX_README_BYTES,
              allowNotFound: true,
            }),
          "raw.githubusercontent.com",
        );
        if (body != null) {
          entry = {
            body,
            source: `https://github.com/${repoPath}/blob/${pack.resolvedSha}/${filename}`,
            accessedAt: this.now(),
          };
          break;
        }
      }
    } else {
      entry = await this.gitQueue.add(
        () => this.fetchReadmeWithGit(pack),
        hostForRepository(pack.repository),
      );
    }
    if (!entry) return null;
    cache.readmes[key] = entry;
    const keys = Object.keys(cache.readmes).sort(
      (left, right) => cache.readmes[right].accessedAt - cache.readmes[left].accessedAt,
    );
    for (const expired of keys.slice(README_CACHE_ENTRIES)) delete cache.readmes[expired];
    this.writeCache(cache);
    return entry;
  }

  // Lazily fetches a package's LICENSE for the resolved commit, mirroring
  // `loadReadme`. Returns `{ body, source, filename, isMarkdown }` or null.
  async loadLicense(pack) {
    if (!pack.originKey || !/^[0-9a-f]{40}$/i.test(pack.resolvedSha || "")) return null;
    const cache = this.readCache() || {
      schemaVersion: CACHE_SCHEMA_VERSION,
      manifests: {},
      readmes: {},
      licenses: {},
      packages: {},
      catalogSources: [],
    };
    cache.licenses ||= {};
    const key = `${pack.originKey}@${pack.resolvedSha}`;
    if (cache.licenses[key]) {
      cache.licenses[key].accessedAt = this.now();
      this.writeCache(cache);
      return cache.licenses[key];
    }

    let entry = null;
    if (pack.originKey.startsWith("github.com/") && !pack.manualSource) {
      const repoPath = pack.originKey.slice("github.com/".length);
      for (const filename of LICENSE_FILENAMES) {
        const rawUrl = `https://raw.githubusercontent.com/${repoPath}/${pack.resolvedSha}/${filename}`;
        const body = await this.httpQueue.add(
          () =>
            this.requestText(rawUrl, {
              maxBytes: MAX_README_BYTES,
              allowNotFound: true,
            }),
          "raw.githubusercontent.com",
        );
        if (body != null) {
          entry = {
            body,
            source: `https://github.com/${repoPath}/blob/${pack.resolvedSha}/${filename}`,
            filename,
            isMarkdown: /\.(md|markdown)$/i.test(filename),
            accessedAt: this.now(),
          };
          break;
        }
      }
    } else {
      entry = await this.gitQueue.add(
        () => this.fetchLicenseWithGit(pack),
        hostForRepository(pack.repository),
      );
    }
    if (!entry) return null;
    cache.licenses[key] = entry;
    const keys = Object.keys(cache.licenses).sort(
      (left, right) => cache.licenses[right].accessedAt - cache.licenses[left].accessedAt,
    );
    for (const expired of keys.slice(README_CACHE_ENTRIES)) delete cache.licenses[expired];
    this.writeCache(cache);
    return entry;
  }

  async selectRef(pack, selector) {
    let source;
    if (selector.type === "latest") source = pack.repository;
    else if (selector.type === "default") {
      source = `${pack.repository}#branch:${selector.value}`;
    } else source = `${pack.repository}#${selector.type}:${selector.value}`;
    const record = { ...pack, installSource: source, status: "validating", error: null };
    const cache = this.readCache() || { manifests: {} };
    let hydrated = await this.hydrate(record, cache.manifests || {}, null);
    if (selector.type === "default") {
      hydrated = {
        ...hydrated,
        selectedRef: selector,
        updatePolicy: "default-branch",
      };
    }
    this.updateCachedPackage(hydrated, cache.manifests);
    return hydrated;
  }

  async inspectResolvedManifest(pack, resolvedSha, selectedRef) {
    if (!/^[0-9a-f]{40}$/i.test(resolvedSha || "")) {
      throw new Error("A complete resolved commit SHA is required to inspect an update.");
    }
    const install = pack.apmInstallSource || {};
    const source = install.repository || install.source || pack.repository;
    const parsed = parsePackageSource(source);
    const originKey =
      install.origin || pack.originKey || normalizeRepositoryOrigin(parsed.repository);
    if (!originKey) throw new Error("The installed package receipt has no valid origin.");

    const cache = this.readCache() || {
      schemaVersion: CACHE_SCHEMA_VERSION,
      lastFetch: null,
      catalogSources: [],
      manifests: {},
      readmes: {},
      packages: {},
    };
    cache.manifests ||= {};
    const cacheKey = `${originKey}@${resolvedSha.toLowerCase()}`;
    let metadata = cache.manifests[cacheKey];
    if (!metadata) {
      // Receipts may point at private HTTPS or SSH repositories. Inspect them
      // through Git so the user's normal Git credentials apply; catalog
      // hydration remains restricted to public sources and raw adapters.
      metadata = await this.fetchManifest(
        { originKey, repository: parsed.repository, manualSource: true },
        resolvedSha,
        null,
      );
      cache.manifests[cacheKey] = metadata;
      this.writeCache(cache);
    }

    const semanticTag =
      selectedRef && (selectedRef.type === "tag" || selectedRef.type === "latest")
        ? selectedRef.value
        : null;
    const currentLumineVersion = this.lumineVersion();
    return validatePackageMetadata(metadata, {
      originKey,
      semanticTag,
      lumineVersion:
        typeof currentLumineVersion === "string" ? currentLumineVersion.split("-")[0] : null,
    });
  }

  listRefs(source, includeBranches) {
    if (!this.packageManager) throw new Error("Git ref resolver is unavailable.");
    return listPackageRepositoryRefs(
      source,
      async (cloneUrl, options, patterns) => {
        const { stdout } = await this.packageManager.runProcess(
          this.packageManager.getGitCommand(),
          ["ls-remote", ...options, cloneUrl, ...patterns],
          { timeoutMs: GIT_REF_TIMEOUT },
        );
        return stdout;
      },
      { includeBranches },
    );
  }

  resolveSource(source) {
    if (!this.packageManager) throw new Error("Git ref resolver is unavailable.");
    return resolvePackageSource(source, async (cloneUrl, options, patterns) => {
      const { stdout } = await this.packageManager.runProcess(
        this.packageManager.getGitCommand(),
        ["ls-remote", ...options, cloneUrl, ...patterns],
        { timeoutMs: GIT_REF_TIMEOUT },
      );
      return stdout;
    });
  }

  async fetchManifest(record, sha, signal) {
    if (record.originKey.startsWith("github.com/") && !record.manualSource) {
      const repoPath = record.originKey.slice("github.com/".length);
      let lastError;
      for (const filename of ["package.json", "package.jsonc", "package.cson"]) {
        const url = `https://raw.githubusercontent.com/${repoPath}/${sha}/${filename}`;
        try {
          const body = await this.httpQueue.add(
            () =>
              this.requestText(url, { signal, maxBytes: MAX_MANIFEST_BYTES, allowNotFound: true }),
            "raw.githubusercontent.com",
            signal,
          );
          if (body == null) continue;
          return parseManifestBody(filename, body);
        } catch (error) {
          lastError = error;
        }
      }
      if (lastError) throw lastError;
      throw new Error("Repository does not contain package.json, package.jsonc, or package.cson.");
    }
    return this.gitQueue.add(
      () => this.fetchManifestWithGit(record, sha),
      hostForRepository(record.repository),
      signal,
    );
  }

  async fetchManifestWithGit(record, sha) {
    if (!this.packageManager) throw new Error("Generic Git manifest fetch is unavailable.");
    const cloneDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), "lumine-catalog-"));
    try {
      const git = this.packageManager.getGitCommand();
      await this.packageManager.runProcess(git, ["init"], {
        cwd: cloneDir,
        timeoutMs: GIT_REF_TIMEOUT,
      });
      await this.packageManager.runProcess(
        git,
        ["remote", "add", "origin", cloneUrlForRepository(record.repository)],
        { cwd: cloneDir, timeoutMs: GIT_REF_TIMEOUT },
      );
      await this.packageManager.runProcess(git, ["fetch", "--depth", "1", "origin", sha], {
        cwd: cloneDir,
        timeoutMs: GIT_FETCH_TIMEOUT,
      });
      await this.packageManager.runProcess(git, ["checkout", "--detach", "FETCH_HEAD"], {
        cwd: cloneDir,
        timeoutMs: GIT_REF_TIMEOUT,
      });
      const metadataPath = CSON.resolve(path.join(cloneDir, "package"));
      if (!metadataPath) throw new Error("Repository does not contain a package manifest.");
      return CSON.readFileSync(metadataPath);
    } finally {
      await fs.promises.rm(cloneDir, { recursive: true, force: true });
    }
  }

  async fetchReadmeWithGit(pack) {
    if (!this.packageManager) return null;
    const cloneDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), "lumine-readme-"));
    try {
      const git = this.packageManager.getGitCommand();
      await this.packageManager.runProcess(git, ["init"], {
        cwd: cloneDir,
        timeoutMs: GIT_REF_TIMEOUT,
      });
      await this.packageManager.runProcess(
        git,
        ["remote", "add", "origin", cloneUrlForRepository(pack.repository)],
        { cwd: cloneDir, timeoutMs: GIT_REF_TIMEOUT },
      );
      await this.packageManager.runProcess(
        git,
        ["fetch", "--depth", "1", "origin", pack.resolvedSha],
        { cwd: cloneDir, timeoutMs: GIT_FETCH_TIMEOUT },
      );
      await this.packageManager.runProcess(git, ["checkout", "--detach", "FETCH_HEAD"], {
        cwd: cloneDir,
        timeoutMs: GIT_REF_TIMEOUT,
      });
      const filename = (await fs.promises.readdir(cloneDir)).find((name) =>
        /^readme(?:\.|$)/i.test(name),
      );
      if (!filename) return null;
      const filePath = path.join(cloneDir, filename);
      const stat = await fs.promises.stat(filePath);
      if (!stat.isFile() || stat.size > MAX_README_BYTES) return null;
      return {
        body: await fs.promises.readFile(filePath, "utf8"),
        source: pack.repository,
        accessedAt: this.now(),
      };
    } finally {
      await fs.promises.rm(cloneDir, { recursive: true, force: true });
    }
  }

  async fetchLicenseWithGit(pack) {
    if (!this.packageManager) return null;
    const cloneDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), "lumine-license-"));
    try {
      const git = this.packageManager.getGitCommand();
      await this.packageManager.runProcess(git, ["init"], {
        cwd: cloneDir,
        timeoutMs: GIT_REF_TIMEOUT,
      });
      await this.packageManager.runProcess(
        git,
        ["remote", "add", "origin", cloneUrlForRepository(pack.repository)],
        { cwd: cloneDir, timeoutMs: GIT_REF_TIMEOUT },
      );
      await this.packageManager.runProcess(
        git,
        ["fetch", "--depth", "1", "origin", pack.resolvedSha],
        { cwd: cloneDir, timeoutMs: GIT_FETCH_TIMEOUT },
      );
      await this.packageManager.runProcess(git, ["checkout", "--detach", "FETCH_HEAD"], {
        cwd: cloneDir,
        timeoutMs: GIT_REF_TIMEOUT,
      });
      const filename = (await fs.promises.readdir(cloneDir)).find((name) =>
        LICENSE_FILE_PATTERN.test(name),
      );
      if (!filename) return null;
      const filePath = path.join(cloneDir, filename);
      const stat = await fs.promises.stat(filePath);
      if (!stat.isFile() || stat.size > MAX_README_BYTES) return null;
      return {
        body: await fs.promises.readFile(filePath, "utf8"),
        source: pack.repository,
        filename,
        isMarkdown: /\.(md|markdown)$/i.test(filename),
        accessedAt: this.now(),
      };
    } finally {
      await fs.promises.rm(cloneDir, { recursive: true, force: true });
    }
  }

  async requestText(url, { signal = null, maxBytes, allowNotFound = false } = {}) {
    let attempt = 0;
    while (true) {
      if (signal && signal.aborted) throw abortError();
      const timeoutController = new AbortController();
      const timeout = setTimeout(() => timeoutController.abort(), REQUEST_TIMEOUT);
      const abortListener = () => timeoutController.abort();
      if (signal) signal.addEventListener("abort", abortListener, { once: true });
      try {
        const response = await this.fetchImpl(url, {
          signal: timeoutController.signal,
          headers: { "User-Agent": global.navigator ? navigator.userAgent : "Lumine" },
        });
        if (allowNotFound && response && response.status === 404) return null;
        if (!response || response.status < 200 || response.status >= 300) {
          const error = new Error(
            `Request failed with status ${response && response.status ? response.status : "unknown"}.`,
          );
          error.status = response && response.status;
          error.retryAfter = response && response.headers && response.headers.get("retry-after");
          throw error;
        }
        const length = Number(response.headers && response.headers.get("content-length"));
        if (length && length > maxBytes) throw new Error("Response exceeds the size limit.");
        const body = await response.text();
        if (Buffer.byteLength(body) > maxBytes) throw new Error("Response exceeds the size limit.");
        return body;
      } catch (error) {
        if (signal && signal.aborted) throw error;
        const retryable = !error.status || error.status === 429 || error.status >= 500;
        if (attempt >= 2 || !retryable) throw error;
        const retryAfterSeconds = Number(error.retryAfter);
        const retryAfterDate = Date.parse(error.retryAfter);
        const retryAfterDelay =
          Number.isFinite(retryAfterSeconds) && retryAfterSeconds > 0
            ? retryAfterSeconds * 1000
            : Number.isFinite(retryAfterDate)
              ? retryAfterDate - this.now()
              : 0;
        const delayMs = retryAfterDelay > 0 ? Math.min(retryAfterDelay, 5000) : 250 * 2 ** attempt;
        attempt++;
        await this.delay(delayMs);
      } finally {
        clearTimeout(timeout);
        if (signal) signal.removeEventListener("abort", abortListener);
      }
    }
  }

  async assertPublicHostname(hostname) {
    const lookupHostname = String(hostname).replace(/^\[|\]$/g, "");
    if (isPrivateAddress(lookupHostname)) {
      throw new Error(`Refusing a private or local network host: ${lookupHostname}.`);
    }
    // Reserved documentation/test TLDs are commonly used with injected fetch
    // implementations and can never identify a real network destination.
    if (/\.(?:test|example|invalid)$/i.test(lookupHostname)) return;
    if (lookupHostname === "github.com" || lookupHostname === "raw.githubusercontent.com") return;
    if (!this.dnsChecks.has(lookupHostname)) {
      this.dnsChecks.set(
        lookupHostname,
        dns.promises.lookup(lookupHostname, { all: true }).then((addresses) => {
          if (!addresses.length || addresses.some(({ address }) => isPrivateAddress(address))) {
            throw new Error(
              `Refusing a host that resolves to a private network: ${lookupHostname}.`,
            );
          }
          return true;
        }),
      );
    }
    return this.dnsChecks.get(lookupHostname);
  }

  packagesForSources(cache, catalogSources) {
    if (!cache || !cache.packages) return [];
    const allowed = new Set(catalogSources);
    return Object.values(cache.packages).filter((pack) =>
      (pack.catalogSources || []).some((source) => allowed.has(source)),
    );
  }

  cacheFilePath() {
    return path.join(this.cachePath, "package-catalog-v2.json");
  }

  readCache() {
    try {
      const serialized = this.storage
        ? this.storage.getItem("settings-view:package-catalog-v2")
        : fs.readFileSync(this.cacheFilePath(), "utf8");
      if (!serialized) return null;
      const cache = JSON.parse(serialized);
      return cache.schemaVersion === CACHE_SCHEMA_VERSION ? cache : null;
    } catch {
      return null;
    }
  }

  writeCache(cache) {
    this.cacheWriteVersion = (this.cacheWriteVersion || 0) + 1;
    const serialized = JSON.stringify(cache);
    if (this.storage) {
      this.storage.setItem("settings-view:package-catalog-v2", serialized);
      return;
    }
    fs.mkdirSync(this.cachePath, { recursive: true });
    const target = this.cacheFilePath();
    const temporary = `${target}.${process.pid}.next`;
    fs.writeFileSync(temporary, serialized);
    fs.renameSync(temporary, target);
  }

  async writeCacheAsync(cache) {
    const version = (this.cacheWriteVersion = (this.cacheWriteVersion || 0) + 1);
    const serialized = JSON.stringify(cache);
    if (this.storage) {
      this.storage.setItem("settings-view:package-catalog-v2", serialized);
      return;
    }
    const write = async () => {
      if (version !== this.cacheWriteVersion) return;
      await fs.promises.mkdir(this.cachePath, { recursive: true });
      const target = this.cacheFilePath();
      const sequence = (this.cacheWriteSequence = (this.cacheWriteSequence || 0) + 1);
      const temporary = `${target}.${process.pid}.${sequence}.next`;
      await fs.promises.writeFile(temporary, serialized);
      if (version !== this.cacheWriteVersion) {
        await fs.promises.unlink(temporary).catch(() => {});
        return;
      }
      fs.renameSync(temporary, target);
    };
    this.cacheWritePromise = (this.cacheWritePromise || Promise.resolve())
      .catch(() => {})
      .then(write);
    return this.cacheWritePromise;
  }

  updateCachedPackage(pack, manifests = null) {
    const cache = this.readCache() || {
      schemaVersion: CACHE_SCHEMA_VERSION,
      lastFetch: this.now(),
      catalogSources: [],
      manifests: {},
      readmes: {},
      packages: {},
    };
    cache.packages[pack.originKey] = pack;
    if (manifests) cache.manifests = manifests;
    this.writeCache(cache);
  }

  // Merges the results of an installed-package update check into the cached
  // catalog entries (matched by origin) so browse cards reflect the newer data
  // without a full catalog fetch. Writes only when something actually changed.
  mergeInstalledUpdates(packs) {
    const cache = this.readCache();
    if (!cache || !cache.packages) return;
    let changed = false;
    for (const pack of packs || []) {
      const originKey =
        pack.originKey || (pack.apmInstallSource && pack.apmInstallSource.origin) || null;
      const existing = originKey && cache.packages[originKey];
      if (!existing) continue;
      cache.packages[originKey] = {
        ...existing,
        latestSha: pack.latestSha,
        latestVersion: pack.latestVersion,
        resolvedRef: pack.resolvedRef,
        suspiciousTagMove: pack.suspiciousTagMove,
        originWarning: pack.originWarning,
        renamedPackage: pack.renamedPackage,
      };
      changed = true;
    }
    if (changed) this.writeCache(cache);
  }
};

module.exports.CACHE_SCHEMA_VERSION = CACHE_SCHEMA_VERSION;
module.exports.GIT_CONCURRENCY = GIT_CONCURRENCY;
module.exports.HTTP_CONCURRENCY = HTTP_CONCURRENCY;
module.exports.MAX_REPOSITORIES = MAX_REPOSITORIES;
module.exports.TaskQueue = TaskQueue;
module.exports.normalizeCatalogSource = normalizeCatalogSource;
