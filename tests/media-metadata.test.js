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

test("parses extended numeric fields and multiline codec lists", () => {
  assert.deepEqual(metadata.parseMdlsOutput([
    "kMDItemDurationSeconds    = \"125.25\"",
    "kMDItemPixelWidth        = 3840",
    "kMDItemPixelHeight       = 2160",
    "kMDItemVideoBitRate      = 8450000",
    "kMDItemAudioBitRate      = 256000",
    "kMDItemAudioSampleRate   = 48000",
    "kMDItemAudioChannelCount = 6",
    "kMDItemCodecs            = (",
    "    \"H.264\",",
    "    AAC,",
    "    \"H.264\"",
    ")",
  ].join("\n")), {
    duration: 125.25,
    height: 2160,
    width: 3840,
    videoBitRate: 8450000000,
    audioBitRate: 256000000,
    audioSampleRate: 48000,
    audioChannels: 6,
    codecs: ["H.264", "AAC"],
  });
});

test("normalizes Spotlight bitrate values from kilobits to bits per second", () => {
  assert.deepEqual(metadata.parseMdlsOutput([
    "kMDItemVideoBitRate = 151",
    "kMDItemAudioBitRate = 128",
  ].join("\n")), {
    videoBitRate: 151000,
    audioBitRate: 128000,
  });
});

test("recovers from an unterminated Spotlight list without losing later fields", () => {
  assert.deepEqual(metadata.parseMdlsOutput([
    "kMDItemCodecs = (",
    "    HEVC,",
    "kMDItemDurationSeconds = 30",
  ].join("\n")), {
    duration: 30,
    codecs: ["HEVC"],
  });
});

test("normalizes malformed and mixed-source metadata safely", () => {
  assert.deepEqual(metadata.normalizeMetadata({
    duration: true,
    width: Infinity,
    height: -1,
    audioChannels: "2",
    codecs: ["AAC", "aac", "", null, "(null)"],
  }), {
    audioChannels: 2,
    codecs: ["AAC"],
  });
  assert.deepEqual(metadata.normalizeMetadata(null), {});
  assert.deepEqual(metadata.parseMdlsOutput("not metadata\nkMDItemCodecs = (null)"), {});
});

test("normalizes ffprobe JSON when Spotlight cannot inspect a container", () => {
  assert.deepEqual(metadata.parseFfprobeOutput(JSON.stringify({
    streams: [
      { codec_type: "video", codec_name: "h264", width: 1920, height: 1080, bit_rate: "8000000" },
      { codec_type: "audio", codec_name: "aac", sample_rate: "48000", channels: 2, bit_rate: "256000" },
    ],
    format: { duration: "125.25", bit_rate: "8300000" },
  })), {
    duration: 125.25,
    height: 1080,
    width: 1920,
    videoBitRate: 8000000,
    audioBitRate: 256000,
    audioSampleRate: 48000,
    audioChannels: 2,
    codecs: ["H.264", "AAC"],
  });

  assert.deepEqual(metadata.parseFfprobeOutput(JSON.stringify({
    streams: [{ codec_type: "audio", codec_name: "flac" }],
    format: { duration: "60", bit_rate: "900000" },
  })), {
    duration: 60,
    audioBitRate: 900000,
    codecs: ["FLAC"],
  });
  assert.deepEqual(metadata.parseFfprobeOutput("not JSON"), {});
  assert.deepEqual(metadata.parseFfprobeOutput("null"), {});
});

test("merges preferred metadata with fallback fields and unique codecs", () => {
  assert.deepEqual(metadata.mergeMetadata(
    { duration: 125, codecs: ["H.264"] },
    { duration: 124.8, width: 1920, height: 1080, codecs: ["h264", "aac"] },
  ), {
    duration: 125,
    height: 1080,
    width: 1920,
    codecs: ["H.264", "AAC"],
  });
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

test("formats bitrate, sample rate, channels, and codecs as compact chip text", () => {
  assert.equal(metadata.formatBitRate(320000), "320 kbps");
  assert.equal(metadata.formatBitRate(8450000), "8.4 Mbps");
  assert.equal(metadata.formatBitRate(-1), "");
  assert.equal(metadata.formatSampleRate(44100), "44.1 kHz");
  assert.equal(metadata.formatSampleRate(48000), "48 kHz");
  assert.equal(metadata.formatChannelCount(1), "Mono");
  assert.equal(metadata.formatChannelCount(2), "Stereo");
  assert.equal(metadata.formatChannelCount(6), "6 ch");
  assert.equal(metadata.formatCodecs(["H.264", "AAC", "SRT"]), "H.264 · AAC +1");
});

test("builds useful type-specific chip descriptions in a stable order", () => {
  const source = {
    duration: 125,
    width: 1920,
    height: 1080,
    codecs: ["H.264", "AAC"],
    videoBitRate: 8450000,
    audioBitRate: 256000,
    audioSampleRate: 48000,
    audioChannels: 2,
  };
  assert.deepEqual(metadata.getMetadataChips(source, "video"), [
    { key: "duration", text: "2:05", title: "Duration" },
    { key: "resolution", text: "1920×1080", title: "Resolution" },
    { key: "codecs", text: "H.264 · AAC", title: "Codecs" },
    { key: "bitrate", text: "8.4 Mbps", title: "Video bitrate" },
  ]);
  assert.deepEqual(metadata.getMetadataChips(source, "audio"), [
    { key: "duration", text: "2:05", title: "Duration" },
    { key: "codecs", text: "H.264 · AAC", title: "Codecs" },
    { key: "bitrate", text: "256 kbps", title: "Audio bitrate" },
    { key: "sample-rate", text: "48 kHz", title: "Sample rate" },
    { key: "channels", text: "Stereo", title: "Audio channels" },
  ]);
  assert.deepEqual(metadata.getMetadataChips(source, "image"), [
    { key: "resolution", text: "1920×1080", title: "Resolution" },
  ]);
});
