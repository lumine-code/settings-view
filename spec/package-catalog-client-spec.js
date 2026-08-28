const fs = require("fs");
const os = require("os");
const path = require("path");
const PackageCatalogClient = require("../lib/package-catalog-client");
const { normalizeCatalogSource, TaskQueue } = PackageCatalogClient;

const SHA_1 = "1111111111111111111111111111111111111111";
const SHA_2 = "2222222222222222222222222222222222222222";

function createSnapshot({
  repository = "owner/package",
  source = repository,
  name = "sample-package",
  sha = SHA_1,
  version = "1.0.0",
  description = "From its catalog snapshot",
  featured,
} = {}) {
  const tag = { name: `v${version}`, version, sha };
  return {
    source,
    ...(featured === undefined ? {} : { featured }),
    resolvedSha: sha,
    selectedRef: { type: "latest", value: tag.name },
    refs: {
      defaultBranch: "main",
      headSha: SHA_2,
      latestStable: tag,
      tags: [tag],
    },
    metadata: {
      name,
      version,
      description,
      repository,
      engines: { lumine: "*" },
    },
  };
}

function createStorage() {
  const values = new Map();
  return {
    getItem(key) {
      return values.get(key) || null;
    },
    setItem(key, value) {
      values.set(key, value);
    },
  };
}

function textResponse(status, body, headers = {}) {
  return {
    status,
    headers: { get: (name) => headers[name.toLowerCase()] || null },
    text: () => Promise.resolve(typeof body === "string" ? body : JSON.stringify(body)),
  };
}

function createPackageManager({ branches = false } = {}) {
  return {
    getGitCommand: () => "git",
    runProcess: jasmine.createSpy("runProcess").and.callFake((_command, args) => {
      if (args[0] !== "ls-remote") return Promise.resolve({ stdout: "" });
      const includeBranches = args.includes("refs/heads/*");
      return Promise.resolve({
        stdout: [
          "ref: refs/heads/main\tHEAD",
          `${SHA_1}\tHEAD`,
          `${SHA_1}\trefs/tags/v1.0.0`,
          `${SHA_2}\trefs/tags/v2.0.0-beta.1`,
          ...(includeBranches || branches
            ? [`${SHA_1}\trefs/heads/main`, `${SHA_2}\trefs/heads/Next`]
            : []),
        ].join("\n"),
      });
    }),
  };
}

function createFetch(catalogs = {}) {
  return jasmine.createSpy("fetchImpl").and.callFake((url) => {
    if (Object.hasOwn(catalogs, url)) return Promise.resolve(textResponse(200, catalogs[url]));
    if (url.includes("raw.githubusercontent.com/owner/package/")) {
      return Promise.resolve(
        textResponse(200, {
          name: "sample-package",
          version: "1.0.0",
          description: "From its repository",
          repository: "https://github.com/OWNER/package.git",
          engines: { lumine: "*" },
          readme: "# Must remain lazy",
          badges: [{ image: "https://example.test/badge.svg" }],
        }),
      );
    }
    return Promise.resolve(textResponse(404, "not found"));
  });
}

