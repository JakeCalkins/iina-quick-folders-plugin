const test = require("node:test");
const assert = require("node:assert/strict");
const QueueState = require("../queue-state.js");
const QueueController = require("../ui/queue-controller.js");
const BrowseState = require("../browse-state.js");
const Interactions = require("../ui/interaction-controller.js");

function createTransfer() {
  const values = new Map();
  return {
    effectAllowed: "",
    dragImage: null,
    getData(type) { return values.get(type) || ""; },
    setDragImage(element, x, y) { this.dragImage = { element, x, y }; },
    setData(type, value) { values.set(type, value); },
  };
}

class FakeElement {
  constructor(tagName, ownerDocument) {
    this.tagName = tagName.toUpperCase();
    this.ownerDocument = ownerDocument;
    this.children = [];
    this.dataset = {};
    this.listeners = new Map();
    this.attributes = new Map();
    this.disabled = false;
    this.parentNode = null;
    this.tabIndex = -1;
    this._classes = new Set();
    this.classList = {
      add: (...names) => names.forEach((name) => this._classes.add(name)),
      remove: (...names) => names.forEach((name) => this._classes.delete(name)),
      contains: (name) => this._classes.has(name),
      toggle: (name, enabled) => enabled ? this._classes.add(name) : this._classes.delete(name),
    };
  }

  set className(value) { this._classes = new Set(String(value).split(/\s+/).filter(Boolean)); }
  get className() { return Array.from(this._classes).join(" "); }
  set innerHTML(value) { this.children = []; this._innerHTML = value; }
  get innerHTML() { return this._innerHTML || ""; }

  appendChild(child) {
    if (child.tagName === "#FRAGMENT") {
      child.children.forEach((entry) => { entry.parentNode = this; });
      this.children.push(...child.children);
    } else {
      child.parentNode = this;
      this.children.push(child);
    }
    return child;
  }

  removeChild(child) {
    this.children = this.children.filter((entry) => entry !== child);
    child.parentNode = null;
  }
  remove() { if (this.parentNode) this.parentNode.removeChild(this); }

  setAttribute(name, value) { this.attributes.set(name, String(value)); }
  getAttribute(name) { return this.attributes.get(name); }
  addEventListener(type, listener) {
    const listeners = this.listeners.get(type) || [];
    listeners.push(listener);
    this.listeners.set(type, listeners);
  }
  dispatch(type, properties = {}) {
    const event = {
      key: "", clientY: 0, metaKey: false, ctrlKey: false, shiftKey: false,
      target: this, currentTarget: this,
      preventDefault() {}, stopPropagation() {},
      ...properties,
    };
    (this.listeners.get(type) || []).forEach((listener) => listener(event));
    return event;
  }
  focus() { this.ownerDocument.activeElement = this; }
  getBoundingClientRect() { return { top: 0, height: 100 }; }
  querySelector(selector) { return this.querySelectorAll(selector)[0] || null; }
  querySelectorAll(selector) {
    const selectors = selector.split(",").map((part) => part.trim());
    const descendants = [];
    const visit = (element) => {
      element.children.forEach((child) => {
        descendants.push(child);
        visit(child);
      });
    };
    visit(this);
    return descendants.filter((element) => selectors.some((part) => {
      if (part === ".queue-row[data-path]") return element.classList.contains("queue-row") && Boolean(element.dataset.path);
      if (part === ".queue-row[tabindex='0']") return element.classList.contains("queue-row") && element.tabIndex === 0;
      if (part.startsWith(".")) return element.classList.contains(part.slice(1));
      return false;
    }));
  }
}

function installControllerDom() {
  const fakeDocument = {
    activeElement: null,
    createElement(tagName) { return new FakeElement(tagName, fakeDocument); },
    createDocumentFragment() { return new FakeElement("#fragment", fakeDocument); },
  };
  fakeDocument.body = new FakeElement("body", fakeDocument);
  global.document = fakeDocument;
  global.QuickFoldersQueueState = QueueState;
  global.QuickFoldersBrowseState = BrowseState;
  global.QuickFoldersInteractions = Interactions;
  global.QuickFoldersView = {
    getContainingFolder: () => "media",
    getDisplayName: (item) => item.name.replace(/\.[^.]+$/, ""),
  };
  global.QuickFoldersFileTypes = {
    getExtension: (name) => name.split(".").pop().toLowerCase(),
  };
  return fakeDocument;
}

function uninstallControllerDom() {
  delete global.document;
  delete global.QuickFoldersQueueState;
  delete global.QuickFoldersBrowseState;
  delete global.QuickFoldersInteractions;
  delete global.QuickFoldersView;
  delete global.QuickFoldersFileTypes;
}

test("queue drag payloads preserve multiple ordered paths", () => {
  global.QuickFoldersQueueState = QueueState;
  try {
    const dataTransfer = createTransfer();
    QueueController.writeDraggedPaths({ dataTransfer }, ["/media/a.mp4", "/media/b.mkv"]);
    assert.equal(dataTransfer.effectAllowed, "copyMove");
    assert.deepEqual(
      QueueController.readDraggedPaths({ dataTransfer }),
      ["/media/a.mp4", "/media/b.mkv"],
    );
  } finally {
    delete global.QuickFoldersQueueState;
  }
});

