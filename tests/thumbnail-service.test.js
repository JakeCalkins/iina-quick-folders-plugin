const test = require("node:test");
const assert = require("node:assert/strict");
const { readFileSync } = require("node:fs");
const { dirname, resolve } = require("node:path");
const vm = require("node:vm");
const {
  createFallbackThumbnailDataUrl,
  createThumbnailGenerator,
  createThumbnailService,
  findGeneratedImage,
  hashPath,
  shouldUseQuickLook,
} = require("../thumbnail-service.js");

function nextTurn() {
  return new Promise((resolve) => setImmediate(resolve));
}

function loadAsIinaModule(modulePath) {
  const absolutePath = resolve(__dirname, "..", modulePath);
  const source = readFileSync(absolutePath, "utf8");
  const localRequire = (request) => loadAsIinaModule(resolve(dirname(absolutePath), request));
  return vm.runInNewContext(
    `(function (require) { const module = {}; ${source}\nreturn module.exports; })(require)`,
    { require: localRequire },
    { filename: absolutePath },
  );
}

function createFileApi(overrides = {}) {
  return {
    delete() {},
    exists() { return false; },
    list() { return []; },
    handle() {
      return {
        readToEnd() { return [137, 80, 78, 71]; },
        close() {},
      };
    },
    ...overrides,
  };
}

test("discovers Quick Look output inside the resolved physical directory", async () => {
  const commands = [];
  const listedDirectories = [];
  const openedPaths = [];
  const deletedPaths = [];
  const generator = createThumbnailGenerator({
    file: createFileApi({
      delete(path) { deletedPaths.push(path); },
      list(path) {
        listedDirectories.push(path);
        return [{ filename: "movie.mp4.png", isDir: false }];
      },
      handle(path) {
        openedPaths.push(path);
        return { readToEnd: () => [137, 80, 78, 71], close() {} };
      },
    }),
    utils: {
      resolvePath(path) {
        assert.equal(path, "@tmp/thumbs");
        return "/tmp/example-plugin/thumbs";
      },
      async exec(tool, args) {
        commands.push([tool, args]);
        return { status: 0 };
      },
    },
    cacheRoot: "@tmp/thumbs",
    isValid: (path) => path === "/media/movie.mp4",
    sessionId: "test",
  });

  const result = await generator.generate("/media/movie.mp4");

  assert.equal(result, "data:image/png;base64,iVBORw==");
  assert.deepEqual(listedDirectories, ["/tmp/example-plugin/thumbs/e2fc78f4-test-0"]);
  assert.deepEqual(openedPaths, ["/tmp/example-plugin/thumbs/e2fc78f4-test-0/movie.mp4.png"]);
  assert.deepEqual(commands.map(([tool]) => tool), ["/bin/mkdir", "/usr/bin/qlmanage"]);
  assert.deepEqual(deletedPaths, ["@tmp/thumbs/e2fc78f4-test-0"]);
  assert.deepEqual(commands[1][1], [
    "-t", "-s", "128", "-o", "/tmp/example-plugin/thumbs/e2fc78f4-test-0", "/media/movie.mp4",
  ]);
});

test("exports through IINA's empty CommonJS wrapper", () => {
  const service = loadAsIinaModule("thumbnail-service.js");
  assert.equal(typeof service.createThumbnailService, "function");
  assert.match(service.createFallbackThumbnailDataUrl("video"), /^data:image\/svg\+xml;base64,/);
});

test("uses sips when Quick Look cannot render an image", async () => {
  const commands = [];
  const resizedPath = "/tmp/example-plugin/thumbs/3b044b17-test-0/image-fallback.png";
  const generator = createThumbnailGenerator({
    file: createFileApi({
      exists(path) { return path === resizedPath; },
      handle(path) {
        assert.equal(path, resizedPath);
        return { readToEnd: () => [1, 2, 3], close() {} };
      },
    }),
    utils: {
      resolvePath: () => "/tmp/example-plugin/thumbs",
      async exec(tool, args) {
        commands.push([tool, args]);
        return { status: tool === "/usr/bin/qlmanage" ? 1 : 0 };
      },
    },
    isValid: () => true,
    sessionId: "test",
  });

  const result = await generator.generate("/media/photo.webp");

  assert.equal(result, "data:image/png;base64,AQID");
  assert.deepEqual(commands.map(([tool]) => tool), [
    "/bin/mkdir", "/usr/bin/qlmanage", "/usr/bin/sips",
  ]);
});

