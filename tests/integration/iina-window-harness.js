const { readFileSync } = require("node:fs");
const { dirname, resolve } = require("node:path");
const vm = require("node:vm");

const repositoryRoot = resolve(__dirname, "../..");
const statePath = "@data/quick-folders-state.json";

function createIinaModuleLoader() {
  function load(modulePath) {
    const absolutePath = resolve(repositoryRoot, modulePath);
    const source = readFileSync(absolutePath, "utf8");
    const localRequire = (request) => load(resolve(dirname(absolutePath), request));
    return vm.runInNewContext(
      `(function (require) { const module = {}; ${source}\nreturn module.exports; })(require)`,
      { clearInterval, clearTimeout, require: localRequire, setInterval, setTimeout },
      { filename: absolutePath },
    );
  }
  return load;
}

function createIinaWindowHarness(options = {}) {
  const existingPaths = options.existingPaths
    || new Set(["/media", "/media/Alpha.mkv", "/media/Beta.mp3"]);
  const storedFiles = options.storedFiles || new Map();
  if (!storedFiles.has(statePath)) {
    storedFiles.set(statePath, JSON.stringify({
      version: 2,
      folderRoots: [{ path: "/media", name: "media" }],
      fileIndex: {
        extensions: ["mkv", "mp3"],
        files: [
          { name: "Alpha.mkv", path: "/media/Alpha.mkv", type: "video", ext: "mkv" },
          { name: "Beta.mp3", path: "/media/Beta.mp3", type: "audio", ext: "mp3" },
        ],
      },
      queuePaths: [],
      watchedPaths: [],
    }));
  }
  const backendHandlers = new Map();
  const backendHandlerCounts = new Map();
  const frontendHandlers = new Map();
  const globalHandlers = new Map();
  const eventHandlers = new Map();
  const menuCallbacks = new Map();
  const openedPaths = [];
  const executedTools = [];
  const scheduledCallbacks = [];

  const file = {
    exists(path) {
      if (path.startsWith("@data/")) return storedFiles.has(path);
      return existingPaths.has(path);
    },
    read(path) { return storedFiles.get(path) || ""; },
    write(path, content) { storedFiles.set(path, content); },
    list(path, listOptions) {
      if (path !== "/media") return [];
      const listing = [
        { filename: "Alpha.mkv", path: "/media/Alpha.mkv", isDir: false },
        { filename: "Beta.mp3", path: "/media/Beta.mp3", isDir: false },
      ].filter((entry) => existingPaths.has(entry.path));
      if (listOptions === undefined && typeof options.scanBarrier === "function") {
        return Promise.resolve(options.scanBarrier()).then(() => listing);
      }
      return listing;
    },
    stat() { return { size: 1_024 }; },
    trash(path) { existingPaths.delete(path); },
  };
  const iina = {
    console: { error() {}, log() {} },
    core: {
      status: {},
      open(path) { openedPaths.push(path); },
      seekTo() {},
    },
    event: { on(type, callback) { eventHandlers.set(type, callback); } },
    file,
    global: {
      getLabel() { return null; },
      onMessage(type, callback) { globalHandlers.set(type, callback); },
      postMessage(type, data) {
        if (type !== "quick-folders-state-lock-request") return;
        const granted = globalHandlers.get("quick-folders-state-lock-granted");
        if (granted) granted({ requestId: data.requestId });
      },
    },
    menu: {
      item(title, callback, options = {}) {
        menuCallbacks.set(title, callback);
        return { title, callback, ...options };
      },
      addItem() {},
      forceUpdate() {},
    },
    playlist: { add() {}, list() { return []; }, move() {}, play() {}, remove() {} },
    preferences: { get() { return undefined; }, set() {}, sync() {} },
    standaloneWindow: {
      close() {},
      loadFile() {},
      open() {},
      onMessage(type, callback) {
        backendHandlers.set(type, callback);
        backendHandlerCounts.set(type, (backendHandlerCounts.get(type) || 0) + 1);
      },
      postMessage(type, data) {
        (frontendHandlers.get(type) || []).forEach((callback) => callback(data));
      },
      setFrame() {},
      setProperty() {},
    },
    utils: {
      async exec(tool, args) {
        executedTools.push([tool, args]);
        if (tool === "/usr/bin/stat") {
          if (options.statFailsForMissing && !existingPaths.has(args.at(-1))) {
            return { status: 1, stdout: "", stderr: "unavailable" };
          }
          return { status: 0, stdout: `${args.slice(2).map(() => "40755").join("\n")}\n`, stderr: "" };
        }
        return { status: 1, stdout: "", stderr: "unavailable" };
      },
      fileInPath() { return false; },
      resolvePath(path) { return path; },
    },
  };

  const load = createIinaModuleLoader();
  const mainSource = readFileSync(resolve(repositoryRoot, "main.js"), "utf8");
  vm.runInNewContext(mainSource, {
    clearTimeout() {},
    iina,
    require: (request) => load(request),
    setInterval() { return 1; },
    setTimeout(callback, milliseconds) {
      if (milliseconds === 0 && options.autoRunZeroTimers) {
        Promise.resolve().then(callback);
        return 1;
      }
      if (milliseconds === 0) scheduledCallbacks.push(callback);
      return scheduledCallbacks.length;
    },
  }, { filename: resolve(repositoryRoot, "main.js") });
  menuCallbacks.get("Open Quick Folders Window")();

  const messagingModule = { exports: {} };
  const messagingSource = readFileSync(resolve(repositoryRoot, "ui/messaging.js"), "utf8");
  vm.runInNewContext(messagingSource, {
    iina: {
      onMessage(type, callback) {
        if (!frontendHandlers.has(type)) frontendHandlers.set(type, []);
        frontendHandlers.get(type).push(callback);
      },
      postMessage(type, data) {
        const handler = backendHandlers.get(type);
        if (handler) return handler(data);
      },
    },
    module: messagingModule,
  }, { filename: resolve(repositoryRoot, "ui/messaging.js") });

  return {
    backendHandlerCounts,
    emitEvent(type, data) {
      const handler = eventHandlers.get(type);
      return handler ? handler(data) : undefined;
    },
    executedTools,
    existingPaths,
    messaging: messagingModule.exports,
    openWindow: menuCallbacks.get("Open Quick Folders Window"),
    openedPaths,
    readJson(path) { return JSON.parse(storedFiles.get(path)); },
    runDeferredCallbacks() {
      while (scheduledCallbacks.length > 0) scheduledCallbacks.shift()();
    },
    setPlaybackStatus(status) { iina.core.status = status; },
    statePath,
    storedFiles,
  };
}

module.exports = { createIinaWindowHarness };
