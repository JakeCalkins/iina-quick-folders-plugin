const test = require("node:test");
const assert = require("node:assert/strict");
const QueueState = require("../queue-state.js");

test("queue additions are ordered, unique, and bounded", () => {
  assert.deepEqual(
    QueueState.addPaths(["/media/a.mp4"], ["/media/b.mkv", "/media/a.mp4", "/media/c.mov"], 3),
    ["/media/a.mp4", "/media/b.mkv", "/media/c.mov"],
  );
  assert.deepEqual(QueueState.addPaths([], [null, "", "/media/a.mp4"]), ["/media/a.mp4"]);
});

test("queue removal ignores unknown and malformed paths", () => {
  assert.deepEqual(
    QueueState.removePaths(["/media/a.mp4", "/media/b.mkv"], ["/outside.mov", "/media/a.mp4"]),
    ["/media/b.mkv"],
  );
});

test("multi-item queue moves preserve relative order", () => {
  const queue = ["a", "b", "c", "d", "e"];
  assert.deepEqual(QueueState.movePaths(queue, ["b", "d"], "e", "after"), ["a", "c", "e", "b", "d"]);
  assert.deepEqual(QueueState.movePaths(queue, ["d", "b"], "a", "before"), ["b", "d", "a", "c", "e"]);
  assert.deepEqual(QueueState.movePaths(queue, ["b", "c"], "c", "before"), queue);
  assert.deepEqual(QueueState.movePaths(queue, ["missing"], "a", "before"), queue);
});

test("dragging a selected entry carries selected entries in visual order", () => {
  const order = ["a", "b", "c", "d"];
  assert.deepEqual(QueueState.getDraggedPaths(order, ["d", "b"], "b"), ["b", "d"]);
  assert.deepEqual(QueueState.getDraggedPaths(order, ["b", "d"], "c"), ["c"]);
  assert.deepEqual(QueueState.getDraggedPaths(order, ["b"], "missing"), []);
});
