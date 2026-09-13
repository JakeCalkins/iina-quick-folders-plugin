const test = require("node:test");
const assert = require("node:assert/strict");
const Commands = require("../ui/commands.js");
const CommandPalette = require("../ui/command-palette.js");

class FakeElement {
  constructor(tagName, documentObject) {
    this.tagName = String(tagName || "div").toUpperCase();
    this.ownerDocument = documentObject;
    this.children = [];
    this.listeners = new Map();
    this.attributes = new Map();
    this.dataset = {};
    this.value = "";
    this.id = "";
    this._classes = new Set();
    this.classList = {
      add: (...names) => names.forEach((name) => this._classes.add(name)),
      remove: (...names) => names.forEach((name) => this._classes.delete(name)),
      toggle: (name, enabled) => enabled ? this._classes.add(name) : this._classes.delete(name),
      contains: (name) => this._classes.has(name),
    };
  }

  set className(value) { this._classes = new Set(String(value).split(/\s+/).filter(Boolean)); }
  get className() { return Array.from(this._classes).join(" "); }
  setAttribute(name, value) { this.attributes.set(name, String(value)); }
  getAttribute(name) { return this.attributes.get(name); }
  removeAttribute(name) { this.attributes.delete(name); }
  addEventListener(type, listener) {
    const listeners = this.listeners.get(type) || [];
    listeners.push(listener);
    this.listeners.set(type, listeners);
  }
  appendChild(child) {
    if (child.isFragment) this.children.push(...child.children);
    else this.children.push(child);
    return child;
  }
  replaceChildren() { this.children = []; }
  querySelectorAll(selector) {
    return selector === "[role='option']"
      ? this.children.filter((child) => child.getAttribute && child.getAttribute("role") === "option")
      : [];
  }
  focus() { this.ownerDocument.activeElement = this; this.focused = true; }
  select() { this.selected = true; }
  scrollIntoView(options) { this.scrolled = options; }
  dispatch(type, values = {}) {
    const event = {
      key: "",
      defaultPrevented: false,
      isComposing: false,
      preventDefault() { this.defaultPrevented = true; },
      ...values,
    };
    (this.listeners.get(type) || []).forEach((listener) => listener(event));
    return event;
  }
}

function createHarness() {
  const documentObject = {
    activeElement: null,
    createElement(tagName) { return new FakeElement(tagName, documentObject); },
    createDocumentFragment() {
      const fragment = new FakeElement("fragment", documentObject);
      fragment.isFragment = true;
      return fragment;
    },
  };
  const trigger = documentObject.createElement("button");
  trigger.focus();
  const element = documentObject.createElement("section");
  element.classList.add("hidden");
  const input = documentObject.createElement("input");
  const list = documentObject.createElement("div");
  const empty = documentObject.createElement("p");
  const executed = [];
  const registry = Commands.create({
    commands: [
      { id: "alpha", label: "Alpha Command", group: "Test" },
      { id: "beta", label: "Beta Command", group: "Test", shortcut: "B" },
    ],
    onExecute(command) { executed.push(command.id); },
  });
  const palette = CommandPalette.create({
    documentObject,
    element,
    input,
    list,
    empty,
    registry,
  });
  return { documentObject, element, empty, executed, input, list, palette, trigger };
}

test("opening configures combobox semantics, renders options, and focuses the query", () => {
  const harness = createHarness();
  harness.palette.show();
  assert.equal(harness.palette.isOpen(), true);
  assert.equal(harness.element.classList.contains("hidden"), false);
  assert.equal(harness.input.getAttribute("role"), "combobox");
  assert.equal(harness.input.getAttribute("aria-expanded"), "true");
  assert.equal(harness.input.getAttribute("aria-activedescendant"), harness.list.children[0].id);
  assert.equal(harness.documentObject.activeElement, harness.input);
  assert.deepEqual(harness.list.children.map((option) => option.dataset.commandId), ["alpha", "beta"]);
  assert.equal(harness.list.children[0].getAttribute("aria-selected"), "true");
});

test("arrow keys update active descendant and Enter executes exactly one command", () => {
  const harness = createHarness();
  harness.palette.show();
  const down = harness.input.dispatch("keydown", { key: "ArrowDown" });
  assert.equal(down.defaultPrevented, true);
  assert.equal(harness.palette.getActiveCommand().id, "beta");
  assert.equal(harness.list.children[1].getAttribute("aria-selected"), "true");

  const enter = harness.input.dispatch("keydown", { key: "Enter" });
  assert.equal(enter.defaultPrevented, true);
  assert.deepEqual(harness.executed, ["beta"]);
  assert.equal(harness.palette.isOpen(), false);
  assert.equal(harness.documentObject.activeElement, harness.trigger, "focus returns to the opener");
});

test("input filters commands, mouse activation works, and Escape closes", () => {
  const harness = createHarness();
  harness.palette.show();
  harness.input.value = "beta";
  harness.input.dispatch("input");
  assert.deepEqual(harness.list.children.map((option) => option.dataset.commandId), ["beta"]);
  const mouseDown = harness.list.children[0].dispatch("mousedown");
  assert.equal(mouseDown.defaultPrevented, true);
  harness.list.children[0].dispatch("click");
  assert.deepEqual(harness.executed, ["beta"]);

  harness.palette.show();
  const escape = harness.input.dispatch("keydown", { key: "Escape" });
  assert.equal(escape.defaultPrevented, true);
  assert.equal(harness.palette.isOpen(), false);
});

test("composition key events do not move or execute palette commands", () => {
  const harness = createHarness();
  harness.palette.show();
  harness.input.dispatch("keydown", { key: "ArrowDown", isComposing: true });
  harness.input.dispatch("keydown", { key: "Enter", isComposing: true });
  assert.equal(harness.palette.getActiveCommand().id, "alpha");
  assert.deepEqual(harness.executed, []);
});
