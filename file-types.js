// Single source of truth shared by the IINA backend and browser UI.
const QuickFoldersFileTypes = (() => {
  const FILE_TYPES = Object.freeze({
    VIDEO: "video",
    AUDIO: "audio",
    IMAGE: "image",
    OTHER: "other",
  });

  // Keep this allowlist aligned with formats IINA advertises or decodes through
  // mpv. Ambiguous document and playlist extensions remain excluded so a file
  // never becomes actionable merely because IINA has a wildcard association.
  const EXTENSIONS_BY_TYPE = Object.freeze({
    [FILE_TYPES.VIDEO]: new Set([
      "3g2", "3gp", "amv", "asf", "avi", "divx", "dv", "f4v", "flv",
      "m1v", "m2t", "m2ts", "m2v", "m4v", "mcf", "mk3d", "mkv", "mov", "mp4",
      "mpe", "mpeg", "mpg",
      "mts", "mxf", "ogm", "ogv", "qt", "rm", "rmvb", "swf", "ts", "vob",
      "webm", "wmv", "xvid", "y4m", "yuv",
    ]),
    [FILE_TYPES.AUDIO]: new Set([
      "aa3", "aac", "ac3", "acm", "aif", "aifc", "aiff", "alac", "amr", "ape",
      "au", "caf", "dts", "eac3", "f4a", "f4b", "flac", "m4a", "m4b", "mka",
      "mp2", "mp3", "oga", "ogg", "opus", "pcm", "ra", "snd", "tak", "tta",
      "vox", "wav", "wave", "wma", "wv",
    ]),
    [FILE_TYPES.IMAGE]: new Set([
      "apng", "avif", "bmp", "exr", "gif", "heic", "heif", "ico", "jfif", "jp2",
      "jpe", "jpeg", "jpg", "jxl", "pbm", "pgm", "png", "ppm", "psd", "qoi",
      "svg", "tga", "tif", "tiff", "webp",
    ]),
  });

  const SKIP_DIRECTORIES = new Set([
    ".app", ".bundle", ".framework", ".plugin", ".component",
    "node_modules", "__pycache__", ".venv", "venv",
    ".git", ".svn", ".hg", ".idea", ".vscode",
    "build", "dist", "out", "bin", "target",
    ".logicx", ".band", ".serato", ".xcodeproj", ".xcworkspace",
    "Caches", ".cache", "vendor", ".gem", "Databases", "Tags", ".Trash", "Library", ".Spotlight-V100",
  ]);

  const SKIP_EXTENSIONS = new Set([
    "ds_store", "localized", "plist", "json", "xml", "yaml", "yml", "ini", "cfg", "conf",
    "txt", "md", "pdf", "doc", "docx", "rtf", "pages",
    "js", "ts", "py", "java", "c", "cpp", "h", "hpp", "swift", "sh", "bash",
    "zip", "rar", "7z", "tar", "gz", "bz2", "xz",
    "db", "sqlite", "sql", "cache", "tmp", "temp",
    "tagset", "tagpool", "asd", "als", "logic", "ptx", "sessiondata",
    "log", "bak", "old", "swp", "swo",
  ]);

  const FILE_TYPE_ICONS = Object.freeze({
    video: "􀎶",
    audio: "􀑪",
    image: "􀏅",
    folder: "􀈖",
    file: "􀈷",
  });

  function getExtension(value) {
    const text = String(value || "");
    const lastSlash = Math.max(text.lastIndexOf("/"), text.lastIndexOf("\\"));
    const name = text.substring(lastSlash + 1);
    const lastDot = name.lastIndexOf(".");
    if (lastDot <= 0 || lastDot === name.length - 1) return "";
    return name.substring(lastDot + 1).toLowerCase();
  }

  function normalizeExtension(value) {
    const text = String(value || "").trim().toLowerCase();
    if (!text) return "";
    if (text.startsWith(".") && text.indexOf(".", 1) === -1 && !text.includes("/") && !text.includes("\\")) {
      return text.substring(1);
    }
    return getExtension(text) || (/^[a-z0-9]+$/.test(text) ? text : "");
  }

  function getFileTypeByExt(value) {
    const extension = normalizeExtension(value);
    if (EXTENSIONS_BY_TYPE[FILE_TYPES.VIDEO].has(extension)) return FILE_TYPES.VIDEO;
    if (EXTENSIONS_BY_TYPE[FILE_TYPES.AUDIO].has(extension)) return FILE_TYPES.AUDIO;
    if (EXTENSIONS_BY_TYPE[FILE_TYPES.IMAGE].has(extension)) return FILE_TYPES.IMAGE;
    return FILE_TYPES.OTHER;
  }

  function getSupportedExtensions(fileType) {
    const extensions = EXTENSIONS_BY_TYPE[fileType];
    return extensions ? Array.from(extensions).sort() : [];
  }

  function isPlayableFile(filename) {
    if (!filename || String(filename).startsWith(".")) return false;
    const extension = getExtension(filename);
    return Boolean(extension) && !SKIP_EXTENSIONS.has(extension) && getFileTypeByExt(extension) !== FILE_TYPES.OTHER;
  }

  function shouldShowFile(filename, preferences) {
    if (!isPlayableFile(filename)) return false;
    const fileType = getFileTypeByExt(getExtension(filename));
    const currentPreferences = preferences || {};
    if (currentPreferences.videoOnly) return fileType === FILE_TYPES.VIDEO;
    if (currentPreferences.filterAudio && fileType === FILE_TYPES.AUDIO) return false;
    if (currentPreferences.filterImages && fileType === FILE_TYPES.IMAGE) return false;
    return true;
  }

  return {
    FILE_TYPES,
    FILE_TYPE_ICONS,
    SKIP_DIRECTORIES,
    getExtension,
    getFileTypeByExt,
    getSupportedExtensions,
    isPlayableFile,
    normalizeExtension,
    shouldShowFile,
  };
})();

if (typeof module !== "undefined") {
  module.exports = QuickFoldersFileTypes;
}