test("skips Quick Look and uses sips directly for non-native image codecs", async () => {
  const commands = [];
  const sourcePath = "/media/photo.qoi";
  const resizedPath = `/tmp/example-plugin/thumbs/${hashPath(sourcePath)}-test-0/image-fallback.png`;
  const generator = createThumbnailGenerator({
    file: createFileApi({
      exists(path) { return path === resizedPath; },
      handle: () => ({ readToEnd: () => [1, 2, 3], close() {} }),
    }),
    utils: {
      resolvePath: () => "/tmp/example-plugin/thumbs",
      async exec(tool, args) {
        commands.push([tool, args]);
        return { status: 0 };
      },
    },
    isValid: () => true,
    sessionId: "test",
  });

  assert.equal(await generator.generate(sourcePath), "data:image/png;base64,AQID");
  assert.deepEqual(commands.map(([tool]) => tool), ["/bin/mkdir", "/usr/bin/sips"]);
});

test("returns distinct generated fallbacks and cleans up after tool failure", async () => {
  const commands = [];
  const deletedPaths = [];
  const generator = createThumbnailGenerator({
    file: createFileApi({ delete(path) { deletedPaths.push(path); } }),
    utils: {
      resolvePath: () => "/tmp/example-plugin/thumbs",
      async exec(tool) {
        commands.push(tool);
        if (tool === "/usr/bin/qlmanage") throw new Error("Quick Look unavailable");
        return { status: 0 };
      },
    },
    isValid: () => true,
    sessionId: "test",
  });

  const video = await generator.generate("/media/movie.mp4");

  assert.match(video, /^data:image\/svg\+xml;base64,/);
  assert.notEqual(video, createFallbackThumbnailDataUrl("audio"));
  assert.deepEqual(commands, ["/bin/mkdir", "/usr/bin/qlmanage"]);
  assert.deepEqual(deletedPaths, ["@tmp/quick-folders-thumbnails/e2fc78f4-test-0"]);
});

test("returns an immediate fallback for MKV instead of starting an unbounded Quick Look job", async () => {
  let commandCount = 0;
  const generator = createThumbnailGenerator({
    file: createFileApi(),
    utils: {
      resolvePath: () => "/tmp/example-plugin/thumbs",
      async exec() {
        commandCount++;
        return new Promise(() => {});
      },
    },
    isValid: () => true,
  });

  const result = await generator.generate("/media/movie.mkv");

  assert.match(result, /^data:image\/svg\+xml;base64,/);
  assert.equal(commandCount, 0);
  assert.equal(shouldUseQuickLook("/media/movie.mkv", "video"), false);
  assert.equal(shouldUseQuickLook("/media/movie.mk3d", "video"), false);
  assert.equal(shouldUseQuickLook("/media/recording.webm", "video"), false);
  assert.equal(shouldUseQuickLook("/media/soundtrack.mka", "audio"), false);
  assert.equal(shouldUseQuickLook("/media/movie.mp4", "video"), true);
});

test("rechecks source authorization immediately before native thumbnail tools", async () => {
  const commands = [];
  let authorizationChecks = 0;
  const generator = createThumbnailGenerator({
    file: createFileApi(),
    utils: {
      resolvePath: () => "/tmp/example-plugin/thumbs",
      async exec(tool) {
        commands.push(tool);
        return { status: 0 };
      },
    },
    isValid: () => true,
    async isAuthorized() {
      authorizationChecks++;
      return authorizationChecks === 1;
    },
    sessionId: "test",
  });

  assert.equal(await generator.generate("/media/movie.mp4"), null);
  assert.equal(authorizationChecks, 2);
  assert.deepEqual(commands, ["/bin/mkdir"]);
});

test("uses an optional ffmpeg install for a bounded MKV frame without invoking Quick Look", async () => {
  const commands = [];
  const checkedTools = [];
  const framePath = "/tmp/example-plugin/thumbs/26c7759d-test-0/media-preview.png";
  const generator = createThumbnailGenerator({
    file: createFileApi({
      exists(path) { return path === framePath; },
      handle(path) {
        assert.equal(path, framePath);
        return { readToEnd: () => [4, 5, 6], close() {} };
      },
    }),
    utils: {
      resolvePath: () => "/tmp/example-plugin/thumbs",
      fileInPath(path) {
        checkedTools.push(path);
        return path === "/usr/local/bin/ffmpeg";
      },
      async exec(tool, args) {
        commands.push([tool, args]);
        return { status: 0 };
      },
    },
    isValid: () => true,
    sessionId: "test",
  });

  const result = await generator.generate("/media/movie.mkv");

  assert.equal(result, "data:image/png;base64,BAUG");
  assert.deepEqual(checkedTools, ["/opt/homebrew/bin/ffmpeg", "/usr/local/bin/ffmpeg"]);
  assert.deepEqual(commands.map(([tool]) => tool), ["/bin/mkdir", "/usr/local/bin/ffmpeg"]);
  assert.equal(commands.some(([tool]) => tool === "/usr/bin/qlmanage"), false);
  assert.deepEqual(commands[1][1], [
    "-nostdin", "-hide_banner", "-loglevel", "error",
    "-ss", "1", "-i", "/media/movie.mkv",
    "-map", "0:v:0", "-frames:v", "1",
    "-vf", "scale=128:128:force_original_aspect_ratio=decrease",
    "-y", framePath,
  ]);
});

