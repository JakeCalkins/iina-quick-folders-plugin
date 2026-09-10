const test = require("node:test");
const assert = require("node:assert/strict");
const fileTypes = require("../file-types.js");

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

test("covers IINA's common video, audio, and image containers", () => {
  const expectedByType = {
    [fileTypes.FILE_TYPES.VIDEO]: [
      "3g2", "asf", "divx", "f4v", "mk3d", "mkv", "mpeg", "ogv", "rmvb", "vob", "webm", "y4m",
    ],
    [fileTypes.FILE_TYPES.AUDIO]: [
      "ac3", "aif", "ape", "caf", "eac3", "f4a", "m4b", "mka", "oga", "opus", "tak", "wv",
    ],
    [fileTypes.FILE_TYPES.IMAGE]: [
      "apng", "avif", "heic", "heif", "jfif", "jp2", "jxl", "qoi", "tga", "tif", "webp",
    ],
  };

  Object.entries(expectedByType).forEach(([type, extensions]) => {
    extensions.forEach((extension) => {
      assert.equal(fileTypes.getFileTypeByExt(extension), type, extension);
      assert.equal(fileTypes.isPlayableFile(`example.${extension}`), true, extension);
    });
  });
});

test("returns sorted copies of the supported extension registry", () => {
  const videoExtensions = fileTypes.getSupportedExtensions(fileTypes.FILE_TYPES.VIDEO);
  assert.equal(videoExtensions.includes("mkv"), true);
  assert.deepEqual(videoExtensions, [...videoExtensions].sort());
  videoExtensions.length = 0;
  assert.equal(fileTypes.getSupportedExtensions(fileTypes.FILE_TYPES.VIDEO).includes("mkv"), true);
  assert.deepEqual(fileTypes.getSupportedExtensions("document"), []);
});

test("does not treat ambiguous data, playlists, or subtitle tracks as media", () => {
  ["dat", "m3u", "m3u8", "mks", "srt"].forEach((extension) => {
    assert.equal(fileTypes.getFileTypeByExt(extension), fileTypes.FILE_TYPES.OTHER, extension);
    assert.equal(fileTypes.isPlayableFile(`example.${extension}`), false, extension);
  });
});

test("applies media visibility preferences without hiding video", () => {
  const preferences = { filterAudio: true, filterImages: true, videoOnly: false };
  assert.equal(fileTypes.shouldShowFile("movie.mp4", preferences), true);
  assert.equal(fileTypes.shouldShowFile("song.mp3", preferences), false);
  assert.equal(fileTypes.shouldShowFile("cover.jpg", preferences), false);
  assert.equal(fileTypes.shouldShowFile("notes.txt", preferences), false);
  assert.equal(fileTypes.shouldShowFile(".private.mp4", preferences), false);
});
