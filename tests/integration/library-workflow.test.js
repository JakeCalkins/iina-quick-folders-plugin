const test = require("node:test");
const assert = require("node:assert/strict");

const BrowseModel = require("../../ui/browse-model.js");
const BrowseState = require("../../browse-state.js");
const BrowserContext = require("../../ui/browser-context.js");
const IndexState = require("../../index-state.js");
const PlaybackState = require("../../playback-state.js");
const QueuePlayback = require("../../queue-playback.js");
const QueueState = require("../../queue-state.js");
const Search = require("../../ui/search.js");
const SeriesState = require("../../series-state.js");

function media(path, fields = {}) {
  const name = path.substring(path.lastIndexOf("/") + 1);
  const ext = name.substring(name.lastIndexOf(".") + 1).toLowerCase();
  const parentPath = path.substring(0, path.lastIndexOf("/")) || "/";
  return { name, path, parentPath, rootPath: "/media", type: "video", ext, ...fields };
}

test("indexed media flows through playback, structured search, selection, queue, and context", () => {
  const scan = IndexState.mergeRoot(IndexState.createSnapshot("/media:3"), "/media", {
    ok: true,
    files: [
      media("/media/Shows/Example S01E01.mkv", { parentPath: "/media/Shows", duration: 1_800 }),
      media("/media/Shows/Example S01E02.mkv", { parentPath: "/media/Shows", duration: 1_900 }),
      media("/media/Movie.mp4", { duration: 7_200 }),
      media("/outside/escape.mp4"),
    ],
  }, { now: 1_000 });
  const indexed = IndexState.getFiles(scan.snapshot);
  assert.deepEqual(indexed.map((item) => item.path), [
    "/media/Movie.mp4",
    "/media/Shows/Example S01E01.mkv",
    "/media/Shows/Example S01E02.mkv",
  ]);

  let playback = PlaybackState.updateProgress({}, "/media/Shows/Example S01E01.mkv", {
    position: 600,
    duration: 1_800,
    lastPlayedAt: 2_000,
  });
  playback = PlaybackState.updateManualState(playback, ["/media/Movie.mp4"], "watched");
  const decorated = indexed.map((item) => {
    const playbackState = PlaybackState.classifyRecord(playback.records[item.path]);
    return { ...item, playbackState, watched: playbackState === "watched" };
  });

  const model = BrowseModel.create();
  assert.equal(model.updateIndex(decorated, 1), true);
  const query = "is:progress duration:<40m";
  const result = model.getItems({
    state: { atRoot: true, items: [{ name: "Shows", path: "/media/Shows", isDir: true }] },
    query,
    compiledQuery: Search.compileQuery(query),
    filter: "video",
    preferences: { hideWatched: false },
  });
  assert.deepEqual(result.items.map((item) => item.path), [
    "/media/Shows",
    "/media/Shows/Example S01E01.mkv",
  ]);
  const matchingFile = result.items.find((item) => !item.isDir);

  const selection = BrowseState.updateSelection({
    visiblePaths: result.items.filter((item) => !item.isDir).map((item) => item.path),
    selectedPaths: [],
    anchorPath: null,
    targetPath: matchingFile.path,
  });
  assert.deepEqual(QueueState.addPaths([], selection.selectedPaths), [
    "/media/Shows/Example S01E01.mkv",
  ]);

  const contextOptions = {
    roots: ["/media"],
    availableFilters: ["all", "video"],
    layouts: ["list", "grid"],
    smartViews: ["continue", "watched"],
  };
  const persisted = BrowserContext.toPersistence({
    ...BrowserContext.createDefault(),
    location: { kind: "folder", path: "/media/Shows" },
    query,
    filter: "video",
    focusedPath: matchingFile.path,
  }, contextOptions);
  const restored = BrowserContext.deserialize(JSON.stringify(persisted), contextOptions);
  assert.deepEqual(restored.location, {
    kind: "folder",
    path: "/media/Shows",
  });
  assert.equal(restored.query, query);
  assert.equal(restored.filter, "video");
  assert.equal(restored.focusedPath, matchingFile.path);
  assert.equal(PlaybackState.getResumePosition(playback.records[matchingFile.path], { currentPosition: 0 }), 600);
});

test("episode discovery and playback state choose the first unfinished queue item", () => {
  const episodes = [1, 2, 3].map((number) => SeriesState.enrichEpisode(
    media(`/media/Shows/Example S01E0${number}.mkv`, { parentPath: "/media/Shows" }),
    { rootPath: "/media" },
  ));
  const states = new Map([
    [episodes[0].path, "watched"],
    [episodes[1].path, "in-progress"],
    [episodes[2].path, "new"],
  ]);
  const recommendation = SeriesState.recommendNextEpisode(episodes, {
    getPlaybackState: (item) => states.get(item.path),
  });
  const queue = QueueState.addPaths([], [recommendation.path, episodes[2].path, recommendation.path]);
  assert.deepEqual(queue, [episodes[1].path, episodes[2].path]);
});

test("edited queue order becomes an isolated native playlist", async () => {
  const first = "/media/One #1.mkv";
  const second = "/media/Two.mkv";
  const queue = QueueState.movePaths(
    QueueState.addPaths([], [second, first]),
    [first],
    second,
    "before",
  );
  const opened = [];
  const played = [];
  let native = [];
  const playlist = {
    list: () => native.map((filename) => ({ filename })),
    add(url) { native.push(decodeURIComponent(url.slice("file://".length))); },
    remove(index) { native.splice(index, 1); },
    move(from, to) { native.splice(to, 0, native.splice(from, 1)[0]); },
    play(index) { played.push(index); },
  };
  const player = QueuePlayback.create({
    core: {
      open(path) {
        opened.push(path);
        native = ["/media/Neighbor.mkv", path, "/media/Trailer.mkv"];
      },
    },
    playlist,
    wait: async () => {},
  });

  await player.start(queue);
  assert.deepEqual(opened, [first]);
  assert.deepEqual(native, queue);
  assert.equal(played.at(-1), 0);
  assert.equal(QueuePlayback.fileUrlForPath(first), "file:///media/One%20%231.mkv");
});
