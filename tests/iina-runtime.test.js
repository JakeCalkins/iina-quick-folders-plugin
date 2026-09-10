const assert = require("node:assert/strict");
const { readFileSync } = require("node:fs");
const { dirname, resolve } = require("node:path");
const test = require("node:test");
const vm = require("node:vm");

const repositoryRoot = resolve(__dirname, "..");

// IINA initializes CommonJS modules with `const module = {}` rather than
// Node's pre-populated `module.exports`. This loader mirrors that distinction.
function createIinaModuleLoader() {
  function load(modulePath) {
    const absolutePath = resolve(repositoryRoot, modulePath);
    const source = readFileSync(absolutePath, "utf8");
    const localRequire = (request) => load(resolve(dirname(absolutePath), request));
    return vm.runInNewContext(
      `(function (require) { const module = {}; ${source}\nreturn module.exports; })(require)`,
      { require: localRequire },
      { filename: absolutePath },
    );
  }

  return load;
}

test("shared modules export through IINA's empty CommonJS wrapper", () => {
  const load = createIinaModuleLoader();
  const fileTypes = load("file-types.js");
  const browseState = load("browse-state.js");
  const metadata = load("media-metadata.js");
  const thumbnailService = load("thumbnail-service.js");
  const mediaPreview = load("ui/media-preview.js");

  assert.equal(fileTypes.getFileTypeByExt("mp4"), "video");
  assert.equal(browseState.isPathWithinRoots("/media/movie.mp4", [{ path: "/media" }]), true);
  assert.equal(metadata.formatDuration(65), "1:05");
  assert.equal(typeof thumbnailService.createThumbnailService, "function");
  assert.equal(typeof mediaPreview.create, "function");
});

test("main entry registers normalized shortcuts and refreshes preference changes", () => {
  const preferenceValues = {
    openWindowShortcut: "cmd+shift+a",
    addFolderShortcut: "n",
  };
  const menuItems = new Map();
  const intervalCallbacks = [];
  let menuUpdates = 0;
  let preferenceSyncs = 0;

  const iina = {
    console: { error() {}, log() {} },
    core: {},
    file: {},
    utils: {},
    preferences: {
      get(key) { return preferenceValues[key]; },
      set(key, value) { preferenceValues[key] = value; },
      sync() { preferenceSyncs++; },
    },
    menu: {
      item(title, action, options = {}) {
        const item = { title, action, ...options };
        menuItems.set(title, item);
        return item;
      },
      addItem() {},
      forceUpdate() { menuUpdates++; },
    },
    standaloneWindow: {},
  };

  const load = createIinaModuleLoader();
  const source = readFileSync(resolve(repositoryRoot, "main.js"), "utf8");
  vm.runInNewContext(source, {
    iina,
    require: (request) => load(request),
    setInterval(callback) { intervalCallbacks.push(callback); },
    setTimeout() {},
  }, { filename: resolve(repositoryRoot, "main.js") });

  assert.equal(menuItems.get("Open Quick Folders Window").keyBinding, "Meta+K");
  assert.equal(menuItems.get("Add Folder").keyBinding, "n");
  assert.equal(preferenceValues.openWindowShortcut, "cmd+shift+k");
  assert.equal(preferenceSyncs, 1);
  assert.equal(intervalCallbacks.length, 1);

  preferenceValues.openWindowShortcut = "command+option+k";
  intervalCallbacks[0]();
  assert.equal(menuItems.get("Open Quick Folders Window").keyBinding, "Alt+Meta+k");
  assert.equal(menuUpdates, 1);
});
