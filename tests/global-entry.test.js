const test = require("node:test");
const assert = require("node:assert/strict");

const STATE_PATH = "@data/quick-folders-state.json";

function createHarness(options = {}) {
  const handlers = new Map();
  const created = [];
  const messages = [];
  const timers = new Map();
  const existing = new Set(options.existing || ["/media", "/media/a.mp4", "/media/b.mkv"]);
  const directories = new Set(options.directories || ["/media"]);
  const symlinkComponents = new Set(options.symlinkComponents || []);
  let nextPlayer = 42;
  let nextTimer = 1;
  let state = options.state || {
    version: 4,
    folderRoots: [{ path: "/media", name: "media" }],
    queuePaths: [],
  };

  const realSetTimeout = global.setTimeout;
  const realClearTimeout = global.clearTimeout;
  global.setTimeout = (callback, delay) => {
    const id = nextTimer++;
    timers.set(id, { callback, delay });
    return id;
  };
  global.clearTimeout = (id) => timers.delete(id);
  global.iina = {
    file: {
      exists(path) { return path === STATE_PATH || existing.has(path); },
      read(path) { return path === STATE_PATH ? JSON.stringify(state) : ""; },
      list(path) {
        if (path !== "/media") return [];
        return Array.from(existing).filter((candidate) => (
          candidate.startsWith("/media/") && candidate.indexOf("/", 7) === -1
        )).map((candidate) => ({
          filename: candidate.substring("/media/".length),
          path: candidate,
          isDir: directories.has(candidate),
        }));
      },
    },
    global: {
      onMessage(type, callback) { handlers.set(type, callback); },
      createPlayerInstance(playerOptions) {
        created.push(playerOptions);
        return nextPlayer++;
      },
      postMessage(...args) { messages.push(args); },
    },
    utils: {
      async exec(tool, args) {
        assert.equal(tool, "/usr/bin/stat");
        return {
          status: 0,
          stdout: `${args.slice(2).map((path) => (
            symlinkComponents.has(path) ? "120755" : "40755"
          )).join("\n")}\n`,
        };
      },
    },
  };

  delete require.cache[require.resolve("../global.js")];
  require("../global.js");

  return {
    cleanup() {
      global.setTimeout = realSetTimeout;
      global.clearTimeout = realClearTimeout;
      delete global.iina;
    },
    created,
    handlers,
    messages,
    setState(nextState) { state = nextState; },
    timers,
  };
}

test("global entry validates and launches a managed queue, then relays its result", async () => {
  const harness = createHarness();
  try {
    assert.equal(harness.handlers.has("quick-folders-state-lock-request"), true);
    assert.equal(harness.handlers.has("quick-folders-state-lock-release"), true);

    await harness.handlers.get("quick-folders-play-queue")({
      paths: ["/media/a.mp4", "/media/a.mp4", "/media/b.mkv"],
    }, 7);
    assert.deepEqual(harness.created, [{
      url: "/media/a.mp4",
      label: "quick-folders-queue",
      enablePlugins: false,
    }]);

    harness.handlers.get("quick-folders-queue-player-ready")(null, 42);
    assert.deepEqual(harness.messages.shift(), [
      42,
      "quick-folders-queue-items",
      { paths: ["/media/a.mp4", "/media/b.mkv"] },
    ]);
    harness.handlers.get("quick-folders-queue-player-ready")(null, 42);
    assert.equal(harness.messages.length, 0, "duplicate ready events must not replay queue construction");

    const result = { action: "played", succeeded: ["/media/a.mp4", "/media/b.mkv"], failed: [] };
    harness.handlers.get("quick-folders-queue-player-result")(result, 42);
    assert.deepEqual(harness.messages.shift(), [7, "quick-folders-queue-result", result]);
    assert.equal(harness.timers.size, 0);
  } finally {
    harness.cleanup();
  }
});

test("global entry rejects empty, out-of-root, missing, directory, and symlinked launch paths", async () => {
  const harness = createHarness({
    existing: ["/media", "/media/folder.mp4", "/media/link/movie.mkv"],
    directories: ["/media", "/media/folder.mp4"],
    symlinkComponents: ["/media/link"],
  });
  try {
    await harness.handlers.get("quick-folders-play-queue")({ paths: [] }, 1);
    await harness.handlers.get("quick-folders-play-queue")({ paths: ["/outside/movie.mp4"] }, 2);
    await harness.handlers.get("quick-folders-play-queue")({ paths: ["/media/missing.mp4"] }, 3);
    await harness.handlers.get("quick-folders-play-queue")({ paths: ["/media/folder.mp4"] }, 4);
    await harness.handlers.get("quick-folders-play-queue")({ paths: ["/media/link/movie.mkv"] }, 5);

    assert.equal(harness.created.length, 0);
    assert.deepEqual(harness.messages.map((message) => message[0]), [1, 2, 3, 4, 5]);
    assert.equal(harness.messages.every((message) => message[1] === "quick-folders-queue-result"), true);
  } finally {
    harness.cleanup();
  }
});

