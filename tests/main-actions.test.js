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
    version: 2,
  });
  const handlers = new Map();
  const menuCallbacks = new Map();
  const messages = [];
  const deletedPaths = [];

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
    list(path) {
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
    core: { open() {} },
    file: fileApi,
    utils: {
      fileInPath(path) { return path === "/usr/bin/mdls"; },
      async exec(path) {
        assert.equal(path, "/usr/bin/mdls");
        return {
          status: 0,
          stdout: "kMDItemDurationSeconds = 125\nkMDItemPixelHeight = 1080\nkMDItemPixelWidth = 1920\n",
          stderr: "",
        };
      },
    },
    preferences: { get(key) { return key === "hideWatched" ? true : undefined; } },
    menu: {
      item(title, callback) {
        menuCallbacks.set(title, callback);
        return { title, callback };
      },
      addItem() {},
    },
    standaloneWindow: {
      setProperty() {},
      setFrame() {},
      loadFile() {},
      open() {},
      postMessage(type, data) { messages.push({ type, data }); },
      onMessage(type, callback) { handlers.set(type, callback); },
    },
  };

  const realSetTimeout = global.setTimeout;
  global.setTimeout = () => 0;
  try {
    delete require.cache[require.resolve("../quick-folders.iinaplugin/main.js")];
    require("../quick-folders.iinaplugin/main.js");
    menuCallbacks.get("Open Quick Folders Window")();

    const initialUpdate = messages.filter((message) => message.type === "update-items").at(-1).data;
    assert.equal(initialUpdate.atRoot, true);
    assert.equal(initialUpdate.items.at(-1).isWatchedRoot, true);

    handlers.get("set-watched")({
      paths: ["/media/a.mp4", "/media/a.mp4", "/media/../secret.mp4", "/media/folder.mp4"],
      watched: true,
    });
    const watchResult = messages.filter((message) => message.type === "item-action-result").at(-1).data;
    assert.deepEqual(watchResult.succeeded, ["/media/a.mp4"]);
    assert.equal(watchResult.failed.length, 2);
    assert.deepEqual(JSON.parse(persistedState).watchedPaths, ["/media/a.mp4"]);

    handlers.get("open-item")({ path: "@watched", isDir: true, isWatchedRoot: true });
    const watchedView = messages.filter((message) => message.type === "update-items").at(-1).data;
    assert.equal(watchedView.viewingWatched, true);
    assert.deepEqual(watchedView.items.map((item) => item.path), ["/media/a.mp4"]);
    assert.equal(watchedView.items[0].fromWatchedView, true);

    handlers.get("go-back")();
    const returnedRoot = messages.filter((message) => message.type === "update-items").at(-1).data;
    assert.equal(returnedRoot.atRoot, true);

    handlers.get("request-media-metadata")({ path: "/media/b.mkv" });
    await new Promise((resolve) => realSetTimeout(resolve, 0));
    const metadataResult = messages.filter((message) => message.type === "media-metadata-ready").at(-1);
    assert.deepEqual(metadataResult, {
      type: "media-metadata-ready",
      data: { path: "/media/b.mkv", metadata: { duration: 125, height: 1080, width: 1920 } },
    });

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
    assert.deepEqual(finalState.fileIndex.files.map((item) => item.path), [
      "/media/b.mkv",
      "/media/failure.mov",
    ]);
  } finally {
    global.setTimeout = realSetTimeout;
    delete global.iina;
  }
});
