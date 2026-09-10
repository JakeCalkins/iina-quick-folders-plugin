const test = require("node:test");
const assert = require("node:assert/strict");
const QueuePlayback = require("../queue-playback.js");

test("opens the first item and safely encodes later playlist filenames", async () => {
  let openedPath = null;
  let playedIndex = null;
  const added = [];
  const paths = ["/media/A #1?.mkv", "/media/café.mov"];
  const items = [{ filename: paths[0] }];
  const playback = QueuePlayback.create({
    core: { open(path) { openedPath = path; } },
    playlist: {
      list: () => items.slice(),
      add(url, at) {
        added.push({ url, at });
        // Match IINA 1.4's observed runtime behavior: an omitted index inserts
        // before the current item even though the API documentation says append.
        items.unshift({ filename: paths[1] });
      },
      move(from, to) { items.splice(to, 0, ...items.splice(from, 1)); },
      play(index) { playedIndex = index; },
    },
    wait: async () => {},
  });

  await playback.start(paths);

  assert.equal(openedPath, paths[0]);
  assert.deepEqual(added, [{ url: "file:///media/caf%C3%A9.mov", at: undefined }]);
  assert.equal(playedIndex, 0);
});

test("waits for IINA to publish and stabilize the native queue before playing", async () => {
  const paths = ["/media/a.mp4", "/media/b.mkv"];
  let listCalls = 0;
  let waitCalls = 0;
  let playedIndex = null;
  const playback = QueuePlayback.create({
    core: { open() {} },
    playlist: {
      list() {
        listCalls++;
        return listCalls < 3 ? [{ filename: paths[1] }] : paths.map((filename) => ({ filename }));
      },
      remove() {},
      add() {},
      play(index) { playedIndex = index; },
    },
    wait: async (milliseconds) => { assert.equal(milliseconds, 50); waitCalls++; },
  });

  await playback.start(paths);
  assert.equal(listCalls, 32);
  assert.equal(waitCalls, 32);
  assert.equal(playedIndex, 0);
});

test("removes IINA containing-folder autoload entries around the queue", async () => {
  const paths = ["/media/a.mp4", "/media/b.mkv"];
  const items = [
    { filename: "/media/unrelated-before.mov" },
    ...paths.map((filename) => ({ filename })),
    { filename: "/media/unrelated-after.mp4" },
  ];
  const removed = [];
  let playedIndex = null;
  const playback = QueuePlayback.create({
    core: { open() {} },
    playlist: {
      list: () => items.slice(),
      remove(index) {
        removed.push(index);
        items.splice(index, 1);
      },
      add(url, at) {
        assert.equal(url, "file:///media/b.mkv");
        assert.equal(at, undefined);
        items.push({ filename: paths[1] });
      },
      move(from, to) { items.splice(to, 0, ...items.splice(from, 1)); },
      play(index) { playedIndex = index; },
    },
    wait: async () => {},
  });

  await playback.start(paths);
  assert.deepEqual(removed, [3, 2, 0]);
  assert.deepEqual(items.map((item) => item.filename), paths);
  assert.equal(playedIndex, 0);
});

test("adopts a managed player without reopening its first item", async () => {
  const paths = ["/media/a.mp4", "/media/b.mkv"];
  let openCalls = 0;
  const items = [{ filename: paths[0] }];
  const playback = QueuePlayback.create({
    core: { open() { openCalls++; } },
    playlist: {
      list: () => items.slice(),
      remove(index) { items.splice(index, 1); },
      add() { items.push({ filename: paths[1] }); },
      move(from, to) { items.splice(to, 0, ...items.splice(from, 1)); },
      play() {},
    },
    wait: async () => {},
  });

  await playback.start(paths, { openFirst: false });
  assert.equal(openCalls, 0);
  assert.deepEqual(items.map((item) => item.filename), paths);
});

test("waits for late folder autoload to settle before rebuilding the queue", async () => {
  const paths = ["/media/a.mp4", "/media/b.mkv"];
  const items = [{ filename: paths[0] }];
  let waits = 0;
  let removals = 0;
  const playback = QueuePlayback.create({
    core: { open() {} },
    playlist: {
      list: () => items.slice(),
      remove(index) { removals++; items.splice(index, 1); },
      add() { items.push({ filename: paths[1] }); },
      move(from, to) { items.splice(to, 0, ...items.splice(from, 1)); },
      play() {},
    },
    wait: async () => {
      waits++;
      if (waits === 10) items.push({ filename: "/media/neighbor.mov" });
    },
  });

  await playback.start(paths);
  assert.equal(removals, 1);
  assert.deepEqual(items.map((item) => item.filename), paths);
});