test("global entry rechecks persisted roots after asynchronous path validation", async () => {
  let releaseStat;
  const harness = createHarness();
  global.iina.utils.exec = async () => new Promise((resolve) => { releaseStat = resolve; });
  try {
    const launch = harness.handlers.get("quick-folders-play-queue")({ paths: ["/media/a.mp4"] }, 6);
    await new Promise((resolve) => setImmediate(resolve));
    harness.setState({ version: 4, folderRoots: [], queuePaths: [] });
    releaseStat({ status: 0, stdout: "40755\n40755\n100644\n" });
    await launch;

    assert.equal(harness.created.length, 0);
    assert.equal(harness.messages.at(-1)[0], 6);
  } finally {
    harness.cleanup();
  }
});

test("only the newest concurrent launch for a requester can create a player", async () => {
  const releases = [];
  const harness = createHarness();
  global.iina.utils.exec = async () => new Promise((resolve) => releases.push(resolve));
  try {
    const older = harness.handlers.get("quick-folders-play-queue")({ paths: ["/media/a.mp4"] }, 8);
    const newer = harness.handlers.get("quick-folders-play-queue")({ paths: ["/media/b.mkv"] }, 8);
    await new Promise((resolve) => setImmediate(resolve));
    assert.equal(releases.length, 2);
    assert.equal(harness.timers.size, 1, "authorization itself must be capacity- and timeout-bounded");

    releases[1]({ status: 0, stdout: "40755\n40755\n100644\n" });
    await newer;
    releases[0]({ status: 0, stdout: "40755\n40755\n100644\n" });
    await older;

    assert.deepEqual(harness.created.map((options) => options.url), ["/media/b.mkv"]);
  } finally {
    harness.cleanup();
  }
});

test("concurrent authorization attempts are capacity-bounded", async () => {
  const releases = [];
  const harness = createHarness();
  global.iina.utils.exec = async () => new Promise((resolve) => releases.push(resolve));
  try {
    const launches = Array.from({ length: 17 }, (_, index) => (
      harness.handlers.get("quick-folders-play-queue")({ paths: ["/media/a.mp4"] }, index + 1)
    ));
    await new Promise((resolve) => setImmediate(resolve));
    assert.equal(releases.length, 17);
    assert.equal(harness.timers.size, 16);

    releases.forEach((release) => release({ status: 0, stdout: "40755\n40755\n100644\n" }));
    await Promise.all(launches);

    assert.equal(harness.created.length, 16);
    assert.equal(harness.messages.some((message) => (
      message[0] === 1 && message[2].failed[0].reason === "Queue startup was superseded"
    )), true);
  } finally {
    harness.cleanup();
  }
});

test("pending queue launches are replaced, capacity-bounded, and expired", async () => {
  const harness = createHarness();
  try {
    await harness.handlers.get("quick-folders-play-queue")({ paths: ["/media/a.mp4"] }, 1);
    await harness.handlers.get("quick-folders-play-queue")({ paths: ["/media/b.mkv"] }, 1);
    harness.handlers.get("quick-folders-queue-player-ready")(null, 42);
    assert.equal(harness.messages.length, 0, "a replaced player must not receive stale queue data");
    harness.handlers.get("quick-folders-queue-player-ready")(null, 43);
    assert.equal(harness.messages.at(-1)[0], 43);

    for (let requester = 2; requester <= 17; requester++) {
      await harness.handlers.get("quick-folders-play-queue")({ paths: ["/media/a.mp4"] }, requester);
    }
    assert.equal(harness.timers.size, 16);
    assert.equal(
      harness.messages.some((message) => (
        message[0] === 1 && message[2] && message[2].failed[0].reason === "Queue startup was superseded"
      )),
      true,
    );

    const timeout = Array.from(harness.timers.values())[0];
    assert.equal(timeout.delay, 30_000);
    timeout.callback();
    assert.equal(harness.timers.size, 15);
    assert.equal(harness.messages.at(-1)[2].failed[0].reason, "Queue player did not finish starting");
  } finally {
    harness.cleanup();
  }
});
