const test = require("node:test");
const assert = require("node:assert/strict");
const fileTypes = require("../quick-folders.iinaplugin/file-types.js");

test("normalizes filenames and extensions consistently", () => {
  assert.equal(fileTypes.getExtension("/Media/Movie.Final.MP4"), "mp4");
  assert.equal(fileTypes.getExtension(".hidden"), "");
  assert.equal(fileTypes.normalizeExtension(".MKV"), "mkv");
  assert.equal(fileTypes.normalizeExtension("clip.jpeg"), "jpeg");
});

test("classifies supported media from the shared extension registry", () => {
  assert.equal(fileTypes.getFileTypeByExt("MP4"), fileTypes.FILE_TYPES.VIDEO);
  assert.equal(fileTypes.getFileTypeByExt("song.m4a"), fileTypes.FILE_TYPES.AUDIO);
  assert.equal(fileTypes.getFileTypeByExt(".png"), fileTypes.FILE_TYPES.IMAGE);
  assert.equal(fileTypes.getFileTypeByExt("txt"), fileTypes.FILE_TYPES.OTHER);
});

test("applies media visibility preferences without hiding video", () => {
  const preferences = { filterAudio: true, filterImages: true, videoOnly: false };
  assert.equal(fileTypes.shouldShowFile("movie.mp4", preferences), true);
  assert.equal(fileTypes.shouldShowFile("song.mp3", preferences), false);
  assert.equal(fileTypes.shouldShowFile("cover.jpg", preferences), false);
  assert.equal(fileTypes.shouldShowFile("notes.txt", preferences), false);
  assert.equal(fileTypes.shouldShowFile(".private.mp4", preferences), false);
});
