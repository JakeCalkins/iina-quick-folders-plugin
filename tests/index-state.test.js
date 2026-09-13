const test = require("node:test");
const assert = require("node:assert/strict");

const indexState = require("../index-state.js");

function file(path, overrides = {}) {
  return {
    path,
    name: path.split("/").pop(),
    type: "video",
    ext: "mp4",
    ...overrides,
  };
}

test("normalizes only files on a configured path boundary", () => {
  assert.equal(indexState.normalizeFileRecord(file("/media/movie.mp4"), "/media", 10).firstSeenAt, 10);
  assert.equal(indexState.normalizeFileRecord(file("/media-other/movie.mp4"), "/media", 10), null);
  assert.equal(indexState.normalizeFileRecord(file("/media/../private.mp4"), "/media", 10), null);
  assert.equal(indexState.normalizeFileRecord({ path: "/media/folder/file.mp4", name: "../file.mp4" }, "/media", 10), null);
});

test("successful root merges report diffs and preserve first-seen timestamps", () => {
  let snapshot = indexState.createSnapshot("depth=3");
  const first = indexState.mergeRoot(snapshot, "/media", {
    ok: true,
    files: [file("/media/a.mp4"), file("/media/b.mp4")],
    markerSlot: 0,
    markerToken: "overlap-1:100-a1b2",
  }, { now: 100 });
  snapshot = first.snapshot;
  assert.equal(first.changed, true);
  assert.deepEqual(first.diff, {
    added: ["/media/a.mp4", "/media/b.mp4"],
    removed: [],
    updated: [],
  });
  assert.equal(snapshot.roots["/media"].markerToken, "overlap-1:100-a1b2");

  const second = indexState.mergeRoot(snapshot, "/media", {
    ok: true,
    files: [file("/media/a.mp4"), file("/media/c.mkv", { ext: "mkv" })],
  }, { now: 200 });
  assert.equal(second.snapshot.roots["/media"].files[0].firstSeenAt, 100);
  assert.equal(second.snapshot.roots["/media"].files[1].firstSeenAt, 200);
  assert.deepEqual(second.diff, {
    added: ["/media/c.mkv"],
    removed: ["/media/b.mp4"],
    updated: [],
  });
  assert.deepEqual(indexState.getExtensions(second.snapshot), ["mkv", "mp4"]);
  assert.equal(second.snapshot.roots["/media"].markerToken, "overlap-1:100-a1b2");
});

test("an identical successful scan updates freshness without changing indexed content", () => {
  const initial = indexState.mergeRoot(indexState.createSnapshot(), "/media", [
    file("/media/a.mp4", { size: 10 }),
  ], { now: 100 }).snapshot;
  initial.roots["/media"].markerSlot = 0;
  initial.roots["/media"].markerToken = "overlap-1:100-abcd";
  const result = indexState.mergeRoot(initial, "/media", [
    file("/media/a.mp4", { size: 10 }),
  ], { now: 200 });

  assert.equal(result.changed, false);
  assert.equal(result.filesChanged, false);
  assert.equal(result.snapshot.roots["/media"].lastSuccessfulAt, 200);
  assert.equal(result.snapshot.roots["/media"].files[0].firstSeenAt, 100);
  assert.equal(result.snapshot.roots["/media"].markerSlot, 0);
  assert.equal(result.snapshot.roots["/media"].markerToken, "overlap-1:100-abcd");
});

test("a migration baseline remains excluded from recently-added timestamps", () => {
  const snapshot = {
    version: indexState.SCHEMA_VERSION,
    configKey: "",
    roots: {
      "/media": {
        path: "/media",
        status: "stale",
        files: [file("/media/existing.mp4", { firstSeenAt: null })],
      },
    },
  };
  const result = indexState.mergeRoot(snapshot, "/media", [
    file("/media/existing.mp4"),
    file("/media/new.mp4"),
  ], { now: 200 });

  const records = new Map(indexState.getFiles(result.snapshot).map((entry) => [entry.path, entry]));
  assert.equal(records.get("/media/existing.mp4").firstSeenAt, null);
  assert.equal(records.get("/media/new.mp4").firstSeenAt, 200);
});

test("metadata changes are distinguished from additions and removals", () => {
  const initial = indexState.mergeRoot(indexState.createSnapshot(), "/media", [
    file("/media/a.mp4", { size: 10 }),
  ], { now: 100 }).snapshot;
  const result = indexState.mergeRoot(initial, "/media", [
    file("/media/a.mp4", { size: 20 }),
  ], { now: 200 });

  assert.deepEqual(result.diff.updated, ["/media/a.mp4"]);
  assert.deepEqual(result.diff.added, []);
  assert.deepEqual(result.diff.removed, []);
});

test("a later scan preserves lazily discovered media metadata", () => {
  const initial = indexState.mergeRoot(indexState.createSnapshot(), "/media", [
    file("/media/a.mp4", { duration: 125, width: 1920, height: 1080 }),
  ], { now: 100 }).snapshot;
  const result = indexState.mergeRoot(initial, "/media", [
    file("/media/a.mp4"),
  ], { now: 200 });

  assert.deepEqual(
    Object.fromEntries(["duration", "width", "height"].map((field) => [
      field,
      result.snapshot.roots["/media"].files[0][field],
    ])),
    { duration: 125, width: 1920, height: 1080 },
  );
  assert.deepEqual(result.diff.updated, []);
});

test("failed reconciliation retains the last useful root snapshot", () => {
  const initial = indexState.mergeRoot(indexState.createSnapshot(), "/media", [
    file("/media/a.mp4"),
  ], { now: 100 }).snapshot;
  const result = indexState.mergeRoot(initial, "/media", {
    ok: false,
    errorCode: "Permission denied at /media/private",
  }, { now: 200 });

  assert.equal(result.filesChanged, false);
  assert.equal(result.statusChanged, true);
  assert.equal(result.snapshot.roots["/media"].status, "unavailable");
  assert.equal(result.snapshot.roots["/media"].errorCode, "scan-failed");
  assert.deepEqual(indexState.getFiles(result.snapshot).map((entry) => entry.path), ["/media/a.mp4"]);
});

test("root removal, staleness, overlap deduplication, and config compatibility are deterministic", () => {
  let snapshot = indexState.createSnapshot("depth=4");
  snapshot = indexState.mergeRoot(snapshot, "/media", [file("/media/shows/a.mp4")], { now: 1 }).snapshot;
  snapshot = indexState.mergeRoot(snapshot, "/media/shows", [
    file("/media/shows/a.mp4", { rootPath: "/media/shows", seriesTitle: "A" }),
  ], { now: 2 }).snapshot;

  assert.equal(indexState.getFiles(snapshot).length, 1);
  assert.equal(indexState.getFiles(snapshot)[0].rootPath, "/media/shows");
  assert.equal(indexState.isCompatible(snapshot, "depth=4"), true);
  assert.equal(indexState.isCompatible(snapshot, "depth=3"), false);

  snapshot = indexState.markRootStale(snapshot, "/media/shows");
  assert.equal(snapshot.roots["/media/shows"].status, "stale");
  snapshot = indexState.removeRoot(snapshot, "/media/shows");
  assert.equal(Object.hasOwn(snapshot.roots, "/media/shows"), false);
});
