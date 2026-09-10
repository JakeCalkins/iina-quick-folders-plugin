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
    getData(type) { return values.get(type) || ""; },
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
    if (child.tagName === "#FRAGMENT") this.children.push(...child.children);
    else this.children.push(child);
    return child;
  }

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

test("queue editor multi-selects, multi-drags, reorders, and accepts bucket drops", () => {
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
    controller.setItems([
      { name: "a.mp4", path: "/media/a.mp4" },
      { name: "b.mkv", path: "/media/b.mkv" },
      { name: "c.mov", path: "/media/c.mov" },
    ]);

    let rows = elements.list.querySelectorAll(".queue-row[data-path]");
    rows[0].dispatch("click");
    rows = elements.list.querySelectorAll(".queue-row[data-path]");
    rows[1].dispatch("click", { shiftKey: true });
    rows = elements.list.querySelectorAll(".queue-row[data-path]");
    assert.equal(elements.count.textContent, "2 selected");

    const dataTransfer = createTransfer();
    rows[0].dispatch("dragstart", { dataTransfer });
    rows[2].dispatch("drop", { clientY: 75, dataTransfer });
    assert.deepEqual(messages.at(-1), {
      type: "queue-reorder",
      data: {
        paths: ["/media/a.mp4", "/media/b.mkv"],
        targetPath: "/media/c.mov",
        position: "after",
      },
    });

    const bucketTransfer = createTransfer();
    QueueController.writeDraggedPaths({ dataTransfer: bucketTransfer }, ["/media/c.mov"]);
    elements.toggleButton.dispatch("drop", { dataTransfer: bucketTransfer });
    assert.deepEqual(messages.at(-1), {
      type: "queue-add",
      data: { paths: ["/media/c.mov"] },
    });
  } finally {
    uninstallControllerDom();
  }
});
