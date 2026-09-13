const test = require("node:test");
const assert = require("node:assert/strict");
const ItemCollection = require("../ui/item-collection.js");

class FakeElement {
  constructor(tagName, ownerDocument = null) {
    this.tagName = tagName.toUpperCase();
    this.ownerDocument = ownerDocument;
    this.children = [];
    this.dataset = {};
    this.listeners = new Map();
    this.attributes = new Map();
    this.clientHeight = 0;
    this.clientWidth = 0;
    this.scrollTop = 0;
    this._classes = new Set();
    this.classList = {
      contains: (name) => this._classes.has(name),
      toggle: (name, enabled) => enabled ? this._classes.add(name) : this._classes.delete(name),
    };
    this.style = {
      values: new Map(),
      setProperty: (name, value) => this.style.values.set(name, value),
    };
  }

  get firstChild() { return this.children[0] || null; }
  set className(value) { this._classes = new Set(String(value).split(/\s+/).filter(Boolean)); }
  get className() { return Array.from(this._classes).join(" "); }
  appendChild(child) { child.parentElement = this; this.children.push(child); return child; }
  removeChild(child) {
    this.children = this.children.filter((candidate) => candidate !== child);
    child.parentElement = null;
  }
  setAttribute(name, value) { this.attributes.set(name, String(value)); }
  getAttribute(name) { return this.attributes.get(name); }
  addEventListener(type, callback) { this.listeners.set(type, callback); }
  focus() {
    this.focused = true;
    if (this.ownerDocument) this.ownerDocument.activeElement = this;
  }
  querySelector(selector) {
    const pathMatch = selector.match(/^\[data-path="(.*)"\]$/);
    const matches = (element) => pathMatch && element.dataset.path === pathMatch[1].replace(/\\(["\\])/g, "$1");
    const visit = (element) => {
      for (const child of element.children) {
        if (matches(child)) return child;
        const nested = visit(child);
        if (nested) return nested;
      }
      return null;
    };
    return visit(this);
  }
  querySelectorAll(selector) {
    if (selector !== "[data-path]") return [];
    const found = [];
    const visit = (element) => {
      element.children.forEach((child) => {
        if (typeof child.dataset.path === "string") found.push(child);
        visit(child);
      });
    };
    visit(this);
    return found;
  }
}

function createDom() {
  const document = { createElement: (tagName) => new FakeElement(tagName, document) };
  const container = new FakeElement("section", document);
  container.clientWidth = 500;
  container.clientHeight = 600;
  return { container, document };
}

function makeItems(count, prefix = "item") {
  return Array.from({ length: count }, (_, index) => ({
    name: `${prefix}-${index}.mp4`,
    path: `/media/${prefix}-${index}.mp4`,
  }));
}

test("windows a 100K-item collection to a bounded number of DOM nodes", () => {
  const { container, document } = createDom();
  const collection = ItemCollection.create({
    container,
    items: makeItems(100000),
    layout: "list",
    overscanRows: 3,
    createItem(item) {
      const element = document.createElement("div");
      element.dataset.path = item.path;
      return element;
    },
  });

  const initialWindow = collection.getWindow();
  const renderedWindow = container.children[1];
  assert.equal(initialWindow.endIndex - initialWindow.startIndex < 25, true);
  assert.equal(renderedWindow.children.length, initialWindow.endIndex - initialWindow.startIndex);
  assert.equal(container.children.length, 3, "only spacers and one bounded window should be mounted");
  assert.equal(renderedWindow.children[0].getAttribute("aria-setsize"), "100000");
  assert.equal(container.style.values.get("--item-height"), "64px");
  assert.equal(container.style.values.get("--item-gap"), "2px");
});

test("uses list and grid keyboard geometry without leaving collection bounds", () => {
  const grid = { itemCount: 10, layout: "grid", viewportWidth: 500 };
  assert.equal(ItemCollection.getColumnCount("grid", 500), 3);
  assert.equal(ItemCollection.getNavigationIndex(1, "ArrowDown", grid), 4);
  assert.equal(ItemCollection.getNavigationIndex(4, "ArrowUp", grid), 1);
  assert.equal(ItemCollection.getNavigationIndex(4, "ArrowLeft", grid), 3);
  assert.equal(ItemCollection.getNavigationIndex(9, "ArrowRight", grid), 9);
  assert.equal(ItemCollection.getNavigationIndex(8, "ArrowDown", grid), 9);
  assert.equal(ItemCollection.getNavigationIndex(4, "ArrowRight", {
    ...grid,
    layout: "list",
  }), 4);
});

test("preserves a path-keyed scroll anchor across item and layout changes", () => {
  const items = makeItems(100);
  const model = ItemCollection.createModel({
    items,
    layout: "list",
    viewportHeight: 132,
    viewportWidth: 500,
    scrollTop: 20 * 66 + 11,
  });
  assert.deepEqual(model.captureAnchor(), { path: items[20].path, offset: 11 });

  model.setItems([{ name: "first.mp4", path: "/media/first.mp4" }, ...items]);
  assert.equal(model.getScrollTop(), 21 * 66 + 11);
  model.setLayout("grid");
  assert.equal(model.getScrollTop(), 7 * 228 + 11);
});

test("ensure-visible renders and focuses an offscreen path through a hook", () => {
  const { container, document } = createDom();
  const ensured = [];
  const items = makeItems(100000);
  const collection = ItemCollection.create({
    container,
    items,
    layout: "grid",
    createItem(item) {
      const element = document.createElement("div");
      element.dataset.path = item.path;
      return element;
    },
    onEnsureVisible(path, element) { ensured.push({ path, element }); },
  });

  const target = collection.moveFocus(items[0].path, "End");
  assert.equal(target.path, items.at(-1).path);
  assert.equal(ensured[0].path, target.path);
  assert.equal(ensured[0].element.focused, true);
  assert.equal(container.children[1].children.length < 50, true);
});

test("keeps focused keyed content stable across redundant renders and item refreshes", () => {
  const { container, document } = createDom();
  const items = makeItems(100);
  let created = 0;
  const collection = ItemCollection.create({
    container,
    items,
    createItem(item) {
      created++;
      const element = document.createElement("div");
      element.dataset.path = item.path;
      return element;
    },
  });
  collection.focusPath(items[2].path);
  const focusedBefore = document.activeElement;
  const createdBefore = created;

  collection.render();
  assert.equal(created, createdBefore, "scroll updates within one window should retain mounted nodes");
  assert.equal(document.activeElement, focusedBefore);

  collection.setItems(items.map((item) => ({ ...item })));
  assert.notEqual(document.activeElement, focusedBefore);
  assert.equal(document.activeElement.dataset.path, items[2].path);
});

test("reconciles preview bindings on a new window without stealing outside focus", () => {
  const { container, document } = createDom();
  const items = makeItems(100);
  let beforeRenders = 0;
  const collection = ItemCollection.create({
    container,
    items,
    layout: "grid",
    onBeforeRender() { beforeRenders++; },
    createItem(item) {
      const element = document.createElement("div");
      element.dataset.path = item.path;
      return element;
    },
  });
  assert.equal(beforeRenders, 1);

  const outside = document.createElement("button");
  outside.dataset.path = items[0].path;
  outside.focus();
  container.scrollTop = 800;
  collection.render();
  assert.equal(beforeRenders, 2);
  assert.equal(document.activeElement, outside);
});
