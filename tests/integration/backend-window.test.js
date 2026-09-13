const test = require("node:test");
const assert = require("node:assert/strict");

const { createIinaWindowHarness } = require("./iina-window-harness.js");

test("UI messages cross the standalone-window boundary into backend persistence and native actions", () => {
  const harness = createIinaWindowHarness();
  const updates = [];
  const itemResults = [];
  const queueResults = [];
  harness.messaging.onMessage("update-items", (data) => updates.push(data));
  harness.messaging.onMessage("item-action-result", (data) => itemResults.push(data));
  harness.messaging.onMessage("queue-action-result", (data) => queueResults.push(data));

  harness.messaging.send("request-state", { indexRevision: -1 });
  assert.equal(updates.at(-1).atRoot, true);
  assert.deepEqual(Array.from(updates.at(-1).availableExtensions), ["mkv", "mp3"]);
  assert.equal(updates.at(-1).items.some((item) => item.path === "/media"), true);

  harness.messaging.send("open-item", { path: "/outside/Escape.mkv", isDir: false });
  harness.messaging.send("open-item", { path: "/media/Alpha.mkv", isDir: false });
  assert.deepEqual(harness.openedPaths, ["/media/Alpha.mkv"]);

  harness.messaging.send("queue-add", {
    paths: ["/media/Beta.mp3", "/outside/Escape.mkv", "/media/Beta.mp3"],
  });
  assert.deepEqual(Array.from(queueResults.at(-1).succeeded), ["/media/Beta.mp3"]);
  assert.equal(queueResults.at(-1).failed.length, 1);
  assert.deepEqual(Array.from(harness.readJson(harness.statePath).queuePaths), ["/media/Beta.mp3"]);

  harness.messaging.send("set-watched", {
    paths: ["/media/Alpha.mkv", "/outside/Escape.mkv"],
    watched: true,
  });
  assert.deepEqual(Array.from(itemResults.at(-1).succeeded), ["/media/Alpha.mkv"]);
  assert.equal(itemResults.at(-1).failed.length, 1);
  assert.equal(
    harness.readJson("@data/quick-folders-playback.json").records["/media/Alpha.mkv"].manualState,
    "watched",
  );

  harness.openWindow();
  assert.equal(harness.backendHandlerCounts.get("request-state"), 1);
  harness.messaging.send("request-state", { indexRevision: updates.at(-1).indexRevision });
  assert.equal(Object.hasOwn(updates.at(-1), "indexedFiles"), false);
});
