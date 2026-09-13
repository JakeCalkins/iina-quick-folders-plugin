const { createAsyncResourceLoader } = require("./async-resource-loader.js");
const FileTypes = require("./file-types.js");

// 128 px is comfortably above the 88 px Retina footprint of the 44 pt tile,
// while keeping bridge payloads and decode work substantially smaller.
const DEFAULT_SIZE = 128;
const DEFAULT_CONCURRENCY = 2;
const DEFAULT_CACHE_LIMIT = 200;
const DEFAULT_CACHE_ROOT = "@tmp/quick-folders-thumbnails";
const QUICK_LOOK_TOOL = "/usr/bin/qlmanage";
const IMAGE_RESIZE_TOOL = "/usr/bin/sips";
const MAKE_DIRECTORY_TOOL = "/bin/mkdir";
const FFMPEG_CANDIDATES = Object.freeze([
  "/opt/homebrew/bin/ffmpeg",
  "/usr/local/bin/ffmpeg",
  "/opt/local/bin/ffmpeg",
]);

// Quick Look can block indefinitely on containers for which macOS has no
// native generator (notably MKV). IINA's process bridge has no cancellation or
// timeout API, so only known-native video containers are submitted to it.
const QUICK_LOOK_VIDEO_EXTENSIONS = new Set(["3gp", "m4v", "mov", "mp4"]);
const QUICK_LOOK_AUDIO_EXTENSIONS = new Set(["aac", "aiff", "flac", "m4a", "mp3", "wav"]);
const QUICK_LOOK_IMAGE_EXTENSIONS = new Set([
  "apng", "bmp", "gif", "heic", "heif", "ico", "jfif", "jpe", "jpeg", "jpg",
  "png", "psd", "tga", "tif", "tiff", "webp",
]);
const QUICK_LOOK_BLOCKED_EXTENSIONS = new Set(["mk3d", "mka", "mkv"]);

const IMAGE_MIME_TYPES = Object.freeze({
  gif: "image/gif",
  jpeg: "image/jpeg",
  jpg: "image/jpeg",
  png: "image/png",
  webp: "image/webp",
});

function encodeBase64(bytes) {
  const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
  let encoded = "";

  for (let index = 0; index < bytes.length; index += 3) {
    const first = bytes[index];
    const second = index + 1 < bytes.length ? bytes[index + 1] : 0;
    const third = index + 2 < bytes.length ? bytes[index + 2] : 0;
    const combined = (first << 16) | (second << 8) | third;

    encoded += alphabet[(combined >> 18) & 63];
    encoded += alphabet[(combined >> 12) & 63];
    encoded += index + 1 < bytes.length ? alphabet[(combined >> 6) & 63] : "=";
    encoded += index + 2 < bytes.length ? alphabet[combined & 63] : "=";
  }

  return encoded;
}

function encodeAscii(value) {
  const bytes = [];
  for (let index = 0; index < value.length; index++) bytes.push(value.charCodeAt(index));
  return encodeBase64(bytes);
}

