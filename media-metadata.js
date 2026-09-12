const QuickFoldersMediaMetadata = (() => {
  const NUMERIC_ATTRIBUTE_MAP = Object.freeze({
    kMDItemDurationSeconds: "duration",
    kMDItemPixelHeight: "height",
    kMDItemPixelWidth: "width",
    kMDItemVideoBitRate: "videoBitRate",
    kMDItemAudioBitRate: "audioBitRate",
    kMDItemAudioSampleRate: "audioSampleRate",
    kMDItemAudioChannelCount: "audioChannels",
  });

  const LIST_ATTRIBUTE_MAP = Object.freeze({
    kMDItemCodecs: "codecs",
  });

  const CODEC_LABELS = Object.freeze({
    aac: "AAC",
    ac3: "AC-3",
    alac: "ALAC",
    av1: "AV1",
    eac3: "E-AC-3",
    flac: "FLAC",
    h264: "H.264",
    hevc: "HEVC",
    jpeg: "JPEG",
    mjpeg: "Motion JPEG",
    mp3: "MP3",
    opus: "Opus",
    png: "PNG",
    prores: "ProRes",
    theora: "Theora",
    vorbis: "Vorbis",
    vp8: "VP8",
    vp9: "VP9",
    webp: "WebP",
  });

  function positiveNumber(value) {
    if (typeof value !== "number" && typeof value !== "string") return null;
    const number = typeof value === "string"
      ? Number(value.trim().replace(/^"|"$/g, ""))
      : Number(value);
    return Number.isFinite(number) && number > 0 ? number : null;
  }

  function decodeMdlsString(value) {
    return String(value || "")
      .trim()
      .replace(/^"|"$/g, "")
      .replace(/\\"/g, "\"")
      .replace(/\\\\/g, "\\");
  }

  function normalizeCodecName(value) {
    const codec = decodeMdlsString(value);
    return CODEC_LABELS[codec.toLowerCase()] || codec;
  }

  function normalizeCodecs(value) {
    const values = Array.isArray(value)
      ? value
      : String(value || "").split(/[,;]/);
    const seen = new Set();
    return values.reduce((codecs, candidate) => {
      const codec = normalizeCodecName(candidate);
      const key = codec.toLowerCase();
      if (!codec || codec === "(null)" || seen.has(key)) return codecs;
      seen.add(key);
      codecs.push(codec);
      return codecs;
    }, []);
  }

  function parseMdlsList(value) {
    const raw = String(value || "").trim();
    if (!raw || raw === "(null)") return [];
    if (!raw.startsWith("(")) return normalizeCodecs(raw);

    const entries = [];
    const contents = raw.replace(/^\s*\(/, "").replace(/\)\s*$/, "");
    const entryPattern = /"((?:\\.|[^"\\])*)"|([^,\s()]+)/g;
    let match;
    while ((match = entryPattern.exec(contents))) {
      entries.push(match[1] === undefined ? match[2] : `"${match[1]}"`);
    }
    return normalizeCodecs(entries);
  }

  function normalizeMetadata(value) {
    const source = value && typeof value === "object" ? value : {};
    const metadata = {};
    [
      "duration", "height", "width", "videoBitRate", "audioBitRate",
      "audioSampleRate", "audioChannels",
    ].forEach((key) => {
      const number = positiveNumber(source[key]);
      if (number !== null) metadata[key] = number;
    });
    const codecs = normalizeCodecs(source.codecs);
    if (codecs.length > 0) metadata.codecs = codecs;
    return metadata;
  }

  function mergeMetadata(...values) {
    const merged = {};
    const codecs = [];
    values.forEach((value) => {
      const metadata = normalizeMetadata(value);
      Object.keys(metadata).forEach((key) => {
        if (key === "codecs") codecs.push(...metadata.codecs);
        else if (merged[key] === undefined) merged[key] = metadata[key];
      });
    });
    if (codecs.length > 0) merged.codecs = codecs;
    return normalizeMetadata(merged);
  }

  function parseMdlsOutput(output) {
    const rawMetadata = {};
    const lines = String(output || "").split(/\r?\n/);
    for (let index = 0; index < lines.length; index++) {
      const line = lines[index];
      const match = line.match(/^\s*(kMDItem\w+)\s*=\s*(.*?)\s*$/);
      if (!match) continue;

      const numericKey = NUMERIC_ATTRIBUTE_MAP[match[1]];
      if (numericKey) {
        const numericValue = positiveNumber(match[2]);
        // Spotlight reports its media bitrate attributes in kilobits per
        // second, while ffprobe reports bits per second. Normalize at the
        // parser boundary so all chip formatting uses one unit.
        rawMetadata[numericKey] = numericKey.endsWith("BitRate") && numericValue !== null
          ? numericValue * 1000
          : match[2];
        continue;
      }

      const listKey = LIST_ATTRIBUTE_MAP[match[1]];
      if (!listKey) continue;
      const valueLines = [match[2]];
      if (match[2].trim().startsWith("(") && !match[2].trim().endsWith(")")) {
        while (++index < lines.length) {
          if (/^\s*kMDItem\w+\s*=/.test(lines[index])) {
            index--;
            break;
          }
          valueLines.push(lines[index]);
          if (lines[index].trim() === ")") break;
        }
      }
      rawMetadata[listKey] = parseMdlsList(valueLines.join("\n"));
    }
    return normalizeMetadata(rawMetadata);
  }

  // ffprobe is an optional fallback for formats Spotlight cannot inspect (most
  // notably Matroska). Keeping its JSON conversion pure makes the fallback easy
  // to test without making ffprobe a required plugin dependency.
  function parseFfprobeOutput(output) {
    let probe;
    try {
      probe = JSON.parse(String(output || ""));
    } catch (err) {
      return {};
    }
    if (!probe || typeof probe !== "object") return {};

    const streams = Array.isArray(probe.streams) ? probe.streams : [];
    const video = streams.find((stream) => stream && stream.codec_type === "video") || {};
    const audio = streams.find((stream) => stream && stream.codec_type === "audio") || {};
    const format = probe.format && typeof probe.format === "object" ? probe.format : {};
    const duration = positiveNumber(format.duration)
      || positiveNumber(video.duration)
      || positiveNumber(audio.duration);
    return normalizeMetadata({
      duration,
      width: video.width,
      height: video.height,
      videoBitRate: video.bit_rate || (video.codec_type ? format.bit_rate : null),
      audioBitRate: audio.bit_rate || (!video.codec_type ? format.bit_rate : null),
      audioSampleRate: audio.sample_rate,
      audioChannels: audio.channels,
      codecs: streams.map((stream) => stream && stream.codec_name).filter(Boolean),
    });
  }

  function formatDuration(seconds) {
    if (!Number.isFinite(seconds) || seconds <= 0) return "";
    const rounded = Math.round(seconds);
    const hours = Math.floor(rounded / 3600);
    const minutes = Math.floor((rounded % 3600) / 60);
    const remainingSeconds = rounded % 60;
    const paddedSeconds = String(remainingSeconds).padStart(2, "0");
    return hours > 0
      ? `${hours}:${String(minutes).padStart(2, "0")}:${paddedSeconds}`
      : `${minutes}:${paddedSeconds}`;
  }

  function formatResolution(width, height) {
    if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) return "";
    return `${Math.round(width)}×${Math.round(height)}`;
  }

  function formatBitRate(bitsPerSecond) {
    if (!Number.isFinite(bitsPerSecond) || bitsPerSecond <= 0) return "";
    if (bitsPerSecond >= 1000000) {
      const megabits = bitsPerSecond / 1000000;
      return `${megabits.toFixed(megabits >= 10 ? 0 : 1)} Mbps`;
    }
    return `${Math.max(1, Math.round(bitsPerSecond / 1000))} kbps`;
  }

  function formatSampleRate(hertz) {
    if (!Number.isFinite(hertz) || hertz <= 0) return "";
    const kilohertz = hertz / 1000;
    return `${Number(kilohertz.toFixed(1))} kHz`;
  }

  function formatChannelCount(channels) {
    if (!Number.isFinite(channels) || channels <= 0) return "";
    const rounded = Math.round(channels);
    if (rounded === 1) return "Mono";
    if (rounded === 2) return "Stereo";
    return `${rounded} ch`;
  }

  function formatCodecs(codecs, limit = 2) {
    const values = normalizeCodecs(codecs);
    if (values.length === 0 || !Number.isFinite(limit) || limit <= 0) return "";
    const visible = values.slice(0, Math.floor(limit));
    const remaining = values.length - visible.length;
    return `${visible.join(" · ")}${remaining > 0 ? ` +${remaining}` : ""}`;
  }

  function getMetadataChips(value, fileType, options = {}) {
    const metadata = normalizeMetadata(value);
    const chips = [];
    const add = (key, text, title) => {
      if (text) chips.push({ key, text, title });
    };

    if (fileType !== "image") add("duration", formatDuration(metadata.duration), "Duration");
    if (fileType !== "audio") {
      add("resolution", formatResolution(metadata.width, metadata.height), "Resolution");
    }
    if (fileType !== "image") add("codecs", formatCodecs(metadata.codecs), "Codecs");

    if (fileType === "audio") {
      if (options.showBitrate) add("bitrate", formatBitRate(metadata.audioBitRate), "Audio bitrate");
      add("sample-rate", formatSampleRate(metadata.audioSampleRate), "Sample rate");
      add("channels", formatChannelCount(metadata.audioChannels), "Audio channels");
    } else if (fileType === "video") {
      if (options.showBitrate) add("bitrate", formatBitRate(metadata.videoBitRate), "Video bitrate");
    }
    return chips;
  }

  return {
    formatBitRate,
    formatChannelCount,
    formatCodecs,
    formatDuration,
    formatResolution,
    formatSampleRate,
    getMetadataChips,
    mergeMetadata,
    normalizeMetadata,
    parseFfprobeOutput,
    parseMdlsOutput,
  };
})();

if (typeof module !== "undefined") {
  module.exports = QuickFoldersMediaMetadata;
}
