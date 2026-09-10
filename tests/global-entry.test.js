const test = require("node:test");
const assert = require("node:assert/strict");

test("global entry creates a managed queue player and relays its result", () => {
  const handlers = new Map();
  const created = [];
  const messages = [];
  global.iina = {
    global: {
      onMessage(type, callback) { handlers.set(type, callback); },
      createPlayerInstance(options) {
        created.push(options);
        return 42;
      },
      postMessage(...args) { messages.push(args); },
    },
  };

  try {
    delete require.cache[require.resolve("../global.js")];
    require("../global.js");

    handlers.get("quick-folders-play-queue")({
      paths: ["/media/a.mp4", "/media/a.mp4", "/media/b.mkv"],
    }, 7);
    assert.deepEqual(created, [{
      url: "/media/a.mp4",
      label: "quick-folders-queue",
      enablePlugins: false,
    }]);

    handlers.get("quick-folders-queue-player-ready")(null, 42);
    assert.deepEqual(messages.shift(), [
      42,
      "quick-folders-queue-items",
      { paths: ["/media/a.mp4", "/media/b.mkv"] },
    ]);

    const result = { action: "played", succeeded: ["/media/a.mp4", "/media/b.mkv"], failed: [] };
    handlers.get("quick-folders-queue-player-result")(result, 42);
    assert.deepEqual(messages.shift(), [7, "quick-folders-queue-result", result]);
  } finally {
    delete global.iina;
  }
});

test("global entry rejects an empty queue without creating a player", () => {
  const handlers = new Map();
  const messages = [];
  global.iina = {
    global: {
      onMessage(type, callback) { handlers.set(type, callback); },
      createPlayerInstance() { throw new Error("should not be called"); },
      postMessage(...args) { messages.push(args); },
    },
  };

  try {
    delete require.cache[require.resolve("../global.js")];
    require("../global.js");
    handlers.get("quick-folders-play-queue")({ paths: [] }, 9);
    assert.deepEqual(messages, [[9, "quick-folders-queue-result", {
      action: "played",
      succeeded: [],
      failed: [{ reason: "Queue is empty" }],
    }]]);
  } finally {
    delete global.iina;
  }
});