function hashPath(path) {
  let hash = 2166136261;
  for (let index = 0; index < path.length; index++) {
    hash ^= path.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(16);
}

function joinPath(parent, child) {
  return `${String(parent).replace(/\/+$/, "")}/${child}`;
}

function getEntryName(entry) {
  if (!entry || typeof entry !== "object") return "";
  const name = entry.filename || entry.name || "";
  // Quick Look controls the output directory, but directory listings are still
  // treated as untrusted so an unexpected entry can never escape the job root.
  if (typeof name !== "string" || !name || name === "." || name === ".." || name.includes("/")) return "";
  return name;
}

function getImageMimeType(path) {
  const extension = FileTypes.getExtension(path);
  return IMAGE_MIME_TYPES[extension] || "";
}

function findGeneratedImage(fileApi, outputDirectory) {
  let entries;
  try {
    entries = fileApi.list(outputDirectory, { includeSubDir: false }) || [];
  } catch (err) {
    return null;
  }

  for (let index = 0; index < entries.length; index++) {
    const entry = entries[index];
    if (entry && (entry.isDir || entry.is_dir)) continue;
    const name = getEntryName(entry);
    if (!name || !getImageMimeType(name)) continue;
    return joinPath(outputDirectory, name);
  }
  return null;
}

function readImageDataUrl(fileApi, path) {
  const mimeType = getImageMimeType(path);
  if (!mimeType) return null;

  let handle = null;
  try {
    handle = fileApi.handle(path, "read");
    const bytes = handle.readToEnd();
    if (!bytes || bytes.length === 0) return null;
    return `data:${mimeType};base64,${encodeBase64(bytes)}`;
  } catch (err) {
    return null;
  } finally {
    if (handle) {
      try {
        handle.close();
      } catch (err) {
        // A successful read is still usable when closing a temporary handle fails.
      }
    }
  }
}

function createFallbackThumbnailDataUrl(type) {
  const palette = {
    [FileTypes.FILE_TYPES.VIDEO]: ["#0A84FF", "#64D2FF"],
    [FileTypes.FILE_TYPES.AUDIO]: ["#BF5AF2", "#FF6482"],
    [FileTypes.FILE_TYPES.IMAGE]: ["#30D158", "#66D4CF"],
  };
  const colors = palette[type] || ["#8E8E93", "#AEAEB2"];
  const symbols = {
    [FileTypes.FILE_TYPES.VIDEO]: '<path d="M72 71h112v114H72z" fill="none" stroke="white" stroke-width="12"/><path d="M103 99l55 29-55 29z" fill="white"/>',
    [FileTypes.FILE_TYPES.AUDIO]: '<path d="M105 167V82l76-17v85" fill="none" stroke="white" stroke-width="13" stroke-linecap="round" stroke-linejoin="round"/><ellipse cx="85" cy="172" rx="24" ry="18" fill="white"/><ellipse cx="161" cy="155" rx="24" ry="18" fill="white"/>',
    [FileTypes.FILE_TYPES.IMAGE]: '<rect x="62" y="65" width="132" height="126" rx="12" fill="none" stroke="white" stroke-width="12"/><circle cx="105" cy="105" r="13" fill="white"/><path d="M73 170l38-39 25 24 20-20 27 35z" fill="white"/>',
  };
  const symbol = symbols[type] || '<path d="M78 62h74l31 31v101H78z" fill="none" stroke="white" stroke-width="12"/><path d="M151 63v32h31" fill="none" stroke="white" stroke-width="12"/>';
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="256" height="256" viewBox="0 0 256 256"><defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop stop-color="${colors[0]}"/><stop offset="1" stop-color="${colors[1]}"/></linearGradient></defs><rect width="256" height="256" rx="40" fill="url(#g)"/>${symbol}</svg>`;
  return `data:image/svg+xml;base64,${encodeAscii(svg)}`;
}

function didCommandSucceed(result) {
  return Boolean(result) && Number(result.status) === 0;
}

function shouldUseQuickLook(path, type) {
  const extension = FileTypes.getExtension(path);
  if (QUICK_LOOK_BLOCKED_EXTENSIONS.has(extension)) return false;
  if (type === FileTypes.FILE_TYPES.VIDEO) return QUICK_LOOK_VIDEO_EXTENSIONS.has(extension);
  if (type === FileTypes.FILE_TYPES.AUDIO) return QUICK_LOOK_AUDIO_EXTENSIONS.has(extension);
  if (type === FileTypes.FILE_TYPES.IMAGE) return QUICK_LOOK_IMAGE_EXTENSIONS.has(extension);
  return false;
}

function createThumbnailGenerator(options) {
  const fileApi = options.file;
  const utilsApi = options.utils;
  const isValid = options.isValid || (() => true);
  const size = Math.max(64, Number(options.size) || DEFAULT_SIZE);
  const cacheRoot = options.cacheRoot || DEFAULT_CACHE_ROOT;
  const resolvePath = typeof utilsApi.resolvePath === "function"
    ? (path) => utilsApi.resolvePath(path)
    : (path) => path;
  const resolvedCacheRoot = resolvePath(cacheRoot);
  const sessionId = String(options.sessionId == null ? Date.now() : options.sessionId).replace(/[^a-zA-Z0-9_-]/g, "");
  let sequence = 0;
  let ffmpegChecked = false;
  let ffmpegPath = null;

  async function execute(tool, args) {
    try {
      return await utilsApi.exec(tool, args);
    } catch (err) {
      return null;
    }
  }

  function removeJobDirectory(path) {
    try {
      // file.delete only permits @tmp/@data targets in IINA, which keeps this
      // recursive directory cleanup inside the plugin's own sandbox.
      fileApi.delete(path);
    } catch (err) {
      // Temporary output is expendable and IINA also clears @tmp on shutdown.
    }
  }

  function findFfmpeg() {
    if (ffmpegChecked) return ffmpegPath;
    ffmpegChecked = true;
    if (typeof utilsApi.fileInPath !== "function") return null;
    for (let index = 0; index < FFMPEG_CANDIDATES.length; index++) {
      const candidate = FFMPEG_CANDIDATES[index];
      try {
        if (utilsApi.fileInPath(candidate)) {
          ffmpegPath = candidate;
          break;
        }
      } catch (err) {
        // Continue through the fixed, platform-appropriate install locations.
      }
    }
    return ffmpegPath;
  }

  async function generate(path) {
    const type = FileTypes.getFileTypeByExt(path);
    const fallback = createFallbackThumbnailDataUrl(type);
    if (!isValid(path)) return null;
    const isAuthorized = typeof options.isAuthorized === "function"
      ? options.isAuthorized
      : async () => true;
    if (!await isAuthorized(path)) return null;
    const useQuickLook = shouldUseQuickLook(path, type);
    const canExtractEmbeddedMedia = type === FileTypes.FILE_TYPES.VIDEO || type === FileTypes.FILE_TYPES.AUDIO;
    const frameTool = !useQuickLook && canExtractEmbeddedMedia ? findFfmpeg() : null;
    if (!useQuickLook && !frameTool && type !== FileTypes.FILE_TYPES.IMAGE) return fallback;
    if (typeof resolvedCacheRoot !== "string" || !resolvedCacheRoot) return fallback;

    const jobName = `${hashPath(path)}-${sessionId}-${sequence++}`;
    const jobDirectory = joinPath(cacheRoot, jobName);
    const outputDirectory = joinPath(resolvedCacheRoot, jobName);
    let directoryCreated = false;

    try {
      const mkdirResult = await execute(MAKE_DIRECTORY_TOOL, ["-p", outputDirectory]);
      if (!didCommandSucceed(mkdirResult)) return fallback;
      directoryCreated = true;

      let imagePath = null;
      if (useQuickLook) {
        if (!await isAuthorized(path)) return null;
        // Execute the fixed system path directly. Tool errors are expected on
        // unsupported formats and simply fall through to the next strategy.
        await execute(QUICK_LOOK_TOOL, [
          "-t",
          "-s", String(size),
          "-o", outputDirectory,
          path,
        ]);

        // IINA's file.list returns a directory-relative `path` (such as
        // "/movie.mp4.png"), not the absolute child path. Reconstructing from
        // the safe filename fixes the old root-directory read and traversal risk.
        imagePath = findGeneratedImage(fileApi, outputDirectory);
      } else if (frameTool) {
        if (!await isAuthorized(path)) return null;
        const framePath = joinPath(outputDirectory, "media-preview.png");
        const seekArguments = type === FileTypes.FILE_TYPES.VIDEO ? ["-ss", "1"] : [];
        const frameResult = await execute(frameTool, [
          "-nostdin",
          "-hide_banner",
          "-loglevel", "error",
          ...seekArguments,
          "-i", path,
          // Audio containers expose cover art as an attached video stream. The
          // optional map lets files without artwork fall through cleanly.
          "-map", type === FileTypes.FILE_TYPES.AUDIO ? "0:v:0?" : "0:v:0",
          "-frames:v", "1",
          "-vf", `scale=${size}:${size}:force_original_aspect_ratio=decrease`,
          "-y",
          framePath,
        ]);
        try {
          if (didCommandSucceed(frameResult) && fileApi.exists(framePath)) imagePath = framePath;
        } catch (err) {
          // Fall through to the generated video placeholder.
        }
      }

      // Quick Look coverage varies by image codec. sips provides a lightweight
      // platform fallback which also bounds the decoded image sent to WebKit.
      if (!imagePath && type === FileTypes.FILE_TYPES.IMAGE) {
        if (!await isAuthorized(path)) return null;
        const resizedPath = joinPath(outputDirectory, "image-fallback.png");
        await execute(IMAGE_RESIZE_TOOL, [
          "-s", "format", "png",
          "-Z", String(size),
          path,
          "--out", resizedPath,
        ]);
        try {
          if (fileApi.exists(resizedPath)) imagePath = resizedPath;
        } catch (err) {
          // Fall through to the generated placeholder.
        }
      }

      return (imagePath && readImageDataUrl(fileApi, imagePath)) || fallback;
    } finally {
      if (directoryCreated) removeJobDirectory(jobDirectory);
    }
  }

  return { generate };
}

function createThumbnailService(options) {
  const generator = createThumbnailGenerator(options);
  const loader = createAsyncResourceLoader({
    concurrency: options.concurrency || DEFAULT_CONCURRENCY,
    maxEntries: options.maxEntries || DEFAULT_CACHE_LIMIT,
    isValid: options.isValid,
    // Validate again immediately before touching the filesystem. A queued item
    // may have been moved or deleted after its request was accepted.
    load(path) {
      return options.isValid(path) ? generator.generate(path) : null;
    },
    onCacheHit: options.onCacheHit,
    onCacheMiss: options.onCacheMiss,
    deliver: options.deliver,
  });

  return {
    clear: loader.clear,
    getStats: loader.getStats,
    remove: loader.remove,
    request: loader.request,
  };
}

module.exports = {
  createFallbackThumbnailDataUrl,
  createThumbnailGenerator,
  createThumbnailService,
  findGeneratedImage,
  hashPath,
  readImageDataUrl,
  shouldUseQuickLook,
};
