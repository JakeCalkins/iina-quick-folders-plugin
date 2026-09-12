const test = require("node:test");
const assert = require("node:assert/strict");
const Interactions = require("../ui/interaction-controller.js");

function createHarness() {
  const messages = [];
  let resets = 0;
  const filters = [];
  const controller = Interactions.create({
    sendMessage(type, data) {
      messages.push({ type, data });
    },
    resetBrowseContext() {
      resets++;
    },
    changeFilter(filter) {
      filters.push(filter);
    },
  });
  return { controller, filters, messages, get resets() { return resets; } };
}

test("back and breadcrumb navigation reset transient browse state and send exact commands", () => {
  const harness = createHarness();

  harness.controller.goBack();
  assert.equal(harness.controller.navigateTo("/media/shows"), true);

  assert.equal(harness.resets, 2);
  assert.deepEqual(harness.messages, [
    { type: "go-back", data: undefined },
    { type: "navigate-to", data: { path: "/media/shows" } },
  ]);
});

test("folder activation clears stale search state before opening the directory", () => {
  const harness = createHarness();

  assert.equal(harness.controller.openFolder({ path: "/media/shows", isWatchedRoot: false }), true);
  assert.equal(harness.controller.openFolder({ path: "@watched", isWatchedRoot: true }), true);

  assert.equal(harness.resets, 2);
  assert.deepEqual(harness.messages, [
    {
      type: "open-item",
      data: { path: "/media/shows", isDir: true, isWatchedRoot: false },
    },
    {
      type: "open-item",
      data: { path: "@watched", isDir: true, isWatchedRoot: true },
    },
  ]);
});

test("native select input and change events apply a filter only once", () => {
  const harness = createHarness();

  assert.equal(harness.controller.applyFilter("ext:mkv", "all"), true);
  assert.equal(harness.controller.applyFilter("ext:mkv", "ext:mkv"), false);
  assert.equal(harness.controller.applyFilter("all", "ext:mkv"), true);
  assert.deepEqual(harness.filters, ["ext:mkv", "all"]);
});

test("interaction boundary rejects malformed navigation and filter values", () => {
  const harness = createHarness();

  assert.equal(harness.controller.navigateTo(""), false);
  assert.equal(harness.controller.openFolder(null), false);
  assert.equal(harness.controller.applyFilter("ext:../../private", "all"), false);
  assert.equal(harness.controller.applyFilter(null, "all"), false);
  assert.equal(harness.resets, 0);
  assert.deepEqual(harness.messages, []);
  assert.deepEqual(harness.filters, []);
});

test("keyboard navigation establishes focus and stays inside list bounds", () => {
  const items = [
    { path: "/media/a.mp4" },
    { path: "/media/b.mkv" },
    { path: "/media/c.mov" },
  ];

  assert.equal(Interactions.getNavigationTarget(items, null, "ArrowDown").path, "/media/a.mp4");
  assert.equal(Interactions.getNavigationTarget(items, null, "ArrowUp").path, "/media/c.mov");
  assert.equal(Interactions.getNavigationTarget(items, "/media/a.mp4", "ArrowUp").path, "/media/a.mp4");
  assert.equal(Interactions.getNavigationTarget(items, "/media/a.mp4", "ArrowDown").path, "/media/b.mkv");
  assert.equal(Interactions.getNavigationTarget(items, "/media/b.mkv", "Home").path, "/media/a.mp4");
  assert.equal(Interactions.getNavigationTarget(items, "/media/b.mkv", "End").path, "/media/c.mov");
  assert.equal(Interactions.getNavigationTarget([], null, "ArrowDown"), null);
  assert.equal(Interactions.getNavigationTarget(items, "/media/a.mp4", "PageDown"), null);
  assert.equal(Interactions.getNavigationTarget(items, null, "PageDown"), null);
});

test("global list shortcuts ignore native and custom interactive controls", () => {
  assert.equal(Interactions.isInteractiveControl(null), false);
  assert.equal(Interactions.isInteractiveControl({ tagName: "DIV" }), false);
  assert.equal(Interactions.isInteractiveControl({ tagName: "BUTTON" }), true);
  assert.equal(Interactions.isInteractiveControl({ tagName: "INPUT" }), true);
  assert.equal(Interactions.isInteractiveControl({ isContentEditable: true }), true);
  assert.equal(Interactions.isInteractiveControl({
    tagName: "svg",
    closest(selector) {
      assert.match(selector, /button/);
      return { tagName: "BUTTON" };
    },
  }), true);
  assert.equal(Interactions.isInteractiveControl({
    tagName: "DIV",
    closest() { return null; },
  }), false);
});
