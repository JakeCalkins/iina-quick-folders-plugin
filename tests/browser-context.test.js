const test = require("node:test");
const assert = require("node:assert/strict");
const BrowserContext = require("../ui/browser-context.js");

const options = {
  roots: [{ path: "/media" }, { path: "/archive" }],
  availableExtensions: ["mp4", "mkv"],
};

test("reconciles persisted context against current roots and known values", () => {
  const context = BrowserContext.reconcile({
    version: 99,
    location: { kind: "folder", path: "/media/Shows" },
    query: "is:progress",
    filter: "ext:MP4",
    layout: "grid",
    scrollAnchor: { path: "/media/Shows/Example.mp4", offset: 18 },
    focusedPath: "/media/Shows/Example.mp4",
    recentLocations: [
      { kind: "folder", path: "/media/Shows" },
      { kind: "folder", path: "/media/Shows" },
      { kind: "smart", viewId: "recently-added" },
      { kind: "folder", path: "/outside/Private" },
    ],
    selectedPaths: ["/media/Shows/Example.mp4"],
  }, options);

  assert.deepEqual(context, {
    version: BrowserContext.VERSION,
    location: { kind: "folder", path: "/media/Shows" },
    query: "is:progress",
    filter: "ext:mp4",
    layout: "grid",
    focusedPath: "/media/Shows/Example.mp4",
    scrollAnchor: { path: "/media/Shows/Example.mp4", offset: 18 },
    recentLocations: [
      { kind: "folder", path: "/media/Shows" },
      { kind: "smart", viewId: "recent" },
    ],
  });
  assert.equal(Object.hasOwn(context, "selectedPaths"), false);
});

test("falls back safely when a location, filter, layout, or anchor is stale", () => {
  const context = BrowserContext.reconcile({
    location: { kind: "folder", path: "/media-lookalike/Shows" },
    filter: "ext:avi",
    layout: "covers",
    scrollAnchor: { path: "/outside/Example.mp4", offset: 9 },
    recentLocations: [{ kind: "smart", viewId: "unknown" }],
  }, options);
  assert.deepEqual(context, BrowserContext.createDefault());
});

test("persists available media-type filters and rejects unavailable ones", () => {
  assert.equal(BrowserContext.reconcile({ filter: "video" }, {
    availableMediaTypes: ["video"],
  }).filter, "video");
  assert.equal(BrowserContext.reconcile({ filter: "audio" }, {
    availableMediaTypes: ["video"],
  }).filter, "all");
});

test("bounds and deduplicates recent locations with the newest first", () => {
  let context = BrowserContext.createDefault();
  context = BrowserContext.addRecentLocation(context, { kind: "folder", path: "/media/A" }, {
    ...options,
    maxRecents: 2,
  });
  context = BrowserContext.addRecentLocation(context, { kind: "smart", viewId: "watched" }, {
    ...options,
    maxRecents: 2,
  });
  context = BrowserContext.addRecentLocation(context, { kind: "folder", path: "/media/A" }, {
    ...options,
    maxRecents: 2,
  });
  assert.deepEqual(context.recentLocations, [
    { kind: "folder", path: "/media/A" },
    { kind: "smart", viewId: "watched" },
  ]);
});

test("serialization is deterministic, private-field-free, and tolerant of bad input", () => {
  const serialized = BrowserContext.serialize({
    location: { kind: "smart", viewId: "continue-watching" },
    query: "summer",
    selection: ["/media/Secret.mp4"],
  }, options);
  assert.deepEqual(BrowserContext.deserialize(serialized, options), {
    ...BrowserContext.createDefault(),
    location: { kind: "smart", viewId: "continue" },
    query: "summer",
  });
  assert.equal(serialized.includes("selection"), false);
  assert.deepEqual(BrowserContext.deserialize("{bad", options), BrowserContext.createDefault());
});

test("accepts and emits the backend's compact persistence payload", () => {
  const context = BrowserContext.reconcile({
    view: "recently-added",
    query: "new",
    filter: "all",
    layout: "grid",
    scrollAnchor: "/media/New.mp4",
    scrollOffset: -12,
    focusedPath: null,
    recents: [
      { path: "/media/Shows" },
      { view: "continue-watching" },
    ],
  }, options);
  assert.deepEqual(context.location, { kind: "smart", viewId: "recent" });
  assert.deepEqual(context.scrollAnchor, { path: "/media/New.mp4", offset: -12 });
  assert.deepEqual(BrowserContext.toPersistence(context, options), {
    version: BrowserContext.VERSION,
    view: "recent",
    path: null,
    query: "new",
    filter: "all",
    layout: "grid",
    focusedPath: null,
    scrollAnchor: "/media/New.mp4",
    scrollOffset: -12,
    recents: [
      { view: null, path: "/media/Shows" },
      { view: "continue", path: null },
    ],
  });
});

test("query and anchor offsets are bounded", () => {
  const context = BrowserContext.reconcile({
    query: "abcdefgh",
    scrollAnchor: { path: "/media/a.mp4", offset: 50000 },
  }, { ...options, maxQueryLength: 4 });
  assert.equal(context.query, "abcd");
  assert.equal(context.scrollAnchor.offset, 10000);
});
