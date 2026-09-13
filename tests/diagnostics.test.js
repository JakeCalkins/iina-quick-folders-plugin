const test = require("node:test");
const assert = require("node:assert/strict");

const diagnosticsModule = require("../diagnostics.js");

test("retains a bounded chronological event ring", () => {
  let timestamp = 10;
  const diagnostics = diagnosticsModule.create({ maxEvents: 2, now: () => timestamp++ });
  diagnostics.record("index", "scan-failed", { durationMs: 1.4 });
  diagnostics.record("metadata", "tool-unavailable", { durationMs: 2.6 });
  diagnostics.record("playback", "write-failed", { durationMs: 3.2 });

  assert.deepEqual(diagnostics.getSnapshot().events, [
    { timestamp: 11, category: "metadata", code: "tool-unavailable", durationMs: 3 },
    { timestamp: 12, category: "playback", code: "write-failed", durationMs: 3 },
  ]);
});

test("rejects path-bearing labels, raw messages, and nonnumeric details", () => {
  const diagnostics = diagnosticsModule.create({ now: () => 100 });
  diagnostics.record("/media/Private Folder", "/media/Private Folder/secret.mp4", {
    durationMs: 12,
    message: "Failed to read /media/Private Folder/secret.mp4",
    path: "/media/Private Folder/secret.mp4",
  });
  diagnostics.increment("/media/Private Folder", 1);
  diagnostics.setGauge("secret.mp4", 2);
  diagnostics.setRootStatus(1, "/media/Private Folder", { files: 4, path: "/media" });

  const serialized = JSON.stringify(diagnostics.getSnapshot());
  assert.doesNotMatch(serialized, /media|Private|secret|Failed/);
  assert.deepEqual(diagnostics.getSnapshot().events[0], {
    timestamp: 100,
    category: "runtime",
    code: "unknown",
    durationMs: 12,
  });
  assert.deepEqual(diagnostics.getSnapshot().roots, [
    { id: "root-1", status: "stale", files: 4 },
  ]);
});

test("tracks only known counters and gauges", () => {
  const diagnostics = diagnosticsModule.create({ now: () => 100 });
  assert.equal(diagnostics.increment("index.scans", 2), true);
  assert.equal(diagnostics.increment("index.scans", 3), true);
  assert.equal(diagnostics.increment("index.scans", -1), false);
  assert.equal(diagnostics.setGauge("queue.depth", 4), true);
  assert.equal(diagnostics.setGauge("queue.depth", Number.NaN), false);

  const snapshot = diagnostics.getSnapshot();
  assert.deepEqual(snapshot.counters, { "index.scans": 5 });
  assert.deepEqual(snapshot.gauges, { "queue.depth": 4 });
});

test("snapshots are defensive and reset removes retained diagnostics", () => {
  const diagnostics = diagnosticsModule.create({ now: () => 100 });
  diagnostics.record("index", "timeout");
  diagnostics.setRootStatus(2, "ready", { files: 10, directories: 2 });
  const snapshot = diagnostics.getSnapshot();
  snapshot.events[0].code = "changed";
  snapshot.roots[0].status = "changed";
  assert.equal(diagnostics.getSnapshot().events[0].code, "timeout");
  assert.equal(diagnostics.getSnapshot().roots[0].status, "ready");

  diagnostics.reset();
  assert.deepEqual(diagnostics.getSnapshot(), {
    generatedAt: 100,
    events: [],
    counters: {},
    gauges: {},
    roots: [],
  });
});
