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
