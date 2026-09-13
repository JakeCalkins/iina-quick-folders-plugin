const test = require("node:test");
const assert = require("node:assert/strict");
const Commands = require("../ui/commands.js");

test("default registry exposes only commands available in the current context", () => {
  const registry = Commands.create();
  const ids = registry.list({
    availableViews: ["continue", "unwatched"],
    canGoBack: false,
    hasQuery: false,
    isIndexing: true,
    layout: "list",
    queueCount: 0,
    queueOpen: false,
    selectionCount: 0,
  }).map((command) => command.id);

  assert.equal(ids.includes("navigation.continue-watching"), true);
  assert.equal(ids.includes("navigation.watched"), false);
  assert.equal(ids.includes("navigation.back"), false);
  assert.equal(ids.includes("browse.refresh"), false);
  assert.equal(ids.includes("layout.grid"), true);
  assert.equal(ids.includes("layout.list"), false);
  assert.equal(ids.includes("selection.queue"), false);
  assert.equal(ids.includes("queue.open"), true);
  assert.equal(ids.includes("filter.video"), true);
});

test("file-type commands reflect the active filter and available media", () => {
  const registry = Commands.create();
  const ids = registry.list({
    availableMediaTypes: ["video", "image"],
    filter: "video",
  }).map((command) => command.id);
  assert.equal(ids.includes("filter.all"), true);
  assert.equal(ids.includes("filter.video"), false);
  assert.equal(ids.includes("filter.audio"), false);
  assert.equal(ids.includes("filter.image"), true);
});

test("search ranks labels and keywords while preserving registry order for empty input", () => {
  const registry = Commands.create();
  assert.equal(registry.search("resume", {}).at(0).id, "navigation.continue-watching");
  assert.equal(registry.search("diagnostic", {}).at(0).id, "diagnostics.open");
  assert.equal(registry.search("", {}).at(0).id, "navigation.root");
});

test("dynamic command labels reflect selection state", () => {
  const registry = Commands.create();
  const watched = registry.list({ selectionCount: 2, selectionAllWatched: true })
    .find((command) => command.id === "selection.toggle-watched");
  const mixed = registry.list({ selectionCount: 2, selectionAllWatched: false })
    .find((command) => command.id === "selection.toggle-watched");
  assert.equal(watched.label, "Mark Selection Unwatched");
  assert.equal(mixed.label, "Mark Selection Watched");
});

test("recent locations become bounded navigation commands with useful labels", () => {
  const registry = Commands.create();
  const commands = registry.list({
    recentLocations: [
      { kind: "folder", path: "/media/Shows" },
      { kind: "smart", viewId: "continue" },
    ],
  });
  assert.equal(commands.find((command) => command.id === "navigation.recent-location-1").label, "Open Recent: Shows");
  assert.equal(commands.find((command) => command.id === "navigation.recent-location-2").label, "Open Recent: Continue Watching");
  assert.equal(commands.some((command) => command.id === "navigation.recent-location-3"), false);
});

test("execution rechecks availability and delegates by command id", () => {
  const calls = [];
  const registry = Commands.create({
    handlers: {
      "selection.queue"(command, context) {
        calls.push({ command, context });
        return "queued";
      },
    },
  });
  assert.deepEqual(registry.execute("selection.queue", { selectionCount: 0 }), {
    executed: false,
    command: null,
    result: undefined,
  });
  const result = registry.execute("selection.queue", { selectionCount: 1 });
  assert.equal(result.executed, true);
  assert.equal(result.result, "queued");
  assert.equal(calls[0].command.id, "selection.queue");
});

test("custom predicates cannot break palette enumeration", () => {
  const registry = Commands.create({
    commands: [
      { id: "safe", label: "Safe" },
      { id: "broken", label: "Broken", when: () => { throw new Error("bad predicate"); } },
    ],
  });
  assert.deepEqual(registry.list({}).map((command) => command.id), ["safe"]);
});