test("queue drag payload parsing falls back safely", () => {
  global.QuickFoldersQueueState = QueueState;
  try {
    const malformedTransfer = { getData(type) { return type.includes("quick-folders") ? "{" : ""; } };
    assert.deepEqual(
      QueueController.readDraggedPaths({ dataTransfer: malformedTransfer }, ["/media/fallback.mov"]),
      ["/media/fallback.mov"],
    );
    assert.deepEqual(QueueController.readDraggedPaths(null, ["/media/fallback.mov"]), ["/media/fallback.mov"]);
  } finally {
    delete global.QuickFoldersQueueState;
  }
});

test("queue editor multi-selects, reorders, and accepts bucket and pane drops", () => {
  const document = installControllerDom();
  try {
    const elements = {
      panel: document.createElement("aside"),
      toggleButton: document.createElement("button"),
      badge: document.createElement("span"),
      list: document.createElement("section"),
      count: document.createElement("span"),
      clearButton: document.createElement("button"),
      removeButton: document.createElement("button"),
      closeButton: document.createElement("button"),
      playButton: document.createElement("button"),
    };
    elements.panel.classList.add("hidden");
    const messages = [];
    const controller = QueueController.create({
      ...elements,
      sendMessage(type, data) { messages.push({ type, data }); },
      onOpenChange() {},
    });
    controller.setOpen(true, { notify: false, focus: false });
    assert.equal(elements.panel.classList.contains("hidden"), false);
    assert.equal(document.activeElement, null, "responsive opening should not steal focus");
    controller.setOpen(false, { notify: false, focus: false });
    controller.setItems([
      { name: "a.mp4", path: "/media/a.mp4" },
      { name: "b.mkv", path: "/media/b.mkv" },
      { name: "c.mov", path: "/media/c.mov" },
    ]);

    let rows = elements.list.querySelectorAll(".queue-row[data-path]");
    const firstRow = rows[0];
    controller.setItems([
      { name: "a.mp4", path: "/media/a.mp4" },
      { name: "b.mkv", path: "/media/b.mkv" },
      { name: "c.mov", path: "/media/c.mov" },
    ]);
    assert.equal(
      elements.list.querySelectorAll(".queue-row[data-path]")[0],
      firstRow,
      "an unchanged backend state should not rebuild queue rows",
    );
    rows[0].dispatch("click");
    rows = elements.list.querySelectorAll(".queue-row[data-path]");
    assert.equal(rows[0], firstRow, "selection should not rebuild queue rows");
    rows[1].dispatch("click", { shiftKey: true });
    rows = elements.list.querySelectorAll(".queue-row[data-path]");
    assert.equal(elements.count.textContent, "2 selected");

    rows[0].dispatch("keydown", { key: "Escape" });
    rows[0].dispatch("keydown", { key: "ArrowDown", shiftKey: true });
    assert.equal(elements.count.textContent, "2 selected", "Shift-arrow should include its focused anchor");

    const dataTransfer = createTransfer();
    rows[0].dispatch("dragstart", { dataTransfer });
    assert.equal(dataTransfer.dragImage.element.classList.contains("drag-preview-reorder"), true);
    assert.equal(document.body.classList.contains("dragging-queue"), true);
    assert.equal(elements.list.classList.contains("reordering"), true);
    rows[2].dispatch("drop", { clientY: 75, dataTransfer });
    assert.deepEqual(messages.at(-1), {
      type: "queue-reorder",
      data: {
        paths: ["/media/a.mp4", "/media/b.mkv"],
        targetPath: "/media/c.mov",
        position: "after",
      },
    });
    rows[0].dispatch("dragend");
    assert.equal(document.body.classList.contains("dragging-queue"), false);
    assert.equal(elements.list.classList.contains("reordering"), false);
    assert.equal(document.body.querySelector(".drag-preview"), null);

    const bucketTransfer = createTransfer();
    controller.startExternalDrag(
      { dataTransfer: bucketTransfer }, ["/media/c.mov"], "Example clip",
    );
    assert.equal(bucketTransfer.dragImage.element.classList.contains("drag-preview-add"), true);
    assert.equal(document.body.classList.contains("dragging-media"), true);
    elements.toggleButton.dispatch("drop", { dataTransfer: bucketTransfer });
    assert.deepEqual(messages.at(-1), {
      type: "queue-add",
      data: { paths: ["/media/c.mov"] },
    });
    assert.equal(document.body.classList.contains("dragging-media"), false);
    assert.equal(document.body.querySelector(".drag-preview"), null);

    const paneTransfer = createTransfer();
    controller.startExternalDrag(
      { dataTransfer: paneTransfer }, ["/media/a.mp4", "/media/c.mov"], "2 clips",
    );
    elements.panel.dispatch("dragenter", { dataTransfer: paneTransfer, target: rows[2] });
    assert.equal(elements.panel.classList.contains("drop-ready"), true);
    elements.panel.dispatch("dragover", { dataTransfer: paneTransfer, target: rows[2] });
    assert.equal(paneTransfer.dropEffect, "copy");
    elements.panel.dispatch("drop", { dataTransfer: paneTransfer, target: rows[2] });
    assert.deepEqual(messages.at(-1), {
      type: "queue-add",
      data: { paths: ["/media/a.mp4", "/media/c.mov"] },
    });
    assert.equal(elements.panel.classList.contains("drop-ready"), false);
    assert.equal(document.body.classList.contains("dragging-media"), false);
  } finally {
    uninstallControllerDom();
  }
});
