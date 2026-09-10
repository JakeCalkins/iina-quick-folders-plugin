const test = require("node:test");
const assert = require("node:assert/strict");
const browseState = require("../quick-folders.iinaplugin/browse-state.js");

test("normalizes watched paths to unique non-empty strings", () => {
  assert.deepEqual(
    browseState.normalizePaths(["/media/a.mp4", "", null, "/media/a.mp4", "/media/b.mkv"]),
    ["/media/a.mp4", "/media/b.mkv"]
  );
  assert.deepEqual(browseState.normalizePaths(null), []);
});

test("accepts only paths contained by configured roots", () => {
  const roots = [{ path: "/media/library/" }, { path: "/Volumes/Shows" }];
  assert.equal(browseState.isPathWithinRoots("/media/library/movie.mp4", roots), true);
  assert.equal(browseState.isPathWithinRoots("/Volumes/Shows", roots), true);
  assert.equal(browseState.isPathWithinRoots("/media/library-copy/movie.mp4", roots), false);
  assert.equal(browseState.isPathWithinRoots("/media/library/../private/movie.mp4", roots), false);
  assert.equal(browseState.isPathWithinRoots("/media/library/\0movie.mp4", roots), false);
});

test("partitions watched files after active files and directories", () => {
  const folder = { path: "/media/folder", isDir: true };
  const active = { path: "/media/a.mp4", isDir: false, watched: false };
  const watched = { path: "/media/b.mp4", isDir: false, watched: true };
  assert.deepEqual(browseState.partitionWatched([watched, folder, active]), {
    active: [folder, active],
    watched: [watched],
  });
});

test("single selection replaces the previous selection", () => {
  assert.deepEqual(browseState.updateSelection({
    visiblePaths: ["a", "b", "c"],
    selectedPaths: ["a"],
    anchorPath: "a",
    targetPath: "c",
  }), { selectedPaths: ["c"], anchorPath: "c" });
});

test("Cmd/Ctrl selection toggles individual paths", () => {
  const added = browseState.updateSelection({
    visiblePaths: ["a", "b", "c"],
    selectedPaths: ["a"],
    anchorPath: "a",
    targetPath: "c",
    additive: true,
  });
  assert.deepEqual(added, { selectedPaths: ["a", "c"], anchorPath: "c" });

  const removed = browseState.updateSelection({
    visiblePaths: ["a", "b", "c"],
    selectedPaths: added.selectedPaths,
    anchorPath: added.anchorPath,
    targetPath: "a",
    additive: true,
  });
  assert.deepEqual(removed, { selectedPaths: ["c"], anchorPath: "a" });
});

test("Shift selection includes the complete anchor range", () => {
  const selected = browseState.updateSelection({
    visiblePaths: ["a", "b", "c", "d"],
    selectedPaths: ["b"],
    anchorPath: "b",
    targetPath: "d",
    range: true,
  });
  assert.deepEqual(selected, { selectedPaths: ["b", "c", "d"], anchorPath: "b" });
});

test("Cmd/Ctrl+Shift adds an anchor range to the existing selection", () => {
  const selected = browseState.updateSelection({
    visiblePaths: ["a", "b", "c", "d"],
    selectedPaths: ["a", "c"],
    anchorPath: "c",
    targetPath: "d",
    range: true,
    additive: true,
  });
  assert.deepEqual(selected, { selectedPaths: ["a", "c", "d"], anchorPath: "c" });
});
