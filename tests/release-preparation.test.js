const assert = require("node:assert/strict");
const { spawnSync } = require("node:child_process");
const { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } = require("node:fs");
const { join } = require("node:path");
const { tmpdir } = require("node:os");
const test = require("node:test");

function createFixture() {
  const root = mkdtempSync(join(tmpdir(), "quick-folders-release-"));
  mkdirSync(join(root, "scripts"));
  cpSync(join(__dirname, "..", "scripts", "prepare-release.mjs"), join(root, "scripts", "prepare-release.mjs"));
  writeFileSync(join(root, "Info.json"), `${JSON.stringify({ version: "2.3.0", ghVersion: 3 }, null, 2)}\n`);
  writeFileSync(join(root, "CHANGELOG.md"), [
    "# Changelog",
    "",
    "## [Unreleased]",
    "",
    "### Fixed",
    "- Restored GitHub installation",
    "",
    "## [2.3.0] - 2026-09-09",
    "",
    "### Added",
    "- Existing release",
    "",
  ].join("\n"));
  return root;
}

test("release preparation updates semantic and IINA update versions together", () => {
  const root = createFixture();
  try {
    const result = spawnSync(process.execPath, [join(root, "scripts", "prepare-release.mjs"), "2.3.2"], {
      encoding: "utf8",
      env: { ...process.env, RELEASE_DATE: "2026-09-10" },
    });

    assert.equal(result.status, 0, result.stderr);
    const manifest = JSON.parse(readFileSync(join(root, "Info.json"), "utf8"));
    assert.equal(manifest.version, "2.3.2");
    assert.equal(manifest.ghVersion, 4);
    assert.match(readFileSync(join(root, "CHANGELOG.md"), "utf8"), /## \[2\.3\.2\] - 2026-09-10/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("release preparation rejects an invalid IINA update version without writing", () => {
  const root = createFixture();
  try {
    const manifestPath = join(root, "Info.json");
    const changelogPath = join(root, "CHANGELOG.md");
    writeFileSync(manifestPath, `${JSON.stringify({ version: "2.3.0", ghVersion: null }, null, 2)}\n`);
    const originalManifest = readFileSync(manifestPath, "utf8");
    const originalChangelog = readFileSync(changelogPath, "utf8");

    const result = spawnSync(process.execPath, [join(root, "scripts", "prepare-release.mjs"), "2.3.2"], {
      encoding: "utf8",
    });

    assert.equal(result.status, 1);
    assert.match(result.stderr, /ghVersion must be a positive integer/);
    assert.equal(readFileSync(manifestPath, "utf8"), originalManifest);
    assert.equal(readFileSync(changelogPath, "utf8"), originalChangelog);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
