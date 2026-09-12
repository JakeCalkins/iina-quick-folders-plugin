const test = require("node:test");
const assert = require("node:assert/strict");
const view = require("../ui/view-helpers.js");

test("formats file names, sizes, and paths for display", () => {
  assert.equal(view.getDisplayName({ name: "Movie.Final.mp4", isDir: false }), "Movie.Final");
  assert.equal(view.getDisplayName({ name: "Movies", isDir: true }), "Movies");
  assert.equal(view.formatFileSize(12 * 1024 * 1024), "12.0 MB");
  assert.equal(view.formatFileSize(-1), "");
  assert.equal(view.getContainingFolder("/Users/example/Media/Movies/clip.mp4"), "Media/Movies");
});

test("builds breadcrumb labels with stable navigation paths", () => {
  assert.deepEqual(view.getBreadcrumbSegments("/Users/example/Desktop/intake/docs"), [
    { label: "Desktop", path: "/Users/example/Desktop" },
    { label: "intake", path: "/Users/example/Desktop/intake" },
    { label: "docs", path: "/Users/example/Desktop/intake/docs" },
  ]);
  assert.deepEqual(view.getBreadcrumbSegments(
    "/Users/example/Desktop/intake/docs/reference/api",
    "/Users/example/Desktop/intake/docs",
  ), [
    { label: "docs", path: "/Users/example/Desktop/intake/docs" },
    { label: "reference", path: "/Users/example/Desktop/intake/docs/reference" },
    { label: "api", path: "/Users/example/Desktop/intake/docs/reference/api" },
  ]);
  assert.equal(view.truncateMiddle("abcdefghijklmnopqrstuvwxyz1234567890").length <= 30, true);

  const deep = view.getBreadcrumbSegments("/media/library/series/season/episode", "/media");
  assert.deepEqual(view.partitionBreadcrumbSegments(deep), {
    hidden: [
      { label: "media", path: "/media" },
      { label: "library", path: "/media/library" },
      { label: "series", path: "/media/library/series" },
    ],
    visible: [
      { label: "season", path: "/media/library/series/season" },
      { label: "episode", path: "/media/library/series/season/episode" },
    ],
  });
  assert.deepEqual(view.partitionBreadcrumbSegments(deep.slice(0, 3)), {
    hidden: [],
    visible: deep.slice(0, 3),
  });
});

test("chooses empty-state copy from the active view constraint", () => {
  assert.equal(view.getEmptyMessage({ state: { items: [], atRoot: true } }), "No folders added yet");
  assert.equal(view.getEmptyMessage({ state: { items: [], viewingWatched: true } }), "No watched items");
  assert.equal(view.getEmptyMessage({ state: { items: [{}] }, query: "x" }), "No results match your search");
  assert.equal(view.getEmptyMessage({ state: { items: [{}] }, filter: "ext:mp4" }), "No files match this filter");
});
