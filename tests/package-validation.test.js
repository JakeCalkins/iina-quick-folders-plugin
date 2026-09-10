const assert = require("node:assert/strict");
const { mkdtempSync, mkdirSync, rmSync, writeFileSync } = require("node:fs");
const { tmpdir } = require("node:os");
const { join, resolve } = require("node:path");
const { spawnSync } = require("node:child_process");
const test = require("node:test");

const verifier = resolve(__dirname, "..", "scripts", "verify-plugin-package.mjs");

function createArchive({ manifest, wrapper = false }) {
  const fixture = mkdtempSync(join(tmpdir(), "quick-folders-package-test-"));
  const source = wrapper ? join(fixture, "wrapped-plugin") : fixture;
  if (wrapper) mkdirSync(source);
  writeFileSync(join(source, "Info.json"), JSON.stringify(manifest));
  writeFileSync(join(source, "main.js"), "// fixture\n");
  const archive = join(fixture, "fixture.iinaplgz");
  const inputs = wrapper ? ["wrapped-plugin"] : ["Info.json", "main.js"];
  const zipped = spawnSync("zip", ["-q", "-r", archive, ...inputs], { cwd: fixture, encoding: "utf8" });
  assert.equal(zipped.status, 0, zipped.stderr);
  return { archive, fixture };
}

function validManifest(overrides = {}) {
  return {
    name: "Fixture Plugin",
    identifier: "com.example.fixture",
    version: "1.0.0",
    author: { name: "Example" },
    entry: "main.js",
    ...overrides,
  };
}

function verify(archive) {
  return spawnSync(process.execPath, [verifier, archive], { encoding: "utf8" });
}

test("accepts an IINA package with its manifest and entry at the archive root", () => {
  const { archive, fixture } = createArchive({ manifest: validManifest() });
  try {
    const result = verify(archive);
    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /Verified IINA install layout/);
  } finally {
    rmSync(fixture, { recursive: true, force: true });
  }
});

test("rejects the wrapper directory layout that IINA cannot load", () => {
  const { archive, fixture } = createArchive({ manifest: validManifest(), wrapper: true });
  try {
    const result = verify(archive);
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /Info\.json at the archive root/);
  } finally {
    rmSync(fixture, { recursive: true, force: true });
  }
});

test("rejects a manifest path missing from the package", () => {
  const { archive, fixture } = createArchive({ manifest: validManifest({ entry: "missing.js" }) });
  try {
    const result = verify(archive);
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /entry does not exist in the package/);
  } finally {
    rmSync(fixture, { recursive: true, force: true });
  }
});
