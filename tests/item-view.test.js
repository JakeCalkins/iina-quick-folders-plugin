const test = require("node:test");
const assert = require("node:assert/strict");
const ItemView = require("../ui/item-view.js");

class FakeElement {
  constructor(tagName) {
    this.tagName = tagName.toUpperCase();
    this.children = [];
    this.dataset = {};
    this.listeners = new Map();
    this.attributes = new Map();
    this.style = {};
    this._classes = new Set();
    this.classList = {
      add: (...names) => names.forEach((name) => this._classes.add(name)),
      remove: (...names) => names.forEach((name) => this._classes.delete(name)),
      contains: (name) => this._classes.has(name),
      toggle: (name, enabled) => enabled ? this._classes.add(name) : this._classes.delete(name),
    };
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

  setAttribute(name, value) {
    this.attributes.set(name, String(value));
  }

  getAttribute(name) {
    return this.attributes.get(name);
  }

  addEventListener(type, listener) {
    const listeners = this.listeners.get(type) || [];
    listeners.push(listener);
    this.listeners.set(type, listeners);
  }

  dispatch(type, properties = {}) {
    const event = {
      detail: 1,
      key: "",
      metaKey: false,
      ctrlKey: false,
      altKey: false,
      shiftKey: false,
      target: this,
      currentTarget: this,
      defaultPrevented: false,
      propagationStopped: false,
      preventDefault() { this.defaultPrevented = true; },
      stopPropagation() { this.propagationStopped = true; },
      ...properties,
    };
    (this.listeners.get(type) || []).forEach((listener) => listener(event));
    return event;
  }
}

function installFakeDom() {
  global.document = { createElement: (tagName) => new FakeElement(tagName) };
  global.QuickFoldersView = {
    formatFileSize: () => "",
    getContainingFolder: () => "media",
    getDisplayName: (item) => item.name.replace(/\.[^.]+$/, ""),
    getExtensionClass: () => "video-mkv",
    stripUserHome: (path) => path,
  };
  global.QuickFoldersFileTypes = {
    getExtension: (name) => name.split(".").pop().toLowerCase(),
  };
}

function createFileRow({ selected = false, isIndexing = false, item = null, layout = "list" } = {}) {
  const calls = { dragEnd: [], dragStart: [], focus: [], folders: [], move: [], open: [], select: [] };
  const rowItem = item || { name: "Example.mkv", path: "/media/Example.mkv", isDir: false };
  const row = ItemView.create(rowItem, {
    atRoot: false,
    focusedPath: rowItem.path,
    hasSearchQuery: false,
    isIndexing,
    layout,
    mediaPreview: { attachMetadata() {}, loadThumbnail() {} },
    selectedPaths: new Set(selected ? [rowItem.path] : []),
    onFocusItem(entry) { calls.focus.push(entry.path); },
    onMoveFocus(entry, key, behavior) { calls.move.push([entry.path, key, behavior]); },
    onOpenFile(entry) { calls.open.push(entry.path); },
    onOpenFolder(entry) { calls.folders.push(entry.path); },
    onRemoveRoot() {},
    onDragFiles(entry) { calls.dragStart.push(entry.path); return [entry.path]; },
    onDragEnd(entry) { calls.dragEnd.push(entry.path); },
    onSelectFile(entry, event, behavior) {
      calls.select.push({ path: entry.path, behavior, shiftKey: event.shiftKey });
    },
  });
  return { calls, item: rowItem, row };
}

test("file rows expose a drag source for the queue", () => {
  installFakeDom();
  try {
    const { calls, row } = createFileRow();
    assert.equal(row.draggable, true);
    const dragStart = row.dispatch("dragstart");
    assert.equal(dragStart.defaultPrevented, false);
    assert.equal(row.classList.contains("dragging"), true);
    row.dispatch("dragend");
    assert.equal(row.classList.contains("dragging"), false);
    assert.deepEqual(calls.dragStart, ["/media/Example.mkv"]);
    assert.deepEqual(calls.dragEnd, ["/media/Example.mkv"]);
  } finally {
    delete global.document;
    delete global.QuickFoldersView;
    delete global.QuickFoldersFileTypes;
  }
});

test("file rows remain interactive while the search index refreshes", () => {
  installFakeDom();
  try {
    const { calls, row } = createFileRow({ isIndexing: true });
    row.dispatch("click");
    assert.equal(row.draggable, true);
    assert.equal(row.tabIndex, 0);
    assert.deepEqual(calls.open, ["/media/Example.mkv"]);
  } finally {
    delete global.document;
    delete global.QuickFoldersView;
    delete global.QuickFoldersFileTypes;
  }
});

test("file activation distinguishes immediate open from modifier selection and duplicate clicks", () => {
  assert.equal(ItemView.getFileActivation({ detail: 1 }), "open");
  assert.equal(ItemView.getFileActivation({ detail: 2 }), "ignore");
  assert.equal(ItemView.getFileActivation({ detail: 1, metaKey: true }), "select");
  assert.equal(ItemView.getFileActivation({ detail: 1, ctrlKey: true }), "select");
  assert.equal(ItemView.getFileActivation({ detail: 1, shiftKey: true }), "select");
  assert.equal(ItemView.getFileActivation({ detail: 1 }, true), "select");
});

test("plain clicking any file row opens once without rerender-dependent double click", () => {
  installFakeDom();
  try {
    const { calls, item, row } = createFileRow({ selected: true });
    row.dispatch("click", { detail: 1 });
    row.dispatch("click", { detail: 2 });

    assert.deepEqual(calls.open, [item.path]);
    assert.deepEqual(calls.select, []);
    assert.equal(row.listeners.has("dblclick"), false);
  } finally {
    delete global.document;
    delete global.QuickFoldersView;
    delete global.QuickFoldersFileTypes;
  }
});

test("modifier clicks and the visible selection indicator select without opening", () => {
  installFakeDom();
  try {
    const { calls, row } = createFileRow();
    const indicator = row.children[2];
    row.dispatch("click", { metaKey: true });
    row.dispatch("click", { shiftKey: true });
    row.dispatch("click", { target: indicator });

    assert.deepEqual(calls.open, []);
    assert.deepEqual(calls.select, [
      { path: "/media/Example.mkv", behavior: { additive: false }, shiftKey: false },
      { path: "/media/Example.mkv", behavior: { additive: false }, shiftKey: true },
      { path: "/media/Example.mkv", behavior: { additive: true }, shiftKey: false },
    ]);
  } finally {
    delete global.document;
    delete global.QuickFoldersView;
    delete global.QuickFoldersFileTypes;
  }
});

test("focused file rows use Enter for selection, Space for playback, and arrows for navigation", () => {
  installFakeDom();
  try {
    const { calls, row } = createFileRow();
    assert.equal(row.getAttribute("role"), "option");
    assert.equal(row.getAttribute("aria-selected"), "false");
    assert.equal(row.tabIndex, 0);

    const enter = row.dispatch("keydown", { key: "Enter" });
    assert.deepEqual(calls.open, []);
    assert.deepEqual(calls.select, [{
      path: "/media/Example.mkv",
      behavior: { additive: true, restoreFocus: true },
      shiftKey: false,
    }]);

    const space = row.dispatch("keydown", { key: " " });
    assert.deepEqual(calls.open, ["/media/Example.mkv"]);
    const down = row.dispatch("keydown", { key: "ArrowDown" });
    const shiftUp = row.dispatch("keydown", { key: "ArrowUp", shiftKey: true });
    const commandDown = row.dispatch("keydown", { key: "ArrowDown", metaKey: true });
    const optionEnter = row.dispatch("keydown", { key: "Enter", altKey: true });

    assert.equal(enter.defaultPrevented && enter.propagationStopped, true);
    assert.equal(space.defaultPrevented && space.propagationStopped, true);
    assert.equal(down.defaultPrevented && down.propagationStopped, true);
    assert.equal(commandDown.defaultPrevented, false);
    assert.equal(optionEnter.defaultPrevented, false);
    assert.deepEqual(calls.open, ["/media/Example.mkv"]);
    assert.deepEqual(calls.select, [{
      path: "/media/Example.mkv",
      behavior: { additive: true, restoreFocus: true },
      shiftKey: false,
    }]);
    assert.deepEqual(calls.move, [
      ["/media/Example.mkv", "ArrowDown", { extendSelection: false }],
      ["/media/Example.mkv", "ArrowUp", { extendSelection: true }],
    ]);
  } finally {
    delete global.document;
    delete global.QuickFoldersView;
    delete global.QuickFoldersFileTypes;
  }
});

test("focused folder rows open with Enter or Space", () => {
  installFakeDom();
  try {
    const folder = { name: "Shows", path: "/media/Shows", isDir: true };
    const { calls, row } = createFileRow({ item: folder });

    const enter = row.dispatch("keydown", { key: "Enter" });
    const space = row.dispatch("keydown", { key: " " });

    assert.equal(enter.defaultPrevented && enter.propagationStopped, true);
    assert.equal(space.defaultPrevented && space.propagationStopped, true);
    assert.deepEqual(calls.folders, [folder.path, folder.path]);
    assert.deepEqual(calls.open, []);
    assert.deepEqual(calls.select, []);
  } finally {
    delete global.document;
    delete global.QuickFoldersView;
    delete global.QuickFoldersFileTypes;
  }
});

test("row shortcuts do not override a nested button's keyboard activation", () => {
  installFakeDom();
  try {
    const folder = { name: "Shows", path: "/media/Shows", isDir: true };
    const { calls, row } = createFileRow({ item: folder });
    const button = new FakeElement("button");
    const enter = row.dispatch("keydown", { key: "Enter", target: button });
    const space = row.dispatch("keydown", { key: " ", target: button });

    assert.equal(enter.defaultPrevented, false);
    assert.equal(space.defaultPrevented, false);
    assert.deepEqual(calls.folders, []);
  } finally {
    delete global.document;
    delete global.QuickFoldersView;
    delete global.QuickFoldersFileTypes;
  }
});

test("clamps playback progress and exposes stable state labels and accessible values", () => {
  installFakeDom();
  try {
    const item = {
      name: "Episode.mkv",
      path: "/media/Episode.mkv",
      isDir: false,
      fromSmartView: true,
      progress: { state: "in-progress", position: 150, duration: 100 },
    };
    const { row } = createFileRow({ item });
    const thumbnail = row.children[0];
    const progress = thumbnail.children[0];
    const info = row.children[1].children[1];
    const stateTag = info.children[1];

    assert.equal(progress.classList.contains("playback-progress"), true);
    assert.equal(progress.getAttribute("aria-valuenow"), "100");
    assert.equal(progress.getAttribute("aria-label"), "100% watched");
    assert.equal(progress.children[0].style.width, "100%");
    assert.equal(stateTag.textContent, "In Progress");
    assert.equal(info.children[2].textContent, "media");
    assert.match(row.getAttribute("aria-label"), /In Progress, 100% watched/);
    assert.deepEqual(ItemView.getPlaybackPresentation({
      playbackState: "in-progress",
      progressFraction: -0.5,
    }), {
      fraction: 0,
      hasPlaybackData: true,
      label: "In Progress",
      percent: 0,
      state: "in-progress",
      progressLabel: "0% watched",
    });
  } finally {
    delete global.document;
    delete global.QuickFoldersView;
    delete global.QuickFoldersFileTypes;
  }
});

test("grid rows forward two-dimensional arrow navigation", () => {
  installFakeDom();
  try {
    const { calls, row } = createFileRow({ layout: "grid" });
    const left = row.dispatch("keydown", { key: "ArrowLeft" });
    const right = row.dispatch("keydown", { key: "ArrowRight" });
    assert.equal(left.defaultPrevented && right.defaultPrevented, true);
    assert.deepEqual(calls.move, [
      ["/media/Example.mkv", "ArrowLeft", { extendSelection: false }],
      ["/media/Example.mkv", "ArrowRight", { extendSelection: false }],
    ]);
  } finally {
    delete global.document;
    delete global.QuickFoldersView;
    delete global.QuickFoldersFileTypes;
  }
});
