const test = require("node:test");
const assert = require("node:assert/strict");
const QueuePlayback = require("../queue-playback.js");

test("serializes special filenames into a private native M3U", async () => {
  let writtenPath = null;
  let writtenContents = null;
  let openedPath = null;
  let playedIndex = null;
  const paths = ["/media/A #1?.mkv", "/media/café.mov"];
  const playback = QueuePlayback.create({
    core: { open(path) { openedPath = path; } },
    file: { write(path, contents) { writtenPath = path; writtenContents = contents; } },
    playlist: {
      list: () => paths.map((filename) => ({ filename })),
      play(index) { playedIndex = index; },
    },
    utils: { resolvePath: (path) => `/tmp/${path.slice("@tmp/".length)}` },
    now: () => 1234,
  });

  await playback.start(paths);

  assert.equal(writtenPath, "@tmp/quick-folders-queue-1234.m3u8");
  assert.equal(writtenContents, "#EXTM3U\nfile:///media/A%20%231%3F.mkv\nfile:///media/caf%C3%A9.mov\n");
  assert.equal(openedPath, "/tmp/quick-folders-queue-1234.m3u8");
  assert.equal(playedIndex, 0);
});

test("waits for IINA to publish the native queue before selecting the first item", async () => {
  const paths = ["/media/a.mp4", "/media/b.mkv"];
  let listCalls = 0;
  let waitCalls = 0;
  let playedIndex = null;
  const playback = QueuePlayback.create({
    core: { open() {} },
    file: { write() {} },
    playlist: {
      list() {
        listCalls++;
        return listCalls < 3 ? [{ filename: paths[1] }] : paths.map((filename) => ({ filename }));
      },
      play(index) { playedIndex = index; },
    },
    utils: { resolvePath: () => "/tmp/queue.m3u8" },
    now: () => 1,
    wait: async (milliseconds) => { assert.equal(milliseconds, 50); waitCalls++; },
  });

  await playback.start(paths);
  assert.equal(listCalls, 3);
  assert.equal(waitCalls, 2);
  assert.equal(playedIndex, 0);
});
