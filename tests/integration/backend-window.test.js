const test = require("node:test");
const assert = require("node:assert/strict");

const { createIinaWindowHarness } = require("./iina-window-harness.js");

test("UI messages cross the standalone-window boundary into backend persistence and native actions", async () => {
  const harness = createIinaWindowHarness();
  const updates = [];
  const itemResults = [];
  const queueResults = [];
  harness.messaging.onMessage("update-items", (data) => updates.push(data));
  harness.messaging.onMessage("item-action-result", (data) => itemResults.push(data));
  harness.messaging.onMessage("queue-action-result", (data) => queueResults.push(data));

  harness.messaging.send("request-state", { indexRevision: -1 });
  assert.equal(updates.at(-1).atRoot, true);
  assert.deepEqual(Array.from(updates.at(-1).availableExtensions), ["mkv", "mp3"]);
  assert.equal(updates.at(-1).items.some((item) => item.path === "/media"), true);

  await harness.messaging.send("open-item", { path: "/outside/Escape.mkv", isDir: false });
  await harness.messaging.send("open-item", { path: "/media/Alpha.mkv", isDir: false });
  assert.deepEqual(harness.openedPaths, ["/media/Alpha.mkv"]);

  await harness.messaging.send("queue-add", {
    paths: ["/media/Beta.mp3", "/outside/Escape.mkv", "/media/Beta.mp3"],
  });
  assert.deepEqual(Array.from(queueResults.at(-1).succeeded), ["/media/Beta.mp3"]);
  assert.equal(queueResults.at(-1).failed.length, 1);
  assert.deepEqual(Array.from(harness.readJson(harness.statePath).queuePaths), ["/media/Beta.mp3"]);

  await harness.messaging.send("set-watched", {
    paths: ["/media/Alpha.mkv", "/outside/Escape.mkv"],
    watched: true,
  });
  assert.deepEqual(Array.from(itemResults.at(-1).succeeded), ["/media/Alpha.mkv"]);
  assert.equal(itemResults.at(-1).failed.length, 1);
  assert.equal(
    harness.readJson("@data/quick-folders-playback.json").records["/media/Alpha.mkv"].manualState,
    "watched",
  );

  await harness.messaging.send("save-browser-context", {
    path: "/media",
    focusedPath: "/media/Alpha.mkv",
    recents: [{ path: "/media" }],
  });

  harness.openWindow();
  assert.equal(harness.backendHandlerCounts.get("request-state"), 1);
  harness.messaging.send("request-state", { indexRevision: updates.at(-1).indexRevision });
  assert.equal(
    Object.hasOwn(updates.at(-1), "indexedFiles"),
    false,
    "the first handshake must remain compact",
  );
  harness.runDeferredCallbacks();
  assert.equal(Object.hasOwn(updates.at(-1), "indexedFiles"), true);

  await harness.messaging.send("remove-root", { path: "/media" });
  assert.deepEqual(Array.from(harness.readJson(harness.statePath).folderRoots), []);
  assert.deepEqual(harness.readJson("@data/quick-folders-playback.json").records, {});
  for (const path of [
    `${harness.statePath}.backup`,
    "@data/quick-folders-index.json.backup",
    "@data/quick-folders-playback.json.backup",
    "@data/quick-folders-browser-context.json.backup",
  ]) {
    assert.equal(JSON.stringify(harness.readJson(path)).includes("/media"), false);
  }
});

