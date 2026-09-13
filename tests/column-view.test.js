const test = require("node:test");
const assert = require("node:assert/strict");
const ColumnView = require("../ui/column-view.js");

class FakeElement {
  constructor(tagName) {
    this.tagName = tagName.toUpperCase();
    this.children = [];
    this.dataset = {};
    this.attributes = new Map();
    this.listeners = new Map();
    this.classes = new Set();
    this.classList = {
      add: (...names) => names.forEach((name) => this.classes.add(name)),
      contains: (name) => this.classes.has(name),
      toggle: (name, enabled) => enabled ? this.classes.add(name) : this.classes.delete(name),
    };
  }
  set className(value) { this.classes = new Set(String(value).split(/\s+/).filter(Boolean)); }
  get className() { return Array.from(this.classes).join(" "); }
  set innerHTML(value) { this.children = []; this._innerHTML = value; }
  appendChild(child) {
    this.children.push(...(child.tagName === "#FRAGMENT" ? child.children : [child]));
    return child;
  }
  setAttribute(name, value) { this.attributes.set(name, String(value)); }
  addEventListener(type, listener) { this.listeners.set(type, listener); }
  click() { this.listeners.get("click")(); }
}

function findByClass(root, className) {
  const matches = [];
  function visit(element) {
    if (element.classList && element.classList.contains(className)) matches.push(element);
    element.children.forEach(visit);
  }
  visit(root);
  return matches;
}

test("column view marks the active folder and routes folder and file activation", () => {
  global.document = {
    createElement: (tagName) => new FakeElement(tagName),
    createDocumentFragment: () => new FakeElement("#fragment"),
  };
  global.QuickFoldersView = {
    getDisplayName: (item) => item.name.replace(/\.[^.]+$/, ""),
    getFileIcon: (_name, isDir) => isDir ? "folder" : "file",
  };
  global.QuickFoldersFileTypes = {
    getExtension: (name) => name.split(".").pop().toLowerCase(),
  };
  try {
    const element = new FakeElement("nav");
    element.classList.add("hidden");
    const openedFolders = [];
    const openedFiles = [];
    const view = ColumnView.create({
      element,
      onOpenFolder: (item) => openedFolders.push(item.path),
      onOpenFile: (item) => openedFiles.push(item.path),
    });
    view.render([{
      title: "Media",
      selectedPath: "/media/shows",
      items: [
        { name: "shows", path: "/media/shows", isDir: true },
        { name: "clip.mp4", path: "/media/clip.mp4", isDir: false },
      ],
    }]);

    const items = findByClass(element, "column-item");
    assert.equal(element.classList.contains("hidden"), false);
    assert.equal(items.length, 2);
    assert.equal(items[0].classList.contains("selected"), true);
    assert.equal(items[0].attributes.get("aria-current"), "location");
    items[0].click();
    items[1].click();
    assert.deepEqual(openedFolders, ["/media/shows"]);
    assert.deepEqual(openedFiles, ["/media/clip.mp4"]);

    view.render([]);
    assert.equal(element.classList.contains("hidden"), true);
  } finally {
    delete global.document;
    delete global.QuickFoldersView;
    delete global.QuickFoldersFileTypes;
  }
});
