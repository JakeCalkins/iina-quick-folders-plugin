const test = require("node:test");
const assert = require("node:assert/strict");
const Search = require("../quick-folders.iinaplugin/ui/search.js");
const BrowseModel = require("../quick-folders.iinaplugin/ui/browse-model.js");

test("combines matching root folders with ranked indexed file results", () => {
  const model = BrowseModel.create({ maxSearchResults: 1 });
  model.updateIndex([
    { name: "Exact.mp4", path: "/media/Exact.mp4", watched: false },
    { name: "Exact extended.mp4", path: "/media/Exact extended.mp4", watched: false },
  ], 1);
  const result = model.getItems({
    state: { atRoot: true, items: [{ name: "Exact folder", path: "/media", isDir: true }] },
    query: "exact",
    compiledQuery: Search.compileQuery("exact"),
    filter: "ext:mp4",
    preferences: {},
  });
  assert.equal(result.totalIndexedMatches, 2);
  assert.equal(result.items.length, 2);
  assert.equal(result.items[0].isDir, true);
  assert.equal(result.items[1].fromSearch, true);
});

test("applies watched visibility and file filters to current folder items", () => {
  const model = BrowseModel.create();
  const result = model.getItems({
    state: {
      atRoot: false,
      viewingWatched: false,
      items: [
        { name: "Folder", path: "/media/Folder", isDir: true },
        { name: "Movie.mp4", path: "/media/Movie.mp4", isDir: false, watched: true },
        { name: "Other.mkv", path: "/media/Other.mkv", isDir: false, watched: false },
      ],
    },
    query: "",
    compiledQuery: Search.compileQuery(""),
    filter: "ext:mp4",
    preferences: { hideWatched: true },
  });
  assert.deepEqual(result.items.map((item) => item.name), ["Folder"]);
});
