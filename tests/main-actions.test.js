const test = require("node:test");
const assert = require("node:assert/strict");

test("main entry persists watched state and permanently deletes only validated files", async () => {
  const statePath = "@data/quick-folders-state.json";
  const existing = new Set(["/media/a.mp4", "/media/b.mkv", "/media/failure.mov"]);
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
  const handlers = new Map();
  const globalHandlers = new Map();
  const globalMessages = [];
  const menuCallbacks = new Map();
  const messages = [];
  const deletedPaths = [];
  const openedPaths = [];
  const executedTools = [];
  const menuItems = new Map();
  const windowFrames = [];
  let nativePlaylist = [];
  let playedPlaylistIndex = null;
  let mediaListCalls = 0;

  const fileApi = {
    exists(path) {
      if (path === statePath) return true;
      if (path.startsWith("@data/")) return false;
      return existing.has(path);
    },
    read(path) {
      return path === statePath ? persistedState : "";
    },
    write(path, content) {
      if (path === statePath) persistedState = content;
    },
    list(path, options) {
      if (path === "/media" && options === undefined) mediaListCalls++;
      if (path !== "/media") return [];
      return [
        { filename: "a.mp4", path: "/media/a.mp4", isDir: false },
        { filename: "b.mkv", path: "/media/b.mkv", isDir: false },
        { filename: "failure.mov", path: "/media/failure.mov", isDir: false },
        { filename: "folder.mp4", path: "/media/folder.mp4", isDir: true },
      ];
    },
    stat() {
      return { size: 1024 };
    },
    delete(path) {
      deletedPaths.push(path);
      if (path === "/media/failure.mov") throw new Error("Read only");
      existing.delete(path);
    },
  };

  global.iina = {
    console: { error() {}, log() {} },
    core: {
      open(path) {
        openedPaths.push(path);
        nativePlaylist = [path, "/media/b.mkv", "/media/failure.mov"]
          .filter((candidate, index, values) => existing.has(candidate) && values.indexOf(candidate) === index)
          .map((filename) => ({ filename }));
      },
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
        return path === "/usr/bin/mdls" || path === "/opt/homebrew/bin/ffprobe";
      },
      resolvePath(path) {
        return path.startsWith("@tmp/quick-folders-queue-") ? `/tmp/${path.slice("@tmp/".length)}` : path;
      },
      async exec(path) {
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
    return 0;
  };
  global.setInterval = () => 0;
  try {
    delete require.cache[require.resolve("../main.js")];
    require("../main.js");
    assert.equal(menuItems.get("Open Quick Folders Window").keyBinding, "Meta+K");
    assert.equal(menuItems.get("Add Folder").keyBinding, "n");
    menuCallbacks.get("Open Quick Folders Window")();

    const initialUpdate = messages.filter((message) => message.type === "update-items").at(-1).data;
    assert.equal(initialUpdate.atRoot, true);
    assert.equal(initialUpdate.preferences.showBitrateChips, false);
    assert.equal(initialUpdate.items.at(-1).isWatchedRoot, true);
    assert.equal(Array.isArray(initialUpdate.indexedFiles), true);
    assert.deepEqual(initialUpdate.queueItems.map((item) => item.path), ["/media/b.mkv"]);

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
    assert.deepEqual(windowFrames.slice(-2), [[840, 600, null, null], [500, 600, null, null]]);

    handlers.get("set-watched")({
      paths: ["/media/a.mp4", "/media/a.mp4", "/media/../secret.mp4", "/media/folder.mp4"],
      watched: true,
    });
    const watchResult = messages.filter((message) => message.type === "item-action-result").at(-1).data;
    assert.deepEqual(watchResult.succeeded, ["/media/a.mp4"]);
    assert.equal(watchResult.failed.length, 2);
    assert.deepEqual(JSON.parse(persistedState).watchedPaths, ["/media/a.mp4"]);
    const watchedUpdate = messages.filter((message) => message.type === "update-items").at(-1).data;
    assert.equal(Array.isArray(watchedUpdate.indexedFiles), true);

    handlers.get("open-item")({ path: "@watched", isDir: true, isWatchedRoot: true });
    const watchedView = messages.filter((message) => message.type === "update-items").at(-1).data;
    assert.equal(watchedView.viewingWatched, true);
    assert.deepEqual(watchedView.items.map((item) => item.path), ["/media/a.mp4"]);
    assert.equal(watchedView.items[0].fromWatchedView, true);

    handlers.get("go-back")();
    const returnedRoot = messages.filter((message) => message.type === "update-items").at(-1).data;
    assert.equal(returnedRoot.atRoot, true);

    handlers.get("open-item")({ path: "/media", isDir: true });
    const openedRoot = messages.filter((message) => message.type === "update-items").at(-1).data;
    assert.equal(openedRoot.currentPath, "/media");
    assert.equal(openedRoot.currentRootPath, "/media");
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

    handlers.get("delete-items")({
      paths: ["/media/a.mp4", "/outside/b.mkv", "/media/failure.mov"],
    });
    const deleteResult = messages.filter((message) => message.type === "item-action-result").at(-1).data;
    assert.deepEqual(deleteResult.succeeded, ["/media/a.mp4"]);
    assert.deepEqual(deletedPaths, ["/media/a.mp4", "/media/failure.mov"]);
    assert.equal(deleteResult.failed.length, 2);
    assert.equal(existing.has("/media/a.mp4"), false);
    assert.equal(existing.has("/media/failure.mov"), true);

    const finalState = JSON.parse(persistedState);
    assert.deepEqual(finalState.watchedPaths, []);
    assert.deepEqual(finalState.queuePaths, []);
    assert.deepEqual(finalState.fileIndex.files.map((item) => item.path), [
      "/media/b.mkv",
      "/media/failure.mov",
    ]);
  } finally {
    global.setTimeout = realSetTimeout;
    global.setInterval = realSetInterval;
    delete global.iina;
  }
});