describe("PackageCatalogClient", function () {
  it("does not let an older async filesystem write overwrite a newer sync write", async () => {
    const cachePath = fs.mkdtempSync(path.join(os.tmpdir(), "lumine-catalog-cache-"));
    const client = new PackageCatalogClient({ cachePath });
    const originalWriteFile = fs.promises.writeFile.bind(fs.promises);
    let releaseWrite;
    const heldWrite = new Promise((resolve) => {
      releaseWrite = resolve;
    });
    const writeFile = spyOn(fs.promises, "writeFile").and.callFake(async (...args) => {
      await originalWriteFile(...args);
      await heldWrite;
    });

    try {
      const pendingWrite = client.writeCacheAsync({ schemaVersion: 2, marker: "old" });
      await conditionPromise(() => writeFile.calls.count() === 1);
      client.writeCache({ schemaVersion: 2, marker: "new" });
      releaseWrite();
      await pendingWrite;

      expect(client.readCache().marker).toBe("new");
    } finally {
      releaseWrite();
      fs.rmSync(cachePath, { recursive: true, force: true });
    }
  });

  it("normalizes index.json catalog locations", function () {
    expect(normalizeCatalogSource("owner/catalog")).toBe(
      "https://raw.githubusercontent.com/owner/catalog/HEAD/index.json",
    );
    expect(normalizeCatalogSource("https://github.com/owner/catalog.git")).toBe(
      "https://raw.githubusercontent.com/owner/catalog/HEAD/index.json",
    );
    expect(normalizeCatalogSource("https://catalog.example/community")).toBe(
      "https://catalog.example/community/index.json",
    );
    expect(normalizeCatalogSource("https://example.test/index.json")).toBe(
      "https://example.test/index.json",
    );
  });

  it("accepts source strings and pre-resolved snapshots, and rejects the old metadata schema", function () {
    const client = new PackageCatalogClient({ storage: createStorage() });
    const entries = client.validate(["owner/package@1.0.0", createSnapshot()]);
    expect(entries[0]).toEqual(
      jasmine.objectContaining({
        originKey: "github.com/owner/package",
        repository: "owner/package",
        selector: { type: "tag", value: "1.0.0" },
      }),
    );
    expect(entries[1].catalogSnapshot).toEqual(
      jasmine.objectContaining({
        featured: false,
        resolvedSha: SHA_1,
        selectedRef: { type: "latest", value: "v1.0.0" },
      }),
    );
    expect(() => client.validate({ schemaVersion: 1, packages: [] })).toThrow();
    expect(() => client.validate(["owner/package#abcdef1"])).toThrow();
  });

  it("uses a valid catalog snapshot without repository or manifest requests", async () => {
    const catalogUrl = "https://catalog.test/index.json";
    const packageManager = createPackageManager();
    const fetchImpl = createFetch({ [catalogUrl]: [createSnapshot({ featured: true })] });
    const client = new PackageCatalogClient({
      fetchImpl,
      packageManager,
      storage: createStorage(),
      lumineVersion: () => "1.132.1",
    });

    const catalog = await client.loadAll([catalogUrl], { refresh: true });

    expect(catalog.packages[0]).toEqual(
      jasmine.objectContaining({
        name: "sample-package",
        version: "1.0.0",
        featured: true,
        resolvedSha: SHA_1,
        selectedRef: { type: "latest", value: "v1.0.0" },
        updatePolicy: "latest-tag",
        status: "ready",
      }),
    );
    expect(catalog.packages[0].metadata).toBeUndefined();
    expect(packageManager.runProcess).not.toHaveBeenCalled();
    expect(fetchImpl.calls.count()).toBe(1);
    expect(fetchImpl.calls.mostRecent().args[0]).toBe(catalogUrl);
  });

  it("hydrates source-only and snapshot entries together in one mixed catalog", async () => {
    const catalogUrl = "https://catalog.test/index.json";
    const packageManager = createPackageManager();
    const fetchImpl = createFetch({
      [catalogUrl]: [
        "owner/package",
        createSnapshot({
          repository: "owner/snapshot-package",
          name: "snapshot-package",
        }),
      ],
    });
    const client = new PackageCatalogClient({
      fetchImpl,
      packageManager,
      storage: createStorage(),
    });

    const catalog = await client.loadAll([catalogUrl], { refresh: true });

    expect(catalog.packages.map(({ name }) => name).sort()).toEqual([
      "sample-package",
      "snapshot-package",
    ]);
    expect(packageManager.runProcess.calls.count()).toBe(1);
    expect(fetchImpl.calls.count()).toBe(2);
  });

  it("accepts pre-resolved default-branch, branch, tag, and commit selections", async () => {
    const catalogUrl = "https://catalog.test/index.json";
    const defaultBranch = createSnapshot({
      repository: "owner/default-package",
      name: "default-package",
      sha: SHA_1,
    });
    defaultBranch.selectedRef = { type: "default", value: "main" };
    defaultBranch.refs = {
      defaultBranch: "main",
      headSha: SHA_1,
      latestStable: null,
      tags: [{ name: "v2.0.0-beta.1", version: "2.0.0-beta.1", sha: SHA_2 }],
    };
    const branch = createSnapshot({
      repository: "owner/branch-package",
      source: "owner/branch-package~next",
      name: "branch-package",
    });
    branch.selectedRef = { type: "branch", value: "next" };
    const tag = createSnapshot({
      repository: "owner/tag-package",
      source: "owner/tag-package@1.0.0",
      name: "tag-package",
    });
    tag.selectedRef = { type: "tag", value: "v1.0.0" };
    const commit = createSnapshot({
      repository: "owner/commit-package",
      source: `owner/commit-package#${SHA_1}`,
      name: "commit-package",
    });
    commit.selectedRef = { type: "commit", value: SHA_1 };

    const packageManager = createPackageManager();
    const client = new PackageCatalogClient({
      fetchImpl: createFetch({ [catalogUrl]: [defaultBranch, branch, tag, commit] }),
      packageManager,
      storage: createStorage(),
    });

    const catalog = await client.loadAll([catalogUrl], { refresh: true });
    const policies = Object.fromEntries(
      catalog.packages.map((pack) => [pack.name, pack.updatePolicy]),
    );

    expect(policies).toEqual({
      "default-package": "default-branch",
      "branch-package": "branch",
      "tag-package": "pinned",
      "commit-package": "pinned",
    });
    expect(packageManager.runProcess).not.toHaveBeenCalled();
  });

  it("falls back to live hydration when a safe snapshot is invalid", async () => {
    const catalogUrl = "https://catalog.test/index.json";
    const invalidSnapshot = { ...createSnapshot({ featured: true }), unexpected: true };
    const packageManager = createPackageManager();
    const fetchImpl = createFetch({ [catalogUrl]: [invalidSnapshot] });
    const client = new PackageCatalogClient({
      fetchImpl,
      packageManager,
      storage: createStorage(),
    });

    const catalog = await client.loadAll([catalogUrl], { refresh: true });

    expect(catalog.packages[0]).toEqual(
      jasmine.objectContaining({
        name: "sample-package",
        featured: false,
        resolvedSha: SHA_1,
        status: "ready",
      }),
    );
    expect(packageManager.runProcess).toHaveBeenCalled();
    expect(fetchImpl.calls.allArgs().some(([url]) => url.includes(`/${SHA_1}/package.json`))).toBe(
      true,
    );
  });

  it("does not accept featured promotion from a source-only package manifest", async () => {
    const catalogUrl = "https://catalog.test/index.json";
    const fetchImpl = jasmine.createSpy("fetchImpl").and.callFake((url) => {
      if (url === catalogUrl) return Promise.resolve(textResponse(200, ["owner/package"]));
      if (url.endsWith("/package.json")) {
        return Promise.resolve(
          textResponse(200, {
            name: "sample-package",
            version: "1.0.0",
            repository: "owner/package",
            engines: { lumine: "*" },
            featured: true,
          }),
        );
      }
      return Promise.resolve(textResponse(404, "not found"));
    });
    const client = new PackageCatalogClient({
      fetchImpl,
      packageManager: createPackageManager(),
      storage: createStorage(),
    });

    const catalog = await client.loadAll([catalogUrl], { refresh: true });

    expect(catalog.packages[0].featured).toBe(false);
  });

  it("keeps the first snapshot and reports a conflict when a later catalog has another SHA", async () => {
    const first = "https://one.test/index.json";
    const second = "https://two.test/index.json";
    const packageManager = createPackageManager();
    const client = new PackageCatalogClient({
      fetchImpl: createFetch({
        [first]: [createSnapshot({ description: "First catalog" })],
        [second]: [
          createSnapshot({
            sha: SHA_2,
            version: "2.0.0",
            description: "Second catalog",
            featured: true,
          }),
        ],
      }),
      packageManager,
      storage: createStorage(),
    });

    const catalog = await client.loadAll([first, second], { refresh: true });

    expect(catalog.packages).toHaveLength(1);
    expect(catalog.packages[0]).toEqual(
      jasmine.objectContaining({
        description: "First catalog",
        featured: false,
        resolvedSha: SHA_1,
        selectorConflict: true,
      }),
    );
    expect(catalog.packages[0].catalogSources).toEqual([first, second]);
    expect(packageManager.runProcess).not.toHaveBeenCalled();
  });

  it("merges installed-package update results into the cached entries", function () {
    const storage = createStorage();
    storage.setItem(
      "settings-view:package-catalog-v2",
      JSON.stringify({
        schemaVersion: 2,
        lastFetch: 1,
        catalogSources: ["https://catalog.test/index.json"],
        manifests: {},
        readmes: {},
        packages: {
          "github.com/owner/pkg": {
            originKey: "github.com/owner/pkg",
            name: "pkg",
            version: "1.0.0",
          },
        },
      }),
    );
    const client = new PackageCatalogClient({ storage });

    client.mergeInstalledUpdates([
      {
        apmInstallSource: { origin: "github.com/owner/pkg" },
        latestSha: "a".repeat(40),
        latestVersion: "1.1.0",
      },
      { apmInstallSource: { origin: "github.com/owner/absent" }, latestSha: "b".repeat(40) },
    ]);

    const cache = JSON.parse(storage.getItem("settings-view:package-catalog-v2"));
    expect(cache.packages["github.com/owner/pkg"].latestSha).toBe("a".repeat(40));
    expect(cache.packages["github.com/owner/pkg"].latestVersion).toBe("1.1.0");
    // Existing catalog fields are preserved, and unknown origins are ignored.
    expect(cache.packages["github.com/owner/pkg"].name).toBe("pkg");
    expect(cache.packages["github.com/owner/absent"]).toBeUndefined();
  });

  it("blocks unsafe automatic repository transports and local targets", function () {
    const client = new PackageCatalogClient({ storage: createStorage() });
    expect(() => client.validate(["git@github.com:owner/package.git"])).toThrow();
    expect(() => client.validate(["file:///tmp/package"])).toThrow();
    expect(() => client.validate(["https://127.0.0.1/package"])).toThrow();
    expect(() => client.validate(["https://user:secret@example.test/package"])).toThrow();
  });

  it("hydrates names and metadata from the exact selected SHA", async () => {
    const catalogUrl = "https://catalog.test/sources.json";
    const fetchImpl = createFetch({ [catalogUrl]: ["owner/package"] });
    const client = new PackageCatalogClient({
      fetchImpl,
      packageManager: createPackageManager(),
      storage: createStorage(),
      lumineVersion: () => "1.132.1",
    });

    const catalog = await client.loadAll([catalogUrl], { refresh: true });
    expect(catalog.packages.length).toBe(1);
    expect(catalog.packages[0]).toEqual(
      jasmine.objectContaining({
        name: "sample-package",
        originKey: "github.com/owner/package",
        resolvedSha: SHA_1,
        selectedRef: { type: "latest", value: "v1.0.0" },
        status: "ready",
        readme: undefined,
        badges: [],
      }),
    );
    expect(
      fetchImpl.calls.allArgs().some((args) => args[0].includes(`/${SHA_1}/package.json`)),
    ).toBe(true);
  });

  it("shows an engine-incompatible package instead of rejecting it", async () => {
    const catalogUrl = "https://catalog.test/index.json";
    const fetchImpl = jasmine.createSpy("fetchImpl").and.callFake((url) => {
      if (url === catalogUrl) return Promise.resolve(textResponse(200, ["owner/package"]));
      if (url.includes(`/${SHA_1}/package.json`)) {
        return Promise.resolve(
          textResponse(200, {
            name: "sample-package",
            version: "1.0.0",
            repository: "https://github.com/owner/package.git",
            engines: { lumine: ">=999.0.0" },
          }),
        );
      }
      return Promise.resolve(textResponse(404, "not found"));
    });
    const client = new PackageCatalogClient({
      fetchImpl,
      packageManager: createPackageManager(),
      storage: createStorage(),
      lumineVersion: () => "1.132.1",
    });

    const catalog = await client.loadAll([catalogUrl], { refresh: true });
    expect(catalog.packages[0]).toEqual(
      jasmine.objectContaining({
        name: "sample-package",
        originKey: "github.com/owner/package",
        status: "ready",
      }),
    );
    expect(catalog.packages[0].engines).toEqual({ lumine: ">=999.0.0" });
  });

  it("clears an earlier origin mismatch once a corrected release is published", async () => {
    const catalogUrl = "https://catalog.test/sources.json";
    // v1.0.0 ships a manifest whose repository points at the wrong origin; a
    // later v1.1.0 corrects it. Manifests are keyed by SHA, so the corrected
    // release is fetched fresh instead of reusing the rejected manifest.
    let tags = [`${SHA_1}\trefs/tags/v1.0.0`];
    const packageManager = {
      getGitCommand: () => "git",
      runProcess: jasmine.createSpy("runProcess").and.callFake((_command, args) => {
        if (args[0] !== "ls-remote") return Promise.resolve({ stdout: "" });
        return Promise.resolve({
          stdout: ["ref: refs/heads/main\tHEAD", `${SHA_1}\tHEAD`, ...tags].join("\n"),
        });
      }),
    };
    const fetchImpl = jasmine.createSpy("fetchImpl").and.callFake((url) => {
      if (url === catalogUrl) return Promise.resolve(textResponse(200, ["owner/package"]));
      if (url.includes(`/${SHA_1}/package.json`)) {
        return Promise.resolve(
          textResponse(200, {
            name: "sample-package",
            version: "1.0.0",
            repository: "https://github.com/someone-else/package.git",
            engines: { lumine: "*" },
          }),
        );
      }
      if (url.includes(`/${SHA_2}/package.json`)) {
        return Promise.resolve(
          textResponse(200, {
            name: "sample-package",
            version: "1.1.0",
            repository: "https://github.com/owner/package.git",
            engines: { lumine: "*" },
          }),
        );
      }
      return Promise.resolve(textResponse(404, "not found"));
    });
    const client = new PackageCatalogClient({
      fetchImpl,
      packageManager,
      storage: createStorage(),
      lumineVersion: () => "1.132.1",
    });

    const catalog = await client.loadAll([catalogUrl], { refresh: true }).then((catalog) => {
      // The mismatched manifest fails strict origin validation.
      expect(catalog.packages[0]).toEqual(
        jasmine.objectContaining({
          originKey: "github.com/owner/package",
          status: "error",
          unverifiedName: true,
        }),
      );
      // Upstream corrects the repository field and publishes a new stable tag.
      tags = [`${SHA_1}\trefs/tags/v1.0.0`, `${SHA_2}\trefs/tags/v1.1.0`];
      return client.loadAll([catalogUrl], { refresh: true });
    });
    expect(catalog.packages[0]).toEqual(
      jasmine.objectContaining({
        name: "sample-package",
        originKey: "github.com/owner/package",
        resolvedSha: SHA_2,
        selectedRef: { type: "latest", value: "v1.1.0" },
        status: "ready",
      }),
    );
  });

  it("inspects an installed update at its exact SHA through Git", async () => {
    const storage = createStorage();
    const client = new PackageCatalogClient({
      packageManager: createPackageManager(),
      storage,
      lumineVersion: () => "1.132.1",
    });
    spyOn(client, "fetchManifest").and.returnValue(
      Promise.resolve({
        name: "renamed-package",
        version: "2.0.0",
        repository: "owner/package",
        engines: { lumine: "*" },
      }),
    );

    const metadata = await client.inspectResolvedManifest(
      {
        name: "old-package",
        apmInstallSource: {
          origin: "github.com/owner/package",
          repository: "owner/package",
        },
      },
      SHA_2,
      { type: "latest", value: "v2.0.0" },
    );
    expect(metadata.name).toBe("renamed-package");
    expect(client.fetchManifest).toHaveBeenCalledWith(
      {
        originKey: "github.com/owner/package",
        repository: "owner/package",
        manualSource: true,
      },
      SHA_2,
      null,
    );
  });

  it("uses the persistent cache without automatic revalidation", async () => {
    const catalogUrl = "https://catalog.test/sources.json";
    const storage = createStorage();
    const fetchImpl = createFetch({ [catalogUrl]: ["owner/package"] });
    const client = new PackageCatalogClient({
      fetchImpl,
      packageManager: createPackageManager(),
      storage,
    });

    const catalog = await client
      .loadAll([catalogUrl], { refresh: true })
      .then(() => {
        fetchImpl.calls.reset();
        return client.loadAll([catalogUrl]);
      })
      .then((catalog) => {
        expect(catalog.cached).toBe(true);
        expect(catalog.packages[0].name).toBe("sample-package");
        expect(fetchImpl).not.toHaveBeenCalled();
        return client.loadAll([catalogUrl, "new/catalog"], { cacheOnly: true });
      });
    expect(catalog.packages[0].name).toBe("sample-package");
    expect(catalog.pendingSources).toEqual([
      "https://raw.githubusercontent.com/new/catalog/HEAD/index.json",
    ]);
  });

  it("preserves the complete previous cache when a refresh is cancelled", async () => {
    const catalogUrl = "https://catalog.test/sources.json";
    const storage = createStorage();
    storage.setItem(
      "settings-view:package-catalog-v2",
      JSON.stringify({
        schemaVersion: 2,
        lastFetch: 123,
        catalogSources: [catalogUrl],
        manifests: {},
        readmes: {},
        packages: {
          "github.com/owner/package": {
            name: "cached-package",
            originKey: "github.com/owner/package",
            repository: "owner/package",
            installSource: "owner/package",
            catalogSources: [catalogUrl],
            status: "ready",
          },
        },
      }),
    );
    const client = new PackageCatalogClient({
      fetchImpl: createFetch({ [catalogUrl]: ["owner/package"] }),
      packageManager: createPackageManager(),
      storage,
    });

    const catalog = await client
      .loadAll([catalogUrl], {
        refresh: true,
        onProgress({ processed }) {
          if (processed === 0) client.cancel();
        },
      })
      .then((catalog) => {
        expect(catalog.cancelled).toBe(true);
        expect(catalog.lastFetch).toBe(123);
        expect(catalog.packages.map(({ name }) => name)).toEqual(["cached-package"]);
        return client.loadAll([catalogUrl], { cacheOnly: true });
      });
    expect(catalog.packages.map(({ name }) => name)).toEqual(["cached-package"]);
  });

  it("merges provenance and keeps the first catalog selector", async () => {
    const first = "https://one.test/sources.json";
    const second = "https://two.test/sources.json";
    const client = new PackageCatalogClient({
      fetchImpl: createFetch({
        [first]: ["owner/package@1.0.0"],
        [second]: ["https://github.com/owner/package.git#branch:Next"],
      }),
      packageManager: createPackageManager(),
      storage: createStorage(),
    });
    const catalog = await client.loadAll([first, second], { refresh: true });
    expect(catalog.packages.length).toBe(1);
    expect(catalog.packages[0].installSource).toBe("owner/package@1.0.0");
    expect(catalog.packages[0].catalogSources).toEqual([first, second]);
    expect(catalog.packages[0].selectorConflict).toBe(true);
  });

  it("loads the complete branch list lazily and caches it", async () => {
    const catalogUrl = "https://catalog.test/sources.json";
    const packageManager = createPackageManager();
    const client = new PackageCatalogClient({
      fetchImpl: createFetch({ [catalogUrl]: ["owner/package"] }),
      packageManager,
      storage: createStorage(),
    });
    const pack = await client.loadAll([catalogUrl], { refresh: true }).then((catalog) => {
      expect(catalog.packages[0].refs.branches).toBeNull();
      return client.loadBranches(catalog.packages[0]);
    });
    expect(pack.refs.branches.map(({ name }) => name)).toEqual(["main", "Next"]);
    expect(packageManager.runProcess.calls.mostRecent().args[1]).toContain("refs/heads/*");
  });

  it("preserves featured policy when a catalog source falls back to its cached entries", function () {
    const catalogUrl = "https://catalog.test/sources.json";
    const client = new PackageCatalogClient({ storage: createStorage() });
    const [record] = client.mergeCatalogs([{ url: catalogUrl, error: new Error("offline") }], {
      packages: {
        "github.com/owner/package": {
          originKey: "github.com/owner/package",
          repository: "owner/package",
          installSource: "owner/package",
          catalogSources: [catalogUrl],
          featured: true,
        },
      },
    });

    expect(record.featured).toBe(true);
  });

  it("keeps the previous hydrated record as stale when a repository refresh fails", async () => {
    const catalogUrl = "https://catalog.test/sources.json";
    const storage = createStorage();
    let sha = SHA_1;
    let failManifest = false;
    const packageManager = createPackageManager();
    packageManager.runProcess.and.callFake(() =>
      Promise.resolve({
        stdout: ["ref: refs/heads/main\tHEAD", `${sha}\tHEAD`, `${sha}\trefs/tags/v1.0.0`].join(
          "\n",
        ),
      }),
    );
    const fetchImpl = jasmine.createSpy("fetchImpl").and.callFake((url) => {
      if (url === catalogUrl) return Promise.resolve(textResponse(200, ["owner/package"]));
      if (failManifest) return Promise.resolve(textResponse(404, "missing"));
      return Promise.resolve(
        textResponse(200, {
          name: "sample-package",
          version: "1.0.0",
          repository: "owner/package",
          engines: { lumine: "*" },
        }),
      );
    });
    const client = new PackageCatalogClient({ fetchImpl, packageManager, storage });

    const catalog = await client.loadAll([catalogUrl], { refresh: true }).then(() => {
      sha = SHA_2;
      failManifest = true;
      return client.loadAll([catalogUrl], { refresh: true });
    });
    expect(catalog.packages[0].name).toBe("sample-package");
    expect(catalog.packages[0].status).toBe("stale");
    expect(catalog.packages[0].error).toContain("does not contain");
  });

  it("keeps a renderable origin-based error record when first hydration fails", async () => {
    const catalogUrl = "https://catalog.test/sources.json";
    const client = new PackageCatalogClient({
      fetchImpl: jasmine
        .createSpy("fetchImpl")
        .and.callFake((url) =>
          Promise.resolve(
            url === catalogUrl
              ? textResponse(200, ["owner/broken-package"])
              : textResponse(404, "missing"),
          ),
        ),
      packageManager: createPackageManager(),
      storage: createStorage(),
    });

    const catalog = await client.loadAll([catalogUrl], { refresh: true });
    expect(catalog.packages[0]).toEqual(
      jasmine.objectContaining({
        name: "broken-package",
        originKey: "github.com/owner/broken-package",
        unverifiedName: true,
        status: "error",
      }),
    );
  });

  it("rejects more than 2000 unique origins before hydration", async () => {
    const catalogUrl = "https://catalog.test/sources.json";
    const sources = Array.from({ length: 2001 }, (_value, index) => `owner/package-${index}`);
    const client = new PackageCatalogClient({
      fetchImpl: createFetch({ [catalogUrl]: sources }),
      packageManager: createPackageManager(),
      storage: createStorage(),
    });
    await client.loadAll([catalogUrl], { refresh: true }).then(
      () => Promise.reject(new Error("expected rejection")),
      (error) => expect(error.message).toContain("safety limit"),
    );
  });

  it("hydrates and persists an index of 1000 repositories with bounded host concurrency", async () => {
    const catalogUrl = "https://catalog.test/sources.json";
    const sources = Array.from({ length: 1000 }, (_value, index) => `owner/package-${index}`);
    const storage = createStorage();
    let activeGit = 0;
    let activeHttp = 0;
    let maximumGit = 0;
    let maximumHttp = 0;
    let finalProgress = null;
    const packageManager = {
      getGitCommand: () => "git",
      runProcess: jasmine.createSpy("runProcess").and.callFake(() => {
        activeGit++;
        maximumGit = Math.max(maximumGit, activeGit);
        return Promise.resolve().then(() => {
          activeGit--;
          return {
            stdout: [
              "ref: refs/heads/main\tHEAD",
              `${SHA_1}\tHEAD`,
              `${SHA_1}\trefs/tags/v1.0.0`,
            ].join("\n"),
          };
        });
      }),
    };
    const fetchImpl = jasmine.createSpy("fetchImpl").and.callFake((url) => {
      activeHttp++;
      maximumHttp = Math.max(maximumHttp, activeHttp);
      return Promise.resolve().then(() => {
        activeHttp--;
        if (url === catalogUrl) return textResponse(200, sources);
        const match = url.match(/\/owner\/(package-\d+)\//);
        return textResponse(200, {
          name: match[1],
          version: "1.0.0",
          repository: `owner/${match[1]}`,
          engines: { lumine: "*" },
        });
      });
    });
    const client = new PackageCatalogClient({
      fetchImpl,
      packageManager,
      storage,
    });

    const catalog = await client
      .loadAll([catalogUrl], {
        refresh: true,
        onProgress(progress) {
          finalProgress = progress;
        },
      })
      .then((catalog) => {
        expect(catalog.packages.length).toBe(1000);
        expect(finalProgress).toEqual({ processed: 1000, total: 1000, errors: 0 });
        expect(maximumGit).toBeLessThanOrEqual(8);
        expect(maximumHttp).toBeLessThanOrEqual(8);
        return new PackageCatalogClient({ storage }).loadAll([catalogUrl], {
          cacheOnly: true,
        });
      });
    expect(catalog.packages.length).toBe(1000);
  });

  it("loads README lazily at the exact SHA and reuses its bounded cache", async () => {
    const storage = createStorage();
    const fetchImpl = jasmine
      .createSpy("fetchImpl")
      .and.returnValue(Promise.resolve(textResponse(200, "# Exact README")));
    const client = new PackageCatalogClient({ fetchImpl, storage });
    const pack = {
      originKey: "github.com/owner/package",
      repository: "owner/package",
      resolvedSha: SHA_1,
    };
    const readme = await client.loadReadme(pack).then((readme) => {
      expect(readme.body).toBe("# Exact README");
      expect(fetchImpl.calls.mostRecent().args[0]).toContain(`/${SHA_1}/README.md`);
      fetchImpl.calls.reset();
      return client.loadReadme(pack);
    });
    expect(readme.body).toBe("# Exact README");
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("enforces queue and per-host concurrency", async () => {
    const queue = new TaskQueue(3, 2);
    let active = 0;
    let maximum = 0;
    let releaseTasks;
    const tasksMayFinish = new Promise((resolve) => {
      releaseTasks = resolve;
    });
    const tasks = Array.from({ length: 8 }, () =>
      queue.add(async () => {
        active++;
        maximum = Math.max(maximum, active);
        await tasksMayFinish;
        active--;
      }, "same-host"),
    );
    await conditionPromise(() => active === 2);
    releaseTasks();
    await Promise.all(tasks);
    expect(maximum).toBe(2);
  });

  it("retries transient HTTP failures with bounded backoff", async () => {
    let attempts = 0;
    const client = new PackageCatalogClient({
      fetchImpl: jasmine.createSpy("fetchImpl").and.callFake(() => {
        attempts++;
        return Promise.resolve(
          attempts === 1 ? textResponse(500, "temporary") : textResponse(200, "ready"),
        );
      }),
      storage: createStorage(),
      delay: () => Promise.resolve(),
    });

    const body = await client.requestText("https://catalog.test/sources.json", { maxBytes: 1024 });
    expect(body).toBe("ready");
    expect(attempts).toBe(2);
  });

  it("parses a JSON manifest as JSON rather than as CoffeeScript", async () => {
    const template = "{{ start.row }}{% if n > 1 %} #{{ n }}{% endif %}";
    const fetchImpl = jasmine.createSpy("fetchImpl").and.callFake((url) =>
      Promise.resolve(
        url.endsWith("/package.json")
          ? textResponse(200, {
              name: "sample-package",
              version: "1.0.0",
              repository: "owner/package",
              engines: { lumine: "*" },
              configSchema: { custom: { type: "string", default: template } },
            })
          : textResponse(404, "not found"),
      ),
    );
    const client = new PackageCatalogClient({ fetchImpl, storage: createStorage() });

    const metadata = await client.fetchManifest(
      { originKey: "github.com/owner/package", repository: "owner/package" },
      SHA_1,
      null,
    );
    expect(metadata.configSchema.custom.default).toBe(template);
  });

  it("parses a CSON manifest through the CSON parser", async () => {
    const fetchImpl = jasmine
      .createSpy("fetchImpl")
      .and.callFake((url) =>
        Promise.resolve(
          url.endsWith("/package.cson")
            ? textResponse(200, 'name: "sample-package"\nversion: "1.0.0"\n')
            : textResponse(404, "not found"),
        ),
      );
    const client = new PackageCatalogClient({ fetchImpl, storage: createStorage() });

    const metadata = await client.fetchManifest(
      { originKey: "github.com/owner/package", repository: "owner/package" },
      SHA_1,
      null,
    );
    expect(metadata).toEqual({ name: "sample-package", version: "1.0.0" });
  });
});