test("uses optional ffmpeg to extract embedded art from non-native audio", async () => {
  const commands = [];
  const sourcePath = "/media/album.ogg";
  const framePath = `/tmp/example-plugin/thumbs/${hashPath(sourcePath)}-test-0/media-preview.png`;
  const generator = createThumbnailGenerator({
    file: createFileApi({
      exists(path) { return path === framePath; },
      handle: () => ({ readToEnd: () => [7, 8, 9], close() {} }),
    }),
    utils: {
      resolvePath: () => "/tmp/example-plugin/thumbs",
      fileInPath(path) { return path === "/opt/homebrew/bin/ffmpeg"; },
      async exec(tool, args) {
        commands.push([tool, args]);
        return { status: 0 };
      },
    },
    isValid: () => true,
    sessionId: "test",
  });

  assert.equal(await generator.generate(sourcePath), "data:image/png;base64,BwgJ");
  assert.deepEqual(commands.map(([tool]) => tool), ["/bin/mkdir", "/opt/homebrew/bin/ffmpeg"]);
  assert.equal(commands[1][1].includes("-ss"), false);
  assert.equal(commands[1][1].includes("0:v:0?"), true);
});

test("ignores unsafe or non-image output entries", () => {
  const fileApi = createFileApi({
    list() {
      return [
        { filename: "../outside.png", isDir: false },
        { filename: "notes.txt", isDir: false },
        { filename: "nested", isDir: true },
        { name: "cover.jpg", is_dir: false },
      ];
    },
  });

  assert.equal(findGeneratedImage(fileApi, "/tmp/example-job"), "/tmp/example-job/cover.jpg");
});

test("revalidates queued paths, deduplicates work, and serves the bounded cache", async () => {
  const delivered = [];
  const commands = [];
  let valid = true;
  const service = createThumbnailService({
    file: createFileApi({
      list() { return [{ filename: "cover.png", isDir: false }]; },
    }),
    utils: {
      resolvePath: () => "/tmp/example-plugin/thumbs",
      async exec(tool) {
        commands.push(tool);
        return { status: 0 };
      },
    },
    isValid: () => valid,
    deliver(path, dataUrl) { delivered.push([path, dataUrl]); },
    sessionId: "test",
  });

  assert.equal(service.request("/media/song.mp3"), true);
  assert.equal(service.request("/media/song.mp3"), true);
  await nextTurn();
  await nextTurn();
  assert.equal(commands.filter((tool) => tool === "/usr/bin/qlmanage").length, 1);
  assert.equal(delivered.length, 1);

  service.request("/media/song.mp3");
  assert.equal(delivered.length, 2, "cached album-art thumbnail is delivered synchronously");

  valid = false;
  assert.equal(service.request("/media/missing.mp4"), false);
  assert.equal(commands.filter((tool) => tool === "/usr/bin/qlmanage").length, 1);
});

test("rejects a path that becomes invalid before queued work begins", async () => {
  const delivered = [];
  let releaseFirst;
  const validity = new Map([
    ["/media/first.mp4", true],
    ["/media/moved.mp4", true],
  ]);
  const service = createThumbnailService({
    concurrency: 1,
    file: createFileApi(),
    utils: {
      resolvePath: () => "/tmp/example-plugin/thumbs",
      exec(tool) {
        if (tool === "/bin/mkdir" && !releaseFirst) {
          return new Promise((resolve) => { releaseFirst = () => resolve({ status: 0 }); });
        }
        return Promise.resolve({ status: 0 });
      },
    },
    isValid(path) { return validity.get(path) === true; },
    deliver(path, value) { delivered.push([path, value]); },
    sessionId: "test",
  });

  service.request("/media/first.mp4");
  service.request("/media/moved.mp4");
  await nextTurn();
  validity.set("/media/moved.mp4", false);
  releaseFirst();
  await nextTurn();
  await nextTurn();

  assert.equal(delivered.some(([path]) => path === "/media/moved.mp4"), true);
  assert.equal(delivered.find(([path]) => path === "/media/moved.mp4")[1], null);
});

test("path hashes are stable and do not expose source names", () => {
  assert.equal(hashPath("/media/movie.mkv"), "26c7759d");
  assert.match(hashPath("/media/private title.mp4"), /^[a-f0-9]+$/);
  assert.equal(hashPath("/media/private title.mp4").includes("private"), false);
});
