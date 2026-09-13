const test = require("node:test");
const assert = require("node:assert/strict");
const { readFileSync } = require("node:fs");
const { resolve } = require("node:path");
const vm = require("node:vm");

test("backend state modules export through IINA's empty CommonJS wrapper", () => {
  const moduleNames = [
    "diagnostics.js",
    "index-state.js",
    "playback-state.js",
    "series-state.js",
  ];

  moduleNames.forEach((moduleName) => {
    const path = resolve(__dirname, "..", moduleName);
    const source = readFileSync(path, "utf8");
    const exported = vm.runInNewContext(
      `(function () { const module = {}; ${source}\nreturn module.exports; })()`,
      {},
      { filename: path },
    );
    assert.equal(typeof exported, "object", `${moduleName} should populate module.exports`);
  });
});
