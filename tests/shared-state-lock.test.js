const test = require("node:test");
const assert = require("node:assert/strict");
const SharedStateLock = require("../shared-state-lock.js");

function createBridge() {
  const coordinatorHandlers = new Map();
  const playerHandlers = new Map();
  const coordinatorApi = {
    onMessage(name, callback) { coordinatorHandlers.set(name, callback); },
    postMessage(player, name, data) {
      const callback = playerHandlers.get(player) && playerHandlers.get(player).get(name);
      if (callback) callback(data);
    },
  };
  const createPlayerApi = (player) => ({
    onMessage(name, callback) {
      if (!playerHandlers.has(player)) playerHandlers.set(player, new Map());
      playerHandlers.get(player).set(name, callback);
    },
    postMessage(name, data) {
      const callback = coordinatorHandlers.get(name);
      if (callback) callback(data, player);
    },
  });
  return { coordinatorApi, createPlayerApi };
}

test("serializes mutations from different player runtimes", async () => {
  const bridge = createBridge();
  SharedStateLock.createCoordinator(bridge.coordinatorApi);
  const first = SharedStateLock.createClient(bridge.createPlayerApi(1));
  const second = SharedStateLock.createClient(bridge.createPlayerApi(2));
  const order = [];
  let releaseFirst;

  const firstMutation = first.withLock(async () => {
    order.push("first-start");
    await new Promise((resolve) => { releaseFirst = resolve; });
    order.push("first-end");
  });
  const secondMutation = second.withLock(() => {
    order.push("second");
  });

  await new Promise((resolve) => setImmediate(resolve));
  assert.deepEqual(order, ["first-start"]);
  releaseFirst();
  await Promise.all([firstMutation, secondMutation]);
  assert.deepEqual(order, ["first-start", "first-end", "second"]);
});

test("releases a lease after a failed mutation", async () => {
  const bridge = createBridge();
  SharedStateLock.createCoordinator(bridge.coordinatorApi);
  const first = SharedStateLock.createClient(bridge.createPlayerApi(1));
  const second = SharedStateLock.createClient(bridge.createPlayerApi(2));

  await assert.rejects(first.withLock(() => {
    throw new Error("write failed");
  }), /write failed/);
  assert.equal(await second.withLock(() => "saved"), "saved");
});

test("coordinator ignores malformed requests and expires abandoned leases", () => {
  const handlers = new Map();
  const messages = [];
  const timers = [];
  const api = {
    onMessage(name, callback) { handlers.set(name, callback); },
    postMessage(...args) { messages.push(args); },
  };
  const coordinator = SharedStateLock.createCoordinator(api, {
    leaseMs: 1_000,
    setTimeout(callback) { timers.push(callback); return timers.length; },
    clearTimeout() {},
  });

  handlers.get(SharedStateLock.REQUEST_MESSAGE)(null, 1);
  handlers.get(SharedStateLock.REQUEST_MESSAGE)({ requestId: "" }, 1);
  assert.equal(messages.length, 0);

  handlers.get(SharedStateLock.REQUEST_MESSAGE)({ requestId: "first" }, 1);
  handlers.get(SharedStateLock.REQUEST_MESSAGE)({ requestId: "second" }, 2);
  assert.deepEqual(coordinator.getState(), {
    active: { player: 1, requestId: "first" },
    queued: [{ player: 2, requestId: "second" }],
  });
  timers[0]();
  assert.deepEqual(messages.at(-1), [2, SharedStateLock.GRANTED_MESSAGE, { requestId: "second" }]);
});
