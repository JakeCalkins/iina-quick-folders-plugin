const test = require("node:test");
const assert = require("node:assert/strict");
const { createAsyncResourceLoader } = require("../async-resource-loader.js");

test("deduplicates pending loads and serves later requests from cache", async () => {
  let loadCount = 0;
  const delivered = [];
  const loader = createAsyncResourceLoader({
    concurrency: 2,
    maxEntries: 2,
    isValid: (key) => key.startsWith("/media/"),
    async load(key) {
      loadCount++;
      return `data:${key}`;
    },
    deliver(key, value) {
      delivered.push([key, value]);
    },
  });

  assert.equal(loader.request("/outside/a"), false);
  loader.request("/media/a");
  loader.request("/media/a");
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(loadCount, 1);
  assert.deepEqual(delivered, [["/media/a", "data:/media/a"]]);

  loader.request("/media/a");
  assert.equal(loadCount, 1);
  assert.deepEqual(delivered.at(-1), ["/media/a", "data:/media/a"]);
});

test("converts load failures to cached null results", async () => {
  const delivered = [];
  const loader = createAsyncResourceLoader({
    isValid: () => true,
    async load() { throw new Error("unavailable"); },
    deliver(key, value) { delivered.push([key, value]); },
  });
  loader.request("missing");
  await new Promise((resolve) => setImmediate(resolve));
  assert.deepEqual(delivered, [["missing", null]]);
});

test("does not deliver an in-flight result after the resource is removed", async () => {
  let finish;
  const delivered = [];
  const loader = createAsyncResourceLoader({
    isValid: () => true,
    load: () => new Promise((resolve) => { finish = resolve; }),
    deliver(key) { delivered.push(key); },
  });
  loader.request("deleted");
  await new Promise((resolve) => setImmediate(resolve));
  loader.remove("deleted");
  finish("late result");
  await new Promise((resolve) => setImmediate(resolve));
  assert.deepEqual(delivered, []);
});

test("reports aggregate stats and clears work without exposing resource keys", async () => {
  const pending = [];
  const delivered = [];
  const loader = createAsyncResourceLoader({
    concurrency: 1,
    maxEntries: 2,
    isValid: () => true,
    load(key) {
      return new Promise((resolve) => pending.push({ key, resolve }));
    },
    deliver(key, value) { delivered.push([key, value]); },
  });

  loader.request("/media/one.mp4");
  loader.request("/media/two.mp4");
  await Promise.resolve();
  assert.deepEqual(loader.getStats(), { active: 1, cached: 0, pending: 2, queued: 1 });

  loader.clear();
  assert.deepEqual(loader.getStats(), { active: 1, cached: 0, pending: 0, queued: 0 });
  assert.equal(JSON.stringify(loader.getStats()).includes("media"), false);

  pending[0].resolve("late");
  await new Promise((resolve) => setImmediate(resolve));
  assert.deepEqual(delivered, []);
  assert.deepEqual(loader.getStats(), { active: 0, cached: 0, pending: 0, queued: 0 });
});

test("reports cache hits and misses without changing request semantics", async () => {
  let hits = 0;
  let misses = 0;
  const delivered = [];
  const loader = createAsyncResourceLoader({
    concurrency: 1,
    maxEntries: 2,
    isValid: () => true,
    load: async (key) => key.toUpperCase(),
    deliver(key, value) { delivered.push([key, value]); },
    onCacheHit() { hits++; },
    onCacheMiss() { misses++; },
  });
  loader.request("a");
  await new Promise((resolve) => setImmediate(resolve));
  loader.request("a");
  assert.equal(hits, 1);
  assert.equal(misses, 1);
  assert.deepEqual(delivered, [["a", "A"], ["a", "A"]]);
});
