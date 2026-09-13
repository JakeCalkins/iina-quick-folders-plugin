const test = require("node:test");
const assert = require("node:assert/strict");

test("main entry persists watched state and trashes only validated files", async () => {
  const statePath = "@data/quick-folders-state.json";
  const indexPath = "@data/quick-folders-index.json";
  const playbackPath = "@data/quick-folders-playback.json";
  const existing = new Set(["/media/a.mp4", "/media/b.mkv", "/media/failure.mov", "/media/stuck.mp4"]);
  let persistedState = JSON.stringify({
    folderRoots: [{ path: "/media", name: "media" }],
    fileIndex: {
      extensions: ["mp4", "mkv", "mov"],
      files: [
        { name: "a.mp4", path: "/media/a.mp4", type: "video", ext: "mp4" },
        { name: "b.mkv", path: "/media/b.mkv", type: "video", ext: "mkv" },
        { name: "failure.mov", path: "/media/failure.mov", type: "video", ext: "mov" },
      ],
    },
    watchedPaths: [],
    queuePaths: ["/media/b.mkv", "/outside/ignored.mov"],
    version: 2,
  });
  let persistedIndex = "";
  let persistedPlayback = JSON.stringify({
    version: 1,
    records: {
      "/media/b.mkv": { position: 30, duration: 100, lastPlayedAt: 10, manualState: null },
    },
  });
  const handlers = new Map();
  const eventHandlers = new Map();
  const globalHandlers = new Map();
  const globalMessages = [];
  const menuCallbacks = new Map();
  const messages = [];
  const trashedPaths = [];
  const openedPaths = [];
  const executedTools = [];
  const menuItems = new Map();
  const windowFrames = [];
  let nativePlaylist = [];
  let playedPlaylistIndex = null;
  let mediaListCalls = 0;
  const seekPositions = [];
  const scheduledCallbacks = [];
  const indexMarkers = new Map();
  const markerAdjustments = [];
  const findResults = [];
  const directoryListings = new Map([["/media", [
    { filename: "a.mp4", path: "/media/a.mp4", isDir: false },
    { filename: "b.mkv", path: "/media/b.mkv", isDir: false },
    { filename: "failure.mov", path: "/media/failure.mov", isDir: false },
    { filename: "stuck.mp4", path: "/media/stuck.mp4", isDir: false },
    { filename: "folder.mp4", path: "/media/folder.mp4", isDir: true },
    { filename: "~partial", path: "/media/~partial", isDir: true },
  ]]]);

  const fileApi = {
    exists(path) {
      if (path === statePath) return true;
      if (path === indexPath) return Boolean(persistedIndex);
      if (path === playbackPath) return Boolean(persistedPlayback);
      if (path.startsWith("@data/quick-folders-index-marker-")) return indexMarkers.has(path);
      if (path.startsWith("@data/")) return false;
      if (path === "/media") return true;
      return existing.has(path);
    },
    read(path) {
      if (path === statePath) return persistedState;
      if (path === indexPath) return persistedIndex;
      if (path === playbackPath) return persistedPlayback;
      if (path.startsWith("@data/quick-folders-index-marker-")) return indexMarkers.get(path) || "";
      return "";
    },
    write(path, content) {
      if (path === statePath) persistedState = content;
      if (path === indexPath) persistedIndex = content;
      if (path === playbackPath) persistedPlayback = content;
      if (path.startsWith("@data/quick-folders-index-marker-")) indexMarkers.set(path, content);
    },
    list(path, options) {
      if (path === "/media" && options === undefined) mediaListCalls++;
      return directoryListings.get(path) || [];
    },
    stat() {
      return { size: 1024 };
    },
    trash(path) {
      trashedPaths.push(path);
      if (path === "/media/failure.mov") throw new Error("Read only");
      if (path === "/media/stuck.mp4") return;
      existing.delete(path);
    },
  };

  global.iina = {
    console: { error() {}, log() {} },
    core: {
      status: { url: "/media/b.mkv", position: 0, duration: 100, isNetworkResource: false },
      open(path) {
        openedPaths.push(path);
        nativePlaylist = [path, "/media/b.mkv", "/media/failure.mov"]
          .filter((candidate, index, values) => existing.has(candidate) && values.indexOf(candidate) === index)
          .map((filename) => ({ filename }));
      },
      seekTo(position) { seekPositions.push(position); },
    },
    event: {
      on(type, callback) { eventHandlers.set(type, callback); },
    },
    playlist: {
      list() { return nativePlaylist.slice(); },
      add(url, at) {
        nativePlaylist.splice(at, 0, { filename: decodeURIComponent(url.slice("file://".length)) });
      },
      remove(index) { nativePlaylist.splice(index, 1); },
      play(index) { playedPlaylistIndex = index; },
    },
    global: {
      getLabel() { return null; },
      onMessage(type, callback) { globalHandlers.set(type, callback); },
      postMessage(...args) { globalMessages.push(args); },
    },
    file: fileApi,
    utils: {
      fileInPath(path) {
        return path === "/usr/bin/find"
          || path === "/usr/bin/touch"
          || path === "/usr/bin/mdls"
          || path === "/opt/homebrew/bin/ffprobe";
      },
      resolvePath(path) {
        if (path.startsWith("@tmp/quick-folders-queue-")) return `/tmp/${path.slice("@tmp/".length)}`;
        if (path.startsWith("@data/quick-folders-index-marker-")) return `/tmp/${path.slice("@data/".length)}`;
        return path;
      },
      async exec(path, args) {
        if (path === "/usr/bin/touch") {
          markerAdjustments.push(args);
          return { status: 0, stdout: "", stderr: "" };
        }
        if (path === "/usr/bin/find") {
          return findResults.shift() || { status: 0, stdout: "", stderr: "" };
        }
        executedTools.push(path);
        if (path === "/opt/homebrew/bin/ffprobe") {
          return {
            status: 0,
            stdout: JSON.stringify({
              streams: [
                { codec_type: "video", codec_name: "h264", width: 1920, height: 1080, bit_rate: "8000000" },
                { codec_type: "audio", codec_name: "aac", sample_rate: "48000", channels: 2 },
              ],
              format: { duration: "125", bit_rate: "8300000" },
            }),
            stderr: "",
          };
        }
        assert.equal(path, "/usr/bin/mdls");
        return {
          status: 0,
          // Matroska commonly lacks useful Spotlight fields; the optional probe
          // must fill these without making ffprobe a required dependency.
          stdout: "kMDItemDurationSeconds = (null)\nkMDItemPixelHeight = (null)\nkMDItemPixelWidth = (null)\n",
          stderr: "",
        };
      },
    },
    preferences: { get(key) { return key === "hideWatched" ? true : undefined; } },
    menu: {
      item(title, callback, options = {}) {
        menuCallbacks.set(title, callback);
        const item = { title, callback, ...options };
        menuItems.set(title, item);
        return item;
      },
      addItem() {},
      forceUpdate() {},
    },
    standaloneWindow: {
      setProperty() {},
      setFrame(...frame) { windowFrames.push(frame); },
      loadFile() {},
      open() {},
      close() {},
      postMessage(type, data) { messages.push({ type, data }); },
      onMessage(type, callback) { handlers.set(type, callback); },
    },
  };

  const realSetTimeout = global.setTimeout;
  const realSetInterval = global.setInterval;
  global.setTimeout = (callback, milliseconds) => {
    // Queue playback deliberately samples native playlist stability; resolve
    // only those short waits without triggering unrelated startup timers.
    if (milliseconds === 50) callback();
    if (milliseconds === 0 || milliseconds === 250) scheduledCallbacks.push(callback);
    return scheduledCallbacks.length;
  };
  global.setInterval = () => 0;
  try {
    delete require.cache[require.resolve("../main.js")];
    require("../main.js");
    eventHandlers.get("iina.file-loaded")();
    eventHandlers.get("iina.file-started")();
    assert.deepEqual(seekPositions, [30]);
    global.iina.core.status.position = 45;
    eventHandlers.get("mpv.pause.changed")();
    assert.equal(JSON.parse(persistedPlayback).records["/media/b.mkv"].position, 45);
    global.iina.core.status.position = null;
    eventHandlers.get("mpv.end-file")();
    assert.equal(
      JSON.parse(persistedPlayback).records["/media/b.mkv"].position,
      45,
      "an unavailable end-of-file position must not erase the last valid sample",
    );
    assert.equal(menuItems.get("Open Quick Folders Window").keyBinding, "Meta+K");
    assert.equal(menuItems.get("Add Folder").keyBinding, "n");
    menuCallbacks.get("Open Quick Folders Window")();

    const initialUpdate = messages.filter((message) => message.type === "update-items").at(-1).data;
    assert.equal(initialUpdate.atRoot, true);
    assert.deepEqual(initialUpdate.navigationColumns, []);
    assert.equal(initialUpdate.preferences.showBitrateChips, false);
    assert.equal(initialUpdate.items.some((item) => item.smartView === "watched"), true);
    assert.equal(Object.hasOwn(initialUpdate, "indexedFiles"), false);
    assert.equal(initialUpdate.items.every((item) => !item.isSmartView || item.itemCount === undefined), true);
    assert.deepEqual(initialUpdate.queueItems.map((item) => item.path), ["/media/b.mkv"]);

    handlers.get("request-state")({ indexRevision: -1 });
    assert.equal(Object.hasOwn(messages.filter((message) => message.type === "update-items").at(-1).data, "indexedFiles"), false);
    scheduledCallbacks.shift()();
    const forcedIndexUpdate = messages.filter((message) => message.type === "update-items").at(-1).data;
    assert.equal(Array.isArray(forcedIndexUpdate.indexedFiles), true);
    handlers.get("request-state")({ indexRevision: forcedIndexUpdate.indexRevision });
    const matchingIndexUpdate = messages.filter((message) => message.type === "update-items").at(-1).data;
    assert.equal(Object.hasOwn(matchingIndexUpdate, "indexedFiles"), false);

    handlers.get("queue-add")({
      paths: ["/media/a.mp4", "/media/b.mkv", "/outside/movie.mp4"],
    });
    const queueAddResult = messages.filter((message) => message.type === "queue-action-result").at(-1).data;
    assert.deepEqual(queueAddResult.succeeded, ["/media/a.mp4"]);
    assert.equal(queueAddResult.failed.length, 1);
    assert.deepEqual(JSON.parse(persistedState).queuePaths, ["/media/b.mkv", "/media/a.mp4"]);
    const queueUpdate = messages.filter((message) => message.type === "update-items").at(-1).data;
    assert.equal(
      Object.hasOwn(queueUpdate, "indexedFiles"),
      false,
      "queue-only updates should not resend the complete file index",
    );

    handlers.get("queue-reorder")({
      paths: ["/media/a.mp4"],
      targetPath: "/media/b.mkv",
      position: "before",
    });
    await handlers.get("queue-play")();
    assert.deepEqual(globalMessages.pop(), [
      "quick-folders-play-queue",
      { paths: ["/media/a.mp4", "/media/b.mkv"] },
    ]);
    globalHandlers.get("quick-folders-queue-result")({
      action: "played",
      succeeded: ["/media/a.mp4", "/media/b.mkv"],
      failed: [],
    });
    assert.deepEqual(
      messages.filter((message) => message.type === "queue-action-result").at(-1).data.succeeded,
      ["/media/a.mp4", "/media/b.mkv"],
    );

    handlers.get("queue-remove")({ paths: ["/media/b.mkv"] });
    assert.deepEqual(JSON.parse(persistedState).queuePaths, ["/media/a.mp4"]);
    handlers.get("queue-panel-open")({ open: true });
    handlers.get("queue-panel-open")({ open: false });
    handlers.get("queue-panel-open")({ open: true, resize: false });
    assert.deepEqual(windowFrames.slice(-2), [[840, 600, null, null], [500, 600, null, null]]);

    handlers.get("set-watched")({
      paths: ["/media/a.mp4", "/media/a.mp4", "/media/../secret.mp4", "/media/folder.mp4"],
      watched: true,
    });
    const watchResult = messages.filter((message) => message.type === "item-action-result").at(-1).data;
    assert.deepEqual(watchResult.succeeded, ["/media/a.mp4"]);
    assert.equal(watchResult.failed.length, 2);
    assert.equal(JSON.parse(persistedPlayback).records["/media/a.mp4"].manualState, "watched");
    const watchedUpdate = messages.filter((message) => message.type === "update-items").at(-1).data;
    assert.equal(Array.isArray(watchedUpdate.indexedFiles), true);

    handlers.get("open-item")({ path: "@watched", isDir: true, isWatchedRoot: true });
    const watchedView = messages.filter((message) => message.type === "update-items").at(-1).data;
    assert.equal(watchedView.viewingWatched, true);
    assert.deepEqual(watchedView.items.map((item) => item.path), ["/media/a.mp4"]);
    assert.equal(watchedView.items[0].fromSmartView, true);

    handlers.get("go-back")();
    const returnedRoot = messages.filter((message) => message.type === "update-items").at(-1).data;
    assert.equal(returnedRoot.atRoot, true);

    handlers.get("set-watched")({ paths: ["/media/b.mkv"], watched: true });
    global.iina.core.status.url = "/media/b.mkv";
    global.iina.core.status.position = 0;
    eventHandlers.get("iina.file-loaded")();
    eventHandlers.get("iina.file-started")();
    assert.equal(seekPositions.at(-1), 45, "manual watched state must not disable partial resume");

    handlers.get("open-item")({ path: "/media", isDir: true });
    const openedRoot = messages.filter((message) => message.type === "update-items").at(-1).data;
    assert.equal(openedRoot.currentPath, "/media");
    assert.equal(openedRoot.currentRootPath, "/media");
    assert.equal(openedRoot.navigationColumns.length, 1);
    assert.equal(openedRoot.navigationColumns[0].selectedPath, "/media");
    handlers.get("go-back")();

    const listCallsBeforeRefresh = mediaListCalls;
    global.setTimeout = realSetTimeout;
    await Promise.all([
      handlers.get("refresh-index")(),
      handlers.get("refresh-index")(),
    ]);
    global.setTimeout = (callback, milliseconds) => {
      if (milliseconds === 50) callback();
      return 0;
    };
    assert.equal(mediaListCalls - listCallsBeforeRefresh, 1, "concurrent refreshes should share one index scan");
    const refreshedState = messages.filter((message) => message.type === "update-items").at(-1).data;
    assert.deepEqual(refreshedState.availableExtensions, ["mkv", "mov", "mp4"]);

    const listCallsBeforeNoChange = mediaListCalls;
    await handlers.get("refresh-index")();
    assert.equal(
      mediaListCalls,
      listCallsBeforeNoChange,
      "an unchanged root should reconcile from the native change marker without relisting directories",
    );

    const markerAfterNoChange = JSON.parse(persistedIndex).roots["/media"].markerSlot;
    existing.add("/media/Moved/new.mp4");
    directoryListings.get("/media").push({ filename: "Moved", path: "/Moved", isDir: true });
    directoryListings.set("/media/Moved", [
      { filename: "new.mp4", path: "/new.mp4", isDir: false },
    ]);
    findResults.push(
      { status: 0, stdout: "/media\0", stderr: "" },
      { status: 0, stdout: "", stderr: "" },
    );
    await handlers.get("refresh-index")();
    const renamedTreeIndex = JSON.parse(persistedIndex).roots["/media"];
    assert.equal(renamedTreeIndex.files.some((item) => item.path === "/media/Moved/new.mp4"), true);
    assert.notEqual(renamedTreeIndex.markerSlot, markerAfterNoChange);
    assert.equal(markerAdjustments.every((args) => args[1] === "-000010"), true);

    const listCallsBeforeFindFailure = mediaListCalls;
    findResults.push(
      { status: 1, stdout: "", stderr: "failed" },
      { status: 1, stdout: "", stderr: "failed" },
    );
    global.setTimeout = realSetTimeout;
    await handlers.get("refresh-index")();
    global.setTimeout = (callback, milliseconds) => {
      if (milliseconds === 50) callback();
      return 0;
    };
    assert.equal(mediaListCalls, listCallsBeforeFindFailure + 1, "find failure must fall back to a full scan");

    handlers.get("open-item")({ path: "/outside/movie.mp4", isDir: false });
    handlers.get("open-item")({ path: "/media/b.mkv", isDir: false });
    assert.deepEqual(openedPaths, ["/media/b.mkv"]);

    handlers.get("request-thumbnail")({ path: "/media/b.mkv" });
    const immediateThumbnail = messages.filter((message) => message.type === "thumbnail-ready").at(-1);
    assert.equal(immediateThumbnail.data.path, "/media/b.mkv");
    assert.match(immediateThumbnail.data.dataUrl, /^data:image\/svg\+xml;base64,/);

    handlers.get("request-media-metadata")({ path: "/media/b.mkv" });
    await new Promise((resolve) => realSetTimeout(resolve, 0));
    const metadataResult = messages.filter((message) => message.type === "media-metadata-ready").at(-1);
    assert.deepEqual(metadataResult, {
      type: "media-metadata-ready",
      data: {
        path: "/media/b.mkv",
        metadata: {
          duration: 125,
          height: 1080,
          width: 1920,
          videoBitRate: 8000000,
          audioSampleRate: 48000,
          audioChannels: 2,
          codecs: ["H.264", "AAC"],
        },
      },
    });
    assert.deepEqual(executedTools, ["/usr/bin/mdls", "/opt/homebrew/bin/ffprobe"]);

    findResults.push(
      { status: 0, stdout: "", stderr: "" },
      { status: 0, stdout: "/media/b.mkv\0", stderr: "" },
    );
    await handlers.get("refresh-index")();
    const modifiedRecord = JSON.parse(persistedIndex).roots["/media"].files
      .find((item) => item.path === "/media/b.mkv");
    assert.equal(modifiedRecord.duration, undefined, "a modified file must discard stale derived metadata");
    handlers.get("request-media-metadata")({ path: "/media/b.mkv" });
    await new Promise((resolve) => realSetTimeout(resolve, 0));
    assert.deepEqual(executedTools, [
      "/usr/bin/mdls",
      "/opt/homebrew/bin/ffprobe",
      "/usr/bin/mdls",
      "/opt/homebrew/bin/ffprobe",
    ]);

    handlers.get("delete-items")({
      paths: ["/media/a.mp4", "/outside/b.mkv", "/media/failure.mov", "/media/stuck.mp4"],
    });
    const deleteResult = messages.filter((message) => message.type === "item-action-result").at(-1).data;
    assert.equal(deleteResult.action, "trashed");
    assert.deepEqual(deleteResult.succeeded, ["/media/a.mp4"]);
    assert.deepEqual(trashedPaths, ["/media/a.mp4", "/media/failure.mov", "/media/stuck.mp4"]);
    assert.equal(deleteResult.failed.length, 3);
    assert.match(deleteResult.failed.at(-1).reason, /still exists/);
    assert.equal(existing.has("/media/a.mp4"), false);
    assert.equal(existing.has("/media/failure.mov"), true);

    const finalState = JSON.parse(persistedState);
    assert.equal(JSON.parse(persistedPlayback).records["/media/a.mp4"], undefined);
    assert.deepEqual(finalState.queuePaths, []);
    assert.deepEqual(JSON.parse(persistedIndex).roots["/media"].files.map((item) => item.path), [
      "/media/b.mkv",
      "/media/failure.mov",
      "/media/Moved/new.mp4",
      "/media/stuck.mp4",
    ]);
  } finally {
    global.setTimeout = realSetTimeout;
    global.setInterval = realSetInterval;
    delete global.iina;
  }
});