test("a stale runtime cannot restore paths removed by another runtime", async () => {
  const indexPath = "@data/quick-folders-index.json";
  const playbackPath = "@data/quick-folders-playback.json";
  const browserContextPath = "@data/quick-folders-browser-context.json";
  const configKey = JSON.stringify({
    roots: ["/media"],
    maxIndexDepth: 3,
    filterAudio: true,
    filterImages: true,
    videoOnly: false,
  });
  const storedFiles = new Map([
    ["@data/quick-folders-state.json", JSON.stringify({
      version: 5,
      libraryRevision: 0,
      folderRoots: [{ path: "/media", name: "media" }],
      queuePaths: [],
    })],
    [indexPath, JSON.stringify({
      version: 1,
      configKey,
      builtAt: 1,
      roots: {
        "/media": {
          path: "/media",
          status: "unavailable",
          lastAttemptAt: 1,
          lastSuccessfulAt: 1,
          files: [
            {
              name: "Alpha.mkv",
              path: "/media/Alpha.mkv",
              parentPath: "/media",
              rootPath: "/media",
              type: "video",
              ext: "mkv",
            },
            {
              name: "Beta.mp3",
              path: "/media/Beta.mp3",
              parentPath: "/media",
              rootPath: "/media",
              type: "audio",
              ext: "mp3",
            },
          ],
        },
      },
    })],
    [playbackPath, JSON.stringify({
      version: 1,
      records: {
        "/media/Alpha.mkv": { position: 10, duration: 100, lastPlayedAt: 1, manualState: null },
      },
    })],
  ]);
  const existingPaths = new Set(["/media", "/media/Alpha.mkv", "/media/Beta.mp3"]);
  let releaseScan;
  let reportScanStarted;
  const scanStarted = new Promise((resolve) => { reportScanStarted = resolve; });
  const scanBarrier = new Promise((resolve) => { releaseScan = resolve; });
  const staleRuntime = createIinaWindowHarness({
    autoRunZeroTimers: true,
    existingPaths,
    storedFiles,
    scanBarrier() {
      reportScanStarted();
      return scanBarrier;
    },
  });
  const deletingRuntime = createIinaWindowHarness({ existingPaths, storedFiles });

  staleRuntime.setPlaybackStatus({
    url: "/media/Alpha.mkv",
    position: 10,
    duration: 100,
    isNetworkResource: false,
  });
  await staleRuntime.emitEvent("iina.file-loaded", "/media/Alpha.mkv");
  await staleRuntime.messaging.send("save-browser-context", {
    path: "/media",
    focusedPath: "/media/Alpha.mkv",
    recents: [{ path: "/media" }],
  });

  const staleScan = staleRuntime.messaging.send("refresh-index");
  await scanStarted;
  await deletingRuntime.messaging.send("delete-items", { paths: ["/media/Alpha.mkv"] });
  assert.equal(existingPaths.has("/media/Alpha.mkv"), false);
  assert.equal(JSON.parse(storedFiles.get("@data/quick-folders-state.json")).libraryRevision, 1);
  assert.equal(JSON.stringify(JSON.parse(storedFiles.get(indexPath))).includes("Alpha.mkv"), false);

  releaseScan();
  await staleScan;
  assert.equal(
    JSON.stringify(JSON.parse(storedFiles.get(indexPath))).includes("Alpha.mkv"),
    false,
    "a scan built before the deletion must not overwrite the scrubbed index",
  );

  staleRuntime.setPlaybackStatus({
    url: "/media/Alpha.mkv",
    position: 42,
    duration: 100,
    isNetworkResource: false,
  });
  await staleRuntime.emitEvent("mpv.time-pos.changed");
  await staleRuntime.messaging.send("save-browser-context", {
    path: "/media",
    focusedPath: "/media/Alpha.mkv",
    scrollAnchor: "/media/Alpha.mkv",
  });
  await staleRuntime.messaging.send("set-watched", {
    paths: ["/media/Beta.mp3"],
    watched: true,
  });

  for (const path of [playbackPath, `${playbackPath}.backup`, browserContextPath, `${browserContextPath}.backup`]) {
    assert.equal(
      JSON.stringify(JSON.parse(storedFiles.get(path))).includes("Alpha.mkv"),
      false,
      `${path} must remain scrubbed after stale runtime writes`,
    );
  }
  assert.equal(
    JSON.parse(storedFiles.get(playbackPath)).records["/media/Beta.mp3"].manualState,
    "watched",
  );
});

test("cached unavailable roots remain navigable without authorizing native access", async () => {
  const configKey = JSON.stringify({
    roots: ["/media"],
    maxIndexDepth: 3,
    filterAudio: true,
    filterImages: true,
    videoOnly: false,
  });
  const storedFiles = new Map([
    ["@data/quick-folders-state.json", JSON.stringify({
      version: 5,
      libraryRevision: 0,
      folderRoots: [{ path: "/media", name: "media" }],
      queuePaths: [],
    })],
    ["@data/quick-folders-index.json", JSON.stringify({
      version: 1,
      configKey,
      builtAt: 1,
      roots: {
        "/media": {
          path: "/media",
          status: "unavailable",
          lastAttemptAt: 2,
          lastSuccessfulAt: 1,
          files: [{
            name: "Archived.mkv",
            path: "/media/Season/Archived.mkv",
            parentPath: "/media/Season",
            rootPath: "/media",
            type: "video",
            ext: "mkv",
          }],
        },
      },
    })],
    ["@data/quick-folders-playback.json", JSON.stringify({ version: 1, records: {} })],
  ]);
  const harness = createIinaWindowHarness({
    existingPaths: new Set(),
    statFailsForMissing: true,
    storedFiles,
  });
  const updates = [];
  harness.messaging.onMessage("update-items", (data) => updates.push(data));

  await harness.messaging.send("open-item", { path: "/media", isDir: true });
  assert.equal(updates.at(-1).currentPath, "/media");
  assert.deepEqual(Array.from(updates.at(-1).items, (item) => item.path), ["/media/Season"]);
  assert.deepEqual(harness.openedPaths, []);

  await harness.messaging.send("navigate-to", { path: "/media/Season" });
  assert.equal(updates.at(-1).currentPath, "/media/Season");
  assert.deepEqual(Array.from(updates.at(-1).items, (item) => item.path), [
    "/media/Season/Archived.mkv",
  ]);
  assert.deepEqual(harness.openedPaths, []);
  assert.equal(
    harness.executedTools.some(([tool]) => tool === "/usr/bin/stat"),
    false,
    "cached unavailable navigation must not wait for a native stat process",
  );
});
