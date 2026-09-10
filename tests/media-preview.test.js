const test = require("node:test");
const assert = require("node:assert/strict");

class FakeElement {
  constructor(tagName) {
    this.tagName = tagName.toUpperCase();
    this.children = [];
    this.dataset = {};
    this._classes = new Set();
    this.classList = {
      add: (...names) => names.forEach((name) => this._classes.add(name)),
      remove: (...names) => names.forEach((name) => this._classes.delete(name)),
      contains: (name) => this._classes.has(name),
    };
    this.listeners = new Map();
  }

  set className(value) {
    this._classes = new Set(String(value).split(/\s+/).filter(Boolean));
  }

  get className() {
    return Array.from(this._classes).join(" ");
  }

  appendChild(child) {
    this.children.push(child);
    return child;
  }

  addEventListener(type, callback) {
    this.listeners.set(type, callback);
  }

  set src(value) {
    this._src = value;
    const onLoad = this.listeners.get("load");
    if (onLoad) onLoad();
  }

  get src() {
    return this._src;
  }

  remove() {
    this.removed = true;
  }

  insertBefore(child, reference) {
    const index = this.children.indexOf(reference);
    if (index === -1) return this.appendChild(child);
    this.children.splice(index, 0, child);
    return child;
  }

  querySelector(selector) {
    const classes = selector.split(",").map((value) => value.trim().replace(/^\./, ""));
    return this.children.find((child) => classes.some((name) => child.classList.contains(name))) || null;
  }

  querySelectorAll(selector) {
    const className = selector.replace(/^\./, "");
    const matches = this.children.filter((child) => child.classList.contains(className));
    matches.forEach((child) => {
      child.remove = () => {
        this.children = this.children.filter((candidate) => candidate !== child);
      };
    });
    return matches;
  }

  getBoundingClientRect() {
    return this.bounds || { top: 0, bottom: 0, width: 0, height: 0 };
  }
}

function installBrowserGlobals() {
  global.document = { createElement: (tagName) => new FakeElement(tagName) };
  global.QuickFoldersView = {
    getExtensionClass: () => "video-mkv",
    getFileIcon: () => "video",
  };
  global.QuickFoldersFileTypes = require("../file-types.js");
  global.QuickFoldersMediaMetadata = require("../media-metadata.js");
}

function removeBrowserGlobals() {
  delete global.document;
  delete global.QuickFoldersView;
  delete global.QuickFoldersFileTypes;
  delete global.QuickFoldersMediaMetadata;
}

test("lazy preview requests render a thumbnail and type-specific metadata chips", () => {
  installBrowserGlobals();
  try {
    delete require.cache[require.resolve("../ui/media-preview.js")];
    const MediaPreview = require("../ui/media-preview.js");
    const messages = [];
    const preview = MediaPreview.create({
      rootElement: new FakeElement("main"),
      sendMessage(type, data) { messages.push({ type, data }); },
    });
    const thumbnail = new FakeElement("div");
    const info = new FakeElement("div");
    const size = new FakeElement("span");
    size.className = "metadata-chip size-chip";
    size.textContent = "12 MB";
    info.appendChild(size);

    preview.loadThumbnail(thumbnail, "/media/example.mkv", false);
    preview.attachMetadata(info, "/media/example.mkv");

    assert.deepEqual(messages, [
      { type: "request-media-metadata", data: { path: "/media/example.mkv" } },
      { type: "request-thumbnail", data: { path: "/media/example.mkv" } },
    ]);

    preview.handleThumbnailReady({
      path: "/media/example.mkv",
      dataUrl: "data:image/png;base64,iVBORw==",
    });
    preview.handleMetadataReady({
      path: "/media/example.mkv",
      metadata: {
        duration: 125,
        width: 1920,
        height: 1080,
        codecs: ["H.264", "AAC"],
        videoBitRate: 8450000,
      },
    });

    assert.equal(thumbnail.classList.contains("has-thumbnail"), true);
    assert.equal(thumbnail.children[0].src, "data:image/png;base64,iVBORw==");
    const firstThumbnail = thumbnail.children[0];
    preview.handleThumbnailReady({
      path: "/media/example.mkv",
      dataUrl: "data:image/png;base64,cmVhbA==",
    });
    assert.equal(firstThumbnail.removed, true, "a generated preview should replace the immediate fallback");
    assert.equal(thumbnail.children.at(-1).src, "data:image/png;base64,cmVhbA==");
    assert.deepEqual(info.children.map((child) => child.textContent), [
      "2:05",
      "1920×1080",
      "H.264 · AAC",
      "8.4 Mbps",
      "12 MB",
    ]);
    assert.equal(info.children.every((child) => child.classList.contains("metadata-chip")), true);
  } finally {
    removeBrowserGlobals();
  }
});

test("visibility sampling resumes lazy requests when WebKit does not wake its observer", () => {
  installBrowserGlobals();
  const observed = new Set();
  global.IntersectionObserver = class {
    constructor() {}
    observe(element) { observed.add(element); }
    unobserve(element) { observed.delete(element); }
    disconnect() { observed.clear(); }
  };
  try {
    delete require.cache[require.resolve("../ui/media-preview.js")];
    const MediaPreview = require("../ui/media-preview.js");
    const messages = [];
    const root = new FakeElement("main");
    root.bounds = { top: 0, bottom: 600, width: 500, height: 600 };
    const visible = new FakeElement("div");
    visible.bounds = { top: 80, bottom: 124, width: 44, height: 44 };
    const offscreen = new FakeElement("div");
    offscreen.bounds = { top: 900, bottom: 944, width: 44, height: 44 };
    const preview = MediaPreview.create({
      rootElement: root,
      sendMessage(type, data) { messages.push({ type, data }); },
    });

    preview.loadThumbnail(visible, "/media/visible.mkv", false);
    preview.loadThumbnail(offscreen, "/media/offscreen.mkv", false);
    assert.equal(messages.length, 0);
    assert.equal(observed.size, 2);

    preview.requestVisible();

    assert.deepEqual(messages, [
      { type: "request-media-metadata", data: { path: "/media/visible.mkv" } },
      { type: "request-thumbnail", data: { path: "/media/visible.mkv" } },
    ]);
    assert.equal(observed.has(visible), false);
    assert.equal(observed.has(offscreen), true);

    preview.beginRender();
    preview.loadThumbnail(visible, "/media/visible.mkv", false);
    preview.requestVisible();
    assert.deepEqual(messages.slice(2), [
      { type: "request-media-metadata", data: { path: "/media/visible.mkv" } },
      { type: "request-thumbnail", data: { path: "/media/visible.mkv" } },
    ]);
  } finally {
    delete global.IntersectionObserver;
    removeBrowserGlobals();
  }
});
