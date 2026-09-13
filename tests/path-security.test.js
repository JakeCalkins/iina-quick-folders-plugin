const test = require("node:test");
const assert = require("node:assert/strict");
const PathSecurity = require("../path-security.js");

test("builds every absolute prefix without accepting traversal", () => {
  assert.deepEqual(PathSecurity.getAbsolutePathPrefixes("/media/shows/episode.mkv"), [
    "/", "/media", "/media/shows", "/media/shows/episode.mkv",
  ]);
  assert.deepEqual(PathSecurity.getAbsolutePathPrefixes("/media/../secret.mkv"), []);
  assert.deepEqual(PathSecurity.getAbsolutePathPrefixes("relative/file.mkv"), []);
});

test("rejects a path when any component is a symbolic link", async () => {
  const commands = [];
  const utils = {
    async exec(tool, args) {
      commands.push([tool, args]);
      return {
        status: 0,
        stdout: "40755\n40755\n120755\n100644\n",
      };
    },
  };

  assert.equal(await PathSecurity.hasSymlinkComponent("/media/link/movie.mkv", utils), true);
  assert.deepEqual(commands, [[PathSecurity.STAT_TOOL, [
    "-f", "%p", "/", "/media", "/media/link", "/media/link/movie.mkv",
  ]]]);
});

test("fails closed on stat errors and enforces the configured root first", async () => {
  let calls = 0;
  const utils = {
    async exec() {
      calls++;
      return { status: 1, stdout: "" };
    },
  };
  const roots = [{ path: "/media" }];

  assert.equal(
    await PathSecurity.isPathWithinRootsWithoutSymlinks("/outside/movie.mkv", roots, utils),
    false,
  );
  assert.equal(calls, 0);
  assert.equal(
    await PathSecurity.isPathWithinRootsWithoutSymlinks("/media/movie.mkv", roots, utils),
    false,
  );
  assert.equal(calls, 1);
});

test("accepts a contained path only when every stat result is non-symlink", async () => {
  const utils = {
    async exec() {
      return { status: 0, stdout: "40755\n40755\n100644\n" };
    },
  };
  assert.equal(
    await PathSecurity.isPathWithinRootsWithoutSymlinks(
      "/media/movie.mkv",
      [{ path: "/media" }],
      utils,
    ),
    true,
  );
});

test("validates many paths with one stat process while rejecting symlink descendants", async () => {
  const calls = [];
  const utils = {
    async exec(tool, args) {
      calls.push([tool, args]);
      return {
        status: 0,
        stdout: `${args.slice(2).map((path) => (path === "/media/link" ? "120755" : "100644")).join("\n")}\n`,
      };
    },
  };

  const safe = await PathSecurity.getPathsWithinRootsWithoutSymlinks([
    "/media/one.mp4",
    "/media/two.mkv",
    "/media/link/escape.mov",
    "/outside/ignored.mp4",
  ], [{ path: "/media" }], utils);

  assert.deepEqual(safe, ["/media/one.mp4", "/media/two.mkv"]);
  assert.equal(calls.length, 1);
  assert.equal(calls[0][0], PathSecurity.STAT_TOOL);
});
