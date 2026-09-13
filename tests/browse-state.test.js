const test = require("node:test");
const assert = require("node:assert/strict");
const browseState = require("../browse-state.js");

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
  assert.equal(browseState.isPathWithinRoots("media/library/movie.mp4", roots), false);
  assert.equal(browseState.isPathWithinRoots("/media/library/movie.mp4", [{ path: "media/library" }]), false);
  assert.equal(browseState.isPathWithinRoots("/media/library/movie.mp4", [{ path: "/media/../library" }]), false);
});

test("builds bounded ancestor locations for Finder-style columns", () => {
  assert.deepEqual(
    browseState.getAncestorLocations("/media/shows/season-1", "/media"),
    ["/media", "/media/shows"],
  );
  assert.deepEqual(browseState.getAncestorLocations("/media", "/media"), []);
  assert.deepEqual(browseState.getAncestorLocations("/media-copy/show", "/media"), []);
  assert.deepEqual(browseState.getAncestorLocations("/media/../private", "/media"), []);
  assert.deepEqual(browseState.getAncestorLocations("/media/shows", "/"), ["/", "/media"]);
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

test("groups visible extensions without dropping video when audio is filtered", () => {
  assert.deepEqual(browseState.groupAvailableExtensions(
    ["MP4", ".mkv", "mp3", "jpg", "mp4", "txt"],
    { filterAudio: true, filterImages: false, videoOnly: false }
  ), {
    video: ["mp4", "mkv"],
    audio: [],
    image: ["jpg"],
  });
});

test("video-only extension groups contain video and exclude audio and images", () => {
  assert.deepEqual(browseState.groupAvailableExtensions(
    ["mp4", "mp3", "png"],
    { filterAudio: false, filterImages: false, videoOnly: true }
  ), { video: ["mp4"], audio: [], image: [] });
});

test("keeps an available filter across option rebuilds and resets stale filters", () => {
  const groups = { video: ["mp4", "mkv"], audio: ["mp3"], image: [] };
  assert.equal(browseState.reconcileExtensionFilter("ext:mp4", groups), "ext:mp4");
  assert.equal(browseState.reconcileExtensionFilter("ext:mov", groups), "all");
  assert.equal(browseState.reconcileExtensionFilter("all", groups), "all");
});

test("file filters preserve folder navigation and match extensions case-insensitively", () => {
  const classify = (extension) => extension === "mp3" ? "audio" : "video";
  assert.equal(browseState.matchesFileFilter({ name: "Subfolder", isDir: true }, "ext:mp4", classify), true);
  assert.equal(browseState.matchesFileFilter({ name: "Movie.MP4", isDir: false }, "ext:mp4", classify), true);
  assert.equal(browseState.matchesFileFilter({ name: "Movie.mkv", isDir: false }, "ext:mp4", classify), false);
  assert.equal(browseState.matchesFileFilter({ name: "Concert.mp3", isDir: false }, "audio", classify), true);
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
