const test = require("node:test");
const assert = require("node:assert/strict");
const metadata = require("../media-metadata.js");

test("parses available Spotlight media metadata and ignores null values", () => {
  assert.deepEqual(metadata.parseMdlsOutput([
    "kMDItemDurationSeconds = 3723.42",
    "kMDItemPixelHeight     = 1080",
    "kMDItemPixelWidth      = 1920",
  ].join("\n")), { duration: 3723.42, height: 1080, width: 1920 });

  assert.deepEqual(metadata.parseMdlsOutput([
    "kMDItemDurationSeconds = (null)",
    "kMDItemPixelHeight = 3024",
    "kMDItemPixelWidth = 4032",
  ].join("\n")), { height: 3024, width: 4032 });
});

test("formats short and long durations for compact chips", () => {
  assert.equal(metadata.formatDuration(5.4), "0:05");
  assert.equal(metadata.formatDuration(125), "2:05");
  assert.equal(metadata.formatDuration(3723.42), "1:02:03");
  assert.equal(metadata.formatDuration(null), "");
});

test("formats only complete positive resolutions", () => {
  assert.equal(metadata.formatResolution(1920, 1080), "1920×1080");
  assert.equal(metadata.formatResolution(4032.2, 3024.4), "4032×3024");
  assert.equal(metadata.formatResolution(1920, null), "");
});
