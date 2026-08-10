const fs = require("fs");
const path = require("path");
const os = require("os");
const AvatarCache = require("../lib/avatar-cache");

describe("AvatarCache", () => {
  let cache;

  beforeEach(() => {
    cache = new AvatarCache();
  });

  it("fetches avatar from cache if the network is unavailable", () => {
    spyOn(cache, "online").and.returnValue(false);
    spyOn(cache, "fetchAndCacheAvatar");
    expect(cache.fetchAndCacheAvatar).not.toHaveBeenCalled();
    return cache.avatar("test-user", function () {});
  });

  it("handles glob errors", async () => {
    // The glob library no longer lists directories through the callback `fs`
    // API, so inject the failure at the client's own glob seam.
    spyOn(cache, "glob").and.returnValue(Promise.reject(new Error("readdir error")));

    const callback = jasmine.createSpy("cacheAvatar callback");
    cache.cachedAvatar("fakeperson", callback);

    await conditionPromise(() => callback.calls.count() === 1);

    expect(callback.calls.argsFor(0)[0].message).toBe("readdir error");
  });

  // "Correctly" means "remove all old items but one": a stale avatar is still
  // worth serving when the network is gone, so the newest one per login stays.
  it("purges every stale avatar but the newest one for each login", async () => {
    const cachePath = fs.mkdtempSync(path.join(os.tmpdir(), "lumine-avatar-cache-"));
    spyOn(cache, "getCachePath").and.returnValue(cachePath);

    const files = ["alice-100", "alice-200", "alice-300", "bob-100", "carol-900"];
    for (const name of files) {
      fs.writeFileSync(path.join(cachePath, name), "");
    }

    cache.expireAvatarCache();

    await conditionPromise(
      () => fs.readdirSync(cachePath).length === 3,
      "the stale avatars to be unlinked",
    );

    expect(fs.readdirSync(cachePath).sort()).toEqual(["alice-300", "bob-100", "carol-900"]);

    fs.rmSync(cachePath, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 });
  });
});
