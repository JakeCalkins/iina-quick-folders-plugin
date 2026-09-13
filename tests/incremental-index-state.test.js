const test = require("node:test");
const assert = require("node:assert/strict");
const { readFileSync } = require("node:fs");
const { resolve } = require("node:path");
const vm = require("node:vm");

const incrementalIndex = require("../incremental-index-state.js");

function file(path, overrides = {}) {
  return {
    name: path.split("/").pop(),
    path,
    parentPath: path.substring(0, path.lastIndexOf("/")) || "/",
    rootPath: "/media",
    type: "video",
    ...overrides,
  };
}

function entry(name, isDir, overrides = {}) {
  return { name, isDir, ...overrides };
}

function createPlayableRecord(current, context) {
  if (!/\.(?:mkv|mp4)$/i.test(context.name)) return null;
  const record = {
    ...(context.previousRecord || {}),
    type: "video",
  };
  if (current.size != null) record.observedSize = current.size;
  return record;
}

test("reconciles direct files and missing child subtrees while preserving unaffected subtrees", () => {
  const kept = file("/media/keep/episode.mp4", { duration: 120 });
  const result = incrementalIndex.reconcileDirectories({
    files: [
      file("/media/old.mp4", { firstSeenAt: 10 }),
      kept,
      file("/media/gone/episode.mp4"),
    ],
    rootPath: "/media",
    changedDirectories: [{
      path: "/media",
      entries: [
        entry("old.mp4", false, { size: 20 }),
        entry("new.mkv", false, { size: 30 }),
        entry("notes.txt", false),
        entry("keep", true),
      ],
    }],
    createRecord: createPlayableRecord,
  });

  assert.deepEqual(result, [
    kept,
    file("/media/new.mkv", { observedSize: 30 }),
    file("/media/old.mp4", { firstSeenAt: 10, observedSize: 20 }),
  ]);
  assert.equal(result[0], kept, "records below an unchanged child directory retain identity");
});

test("applies nested snapshots independently of input order", () => {
  const outsideChangedTree = file("/media/Movies/feature.mp4");
  const result = incrementalIndex.reconcileDirectories({
    files: [
      outsideChangedTree,
      file("/media/Shows/Season 1/episode-1.mp4", { duration: 100 }),
      file("/media/Shows/Season 2/episode-2.mp4"),
    ],
    rootPath: "/media",
    changedDirectories: [
      {
        path: "/media/Shows/Season 1",
        entries: [entry("episode-1.mp4", false, { size: 11 }), entry("episode-3.mkv", false)],
      },
      { path: "/media", entries: [entry("Movies", true), entry("Shows", true)] },
      { path: "/media/Shows", entries: [entry("Season 1", true)] },
    ],
    createRecord: createPlayableRecord,
  });

  assert.deepEqual(result, [
    outsideChangedTree,
    file("/media/Shows/Season 1/episode-1.mp4", { duration: 100, observedSize: 11 }),
    file("/media/Shows/Season 1/episode-3.mkv"),
  ]);
  assert.equal(result[0], outsideChangedTree);
});

test("does not resurrect a descendant excluded by an authoritative ancestor", () => {
  const result = incrementalIndex.reconcileDirectories({
    files: [file("/media/Removed/old.mp4")],
    rootPath: "/media",
    changedDirectories: [
      { path: "/media/Removed", entries: [entry("new.mp4", false)] },
      { path: "/media", entries: [] },
    ],
    createRecord: createPlayableRecord,
  });

  assert.deepEqual(result, []);
});

test("ignores malformed snapshots and derives identity without trusting entry paths", () => {
  const original = file("/media/library.mp4");
  let factoryCalls = 0;
  const result = incrementalIndex.reconcileDirectories({
    files: [original, file("/media-other/private.mp4"), file("/media/../private.mp4")],
    rootPath: "/media",
    changedDirectories: [
      { path: "/media-other", entries: [] },
      { path: "/media/../private", entries: [] },
      { path: "/media", entries: null },
      {
        path: "/media",
        entries: [
          entry("../private.mp4", false),
          entry("spoof.mp4", false, { path: "/media-other/spoof.mp4" }),
          { name: "unknown.mp4" },
          entry("library.mp4", false),
        ],
      },
    ],
    createRecord(current, context) {
      factoryCalls++;
      return createPlayableRecord(current, context);
    },
  });

  assert.deepEqual(result, [
    original,
    file("/media/spoof.mp4"),
  ]);
  assert.equal(factoryCalls, 2);
});

test("accepts IINA directory-relative entry paths", () => {
  const result = incrementalIndex.reconcileDirectories({
    files: [],
    rootPath: "/media",
    changedDirectories: [{
      path: "/media",
      entries: [entry("movie.mp4", false, { path: "/movie.mp4" })],
    }],
    createRecord: createPlayableRecord,
  });

  assert.deepEqual(result, [file("/media/movie.mp4")]);
});

test("supports the filesystem root and canonicalizes factory-owned identity fields", () => {
  const result = incrementalIndex.reconcileDirectories({
    files: [],
    rootPath: "/",
    changedDirectories: [{
      path: "/",
      entries: [entry("movie.mp4", false)],
    }],
    createRecord() {
      return {
        name: "spoofed",
        path: "/outside.mp4",
        parentPath: "/outside",
        rootPath: "/outside",
        type: "video",
      };
    },
  });

  assert.deepEqual(result, [{
    name: "movie.mp4",
    path: "/movie.mp4",
    parentPath: "/",
    rootPath: "/",
    type: "video",
  }]);
  assert.equal(incrementalIndex.isPathWithinRoot("/movie.mp4", "/"), true);
  assert.equal(incrementalIndex.isPathWithinRoot("/media-other/movie.mp4", "/media"), false);
});

test("uses a generic record factory when the caller does not provide one", () => {
  const result = incrementalIndex.reconcileDirectories({
    files: [],
    rootPath: "/media",
    changedDirectories: [{
      path: "/media",
      entries: [{ filename: "audio.flac", is_dir: false, type: "audio", ext: "flac" }],
    }],
  });

  assert.deepEqual(result, [{
    filename: "audio.flac",
    is_dir: false,
    type: "audio",
    ext: "flac",
    name: "audio.flac",
    path: "/media/audio.flac",
    parentPath: "/media",
    rootPath: "/media",
  }]);
});

test("exports through IINA's empty CommonJS wrapper", () => {
  const path = resolve(__dirname, "..", "incremental-index-state.js");
  const source = readFileSync(path, "utf8");
  const exported = vm.runInNewContext(
    `(function () { const module = {}; ${source}\nreturn module.exports; })()`,
    {},
    { filename: path },
  );

  assert.equal(typeof exported.reconcileDirectories, "function");
});
