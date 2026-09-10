const QuickFoldersView = (() => {
  const FileTypes = typeof module !== "undefined"
    ? require("../file-types.js")
    : QuickFoldersFileTypes;

  function stripUserHome(path) {
    return String(path || "").replace(/^\/Users\/[^/]+\//, "");
  }

  function getContainingFolder(path) {
    const normalized = String(path || "").replace(/\/$/, "");
    const lastSlash = normalized.lastIndexOf("/");
    const folder = lastSlash > 0 ? normalized.substring(0, lastSlash) : normalized;
    return stripUserHome(folder);
  }

  function formatFileSize(bytes) {
    if (!Number.isFinite(bytes) || bytes <= 0) return "";
    const units = ["B", "KB", "MB", "GB", "TB"];
    let size = bytes;
    let unitIndex = 0;
    while (size >= 1024 && unitIndex < units.length - 1) {
      size /= 1024;
      unitIndex++;
    }
    return `${size.toFixed(unitIndex === 0 ? 0 : 1)} ${units[unitIndex]}`;
  }

  function getDisplayName(item) {
    if (!item || item.isDir) return item && item.name ? item.name : "";
    const name = String(item.name || "");
    const lastDot = name.lastIndexOf(".");
    return lastDot > 0 ? name.substring(0, lastDot) : name;
  }

  function getFileIcon(filename, isDirectory) {
    if (isDirectory) return FileTypes.FILE_TYPE_ICONS.folder;
    const fileType = FileTypes.getFileTypeByExt(FileTypes.getExtension(filename));
    return FileTypes.FILE_TYPE_ICONS[fileType] || FileTypes.FILE_TYPE_ICONS.file;
  }

  function getExtensionClass(extension) {
    const normalized = FileTypes.normalizeExtension(extension);
    const fileType = FileTypes.getFileTypeByExt(normalized);
    return fileType === FileTypes.FILE_TYPES.OTHER ? "other" : `${fileType}-${normalized}`;
  }

  function truncateMiddle(value, maxLength = 30) {
    const text = String(value || "");
    if (text.length <= maxLength) return text;
    const sideLength = Math.max(1, Math.floor((maxLength - 3) / 2));
    return `${text.substring(0, sideLength)}...${text.substring(text.length - sideLength)}`;
  }

  function getBreadcrumbSegments(currentPath, rootPath) {
    const fullSegments = String(currentPath || "").split("/").filter(Boolean);
    const rootSegments = String(rootPath || "").split("/").filter(Boolean);
    const hasMatchingRoot = rootSegments.length > 0
      && rootSegments.every((segment, index) => fullSegments[index] === segment);
    const startsInUserHome = fullSegments[0] === "Users" && fullSegments.length > 2;
    // Navigation is deliberately bounded to the configured root. Displaying
    // ancestors as buttons made them look broken because the backend correctly
    // rejects paths outside that security boundary.
    const visibleStart = hasMatchingRoot ? rootSegments.length - 1 : (startsInUserHome ? 2 : 0);
    return fullSegments.slice(visibleStart).map((name, index) => ({
      label: truncateMiddle(name),
      path: `/${fullSegments.slice(0, visibleStart + index + 1).join("/")}`,
    }));
  }

  function getEmptyMessage({ state, query, filter, preferences }) {
    const currentState = state || {};
    if (!Array.isArray(currentState.items) || currentState.items.length === 0) {
      if (currentState.viewingWatched) return "No watched items";
      return currentState.atRoot ? "No folders added yet" : "Empty folder";
    }
    if (query) return "No results match your search";
    if (filter && filter !== "all") return "No files match this filter";
    if (preferences && preferences.hideWatched) return "No unwatched items in this folder";
    return "No items to display";
  }

  return {
    formatFileSize,
    getBreadcrumbSegments,
    getContainingFolder,
    getDisplayName,
    getEmptyMessage,
    getExtensionClass,
    getFileIcon,
    stripUserHome,
    truncateMiddle,
  };
})();

if (typeof module !== "undefined") {
  module.exports = QuickFoldersView;
}
