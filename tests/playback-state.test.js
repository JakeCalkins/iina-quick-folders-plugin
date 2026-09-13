const test = require("node:test");
const assert = require("node:assert/strict");

const playback = require("../playback-state.js");

test("normalizes persisted playback records and rejects unsafe paths", () => {
  const snapshot = playback.normalizeSnapshot({
    version: 99,
    records: {
      "/media/episode.mp4": {
        position: 150,
        duration: 100,
        lastPlayedAt: "200",
        manualState: "invalid",
        privateNote: "do not retain",
      },
      "/media/../private.mp4": { position: 5 },
      "relative.mp4": { position: 5 },
    },
  });

  assert.deepEqual(snapshot, {
    version: playback.SCHEMA_VERSION,
    records: {
      "/media/episode.mp4": {
        position: 100,
        duration: 100,
        lastPlayedAt: 200,
        manualState: null,
      },
    },
  });
});

test("migrates legacy watched paths into durable manual overrides", () => {
  const snapshot = playback.migrateSnapshot(
    { records: { "/media/progress.mp4": { position: 20, duration: 100 } } },
    { watchedPaths: ["/media/watched.mp4", "/media/watched.mp4", "/media/../no.mp4"], now: 500 },
  );

  assert.equal(snapshot.records["/media/watched.mp4"].manualState, "watched");
  assert.equal(snapshot.records["/media/watched.mp4"].lastPlayedAt, 500);
  assert.equal(snapshot.records["/media/progress.mp4"].position, 20);
  assert.equal(Object.hasOwn(snapshot.records, "/media/../no.mp4"), false);
});

test("manual watched and unwatched choices override automatic completion", () => {
  const nearlyFinished = { position: 95, duration: 100 };
  assert.equal(playback.classifyRecord(nearlyFinished), "watched");
  assert.equal(
    playback.classifyRecord(playback.setManualState(nearlyFinished, "unwatched")),
    "in-progress",
  );
  assert.equal(
    playback.classifyRecord(playback.setManualState({ position: 0, duration: 100 }, "watched")),
    "watched",
  );
  assert.equal(playback.classifyRecord({ position: 40, duration: 100 }), "in-progress");
  assert.equal(playback.classifyRecord({ position: 0, duration: 100 }), "new");
  assert.equal(
    playback.classifyRecord({ position: 75, duration: 100 }, { completionThreshold: 0.75 }),
    "watched",
  );
});

test("resume position is independent of manual completion state and respects native resume", () => {
  const explicitlyWatched = { position: 40, duration: 100, manualState: "watched" };
  assert.equal(playback.getResumePosition(explicitlyWatched, { currentPosition: 0 }), 40);
  assert.equal(playback.getResumePosition(explicitlyWatched, { currentPosition: 20 }), null);
  assert.equal(playback.getResumePosition({ position: 2, duration: 100 }), null);
  assert.equal(playback.getResumePosition({ position: 95, duration: 100 }), null);
  assert.equal(playback.getResumePosition({
    position: 95,
    duration: 100,
    manualState: "unwatched",
  }), 95);
  assert.equal(playback.getResumePosition({ position: 100, duration: 100 }), null);
});

test("material duration changes discard stale automatic position but preserve manual state", () => {
  const previous = {
    position: 900,
    duration: 1000,
    lastPlayedAt: 100,
    manualState: "unwatched",
  };
  const changed = playback.updateRecord(previous, { duration: 1400, lastPlayedAt: 200 });
  assert.deepEqual(changed, {
    position: 0,
    duration: 1400,
    lastPlayedAt: 200,
    manualState: "unwatched",
  });

  const closeEnough = playback.updateRecord(previous, { duration: 1050 });
  assert.equal(closeEnough.position, 900);
  assert.equal(playback.hasMaterialDurationChange(1000, 1050), false);
  assert.equal(playback.hasMaterialDurationChange(1000, 1400), true);
});

test("continue watching is recent-first, deterministic, and bounded", () => {
  let snapshot = playback.normalizeSnapshot();
  snapshot = playback.updateProgress(snapshot, "/media/older.mp4", {
    position: 20, duration: 100, lastPlayedAt: 100,
  });
  snapshot = playback.updateProgress(snapshot, "/media/newer.mp4", {
    position: 30, duration: 100, lastPlayedAt: 300,
  });
  snapshot = playback.updateProgress(snapshot, "/media/finished.mp4", {
    position: 95, duration: 100, lastPlayedAt: 400,
  });
  snapshot = playback.updateProgress(snapshot, "/media/tie.mp4", {
    position: 10, duration: 100, lastPlayedAt: 300,
  });

  assert.deepEqual(
    playback.getContinueWatching(snapshot, { limit: 2 }).map((entry) => entry.path),
    ["/media/newer.mp4", "/media/tie.mp4"],
  );
  assert.equal(playback.getContinueWatching(snapshot)[0].progressRatio, 0.3);
});

test("pruning bounds automatic history while retaining manual records", () => {
  const snapshot = {
    records: {
      "/media/manual-old.mp4": { manualState: "watched", lastPlayedAt: 1 },
      "/media/automatic-old.mp4": { position: 10, duration: 100, lastPlayedAt: 2 },
      "/media/automatic-new.mp4": { position: 20, duration: 100, lastPlayedAt: 3 },
      "/media/missing.mp4": { manualState: "watched", lastPlayedAt: 4 },
    },
  };
  const pruned = playback.pruneSnapshot(snapshot, {
    maxAutomaticRecords: 1,
    isValidPath(path) { return path !== "/media/missing.mp4"; },
  });

  assert.deepEqual(Object.keys(pruned.records), [
    "/media/manual-old.mp4",
    "/media/automatic-new.mp4",
  ]);
  assert.deepEqual(playback.getWatchedPaths(pruned), ["/media/manual-old.mp4"]);
});
