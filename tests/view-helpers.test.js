const test = require("node:test");
const assert = require("node:assert/strict");
const view = require("../quick-folders.iinaplugin/ui/view-helpers.js");

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
  assert.equal(view.truncateMiddle("abcdefghijklmnopqrstuvwxyz1234567890").length <= 30, true);
});

test("chooses empty-state copy from the active view constraint", () => {
  assert.equal(view.getEmptyMessage({ state: { items: [], atRoot: true } }), "No folders added yet");
  assert.equal(view.getEmptyMessage({ state: { items: [], viewingWatched: true } }), "No watched items");
  assert.equal(view.getEmptyMessage({ state: { items: [{}] }, query: "x" }), "No results match your search");
  assert.equal(view.getEmptyMessage({ state: { items: [{}] }, filter: "ext:mp4" }), "No files match this filter");
});
