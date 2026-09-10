const assert = require("node:assert/strict");
const { chmodSync, mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } = require("node:fs");
const { tmpdir } = require("node:os");
const { join, resolve } = require("node:path");
const { spawnSync } = require("node:child_process");
const test = require("node:test");

const repositoryRoot = resolve(__dirname, "..");
const publishScript = join(repositoryRoot, "scripts", "publish-release.sh");

function runPublish({ releaseExists }) {
  const fixture = mkdtempSync(join(tmpdir(), "quick-folders-release-test-"));
  const bin = join(fixture, "bin");
  const dist = join(fixture, "dist");
  const callLog = join(fixture, "gh-calls.log");
  mkdirSync(bin);
  mkdirSync(dist);
  writeFileSync(join(dist, "quick-folders-v9.8.7.iinaplgz"), "package");
  writeFileSync(join(dist, "quick-folders-v9.8.7.iinaplgz.sha256"), "checksum");
  const fakeGh = join(bin, "gh");
  writeFileSync(fakeGh, `#!/usr/bin/env bash
printf '%s\\n' "$*" >> "$GH_CALL_LOG"
if [[ "$1 $2" == "release view" ]]; then
  exit "$GH_RELEASE_VIEW_STATUS"
fi
`);
  chmodSync(fakeGh, 0o755);

  try {
    const result = spawnSync("bash", [publishScript], {
      cwd: fixture,
      encoding: "utf8",
      env: {
        ...process.env,
        PATH: `${bin}:${process.env.PATH}`,
        GH_CALL_LOG: callLog,
        GH_RELEASE_VIEW_STATUS: releaseExists ? "0" : "1",
        GITHUB_REPOSITORY: "example/quick-folders",
        RELEASE_TAG: "v9.8.7",
        VERSION: "9.8.7",
      },
    });
    assert.equal(result.status, 0, result.stderr);
    return readFileSync(callLog, "utf8").trim().split("\n");
  } finally {
    rmSync(fixture, { recursive: true, force: true });
  }
}

test("creates a tagged release when none exists", () => {
  const calls = runPublish({ releaseExists: false });
  assert.match(calls[0], /^release view v9\.8\.7 --repo example\/quick-folders$/);
  assert.match(calls[1], /^release create v9\.8\.7 /);
  assert.match(calls[1], /quick-folders-v9\.8\.7\.iinaplgz/);
  assert.match(calls[1], /--verify-tag/);
  assert.match(calls[1], /--fail-on-no-commits/);
});

test("repairs an existing release by replacing its assets", () => {
  const calls = runPublish({ releaseExists: true });
  assert.match(calls[0], /^release view v9\.8\.7 --repo example\/quick-folders$/);
  assert.match(calls[1], /^release upload v9\.8\.7 /);
  assert.match(calls[1], /quick-folders-v9\.8\.7\.iinaplgz/);
  assert.match(calls[1], /--clobber/);
  assert.equal(calls.some((call) => call.startsWith("release create")), false);
});
