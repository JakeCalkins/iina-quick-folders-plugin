const QuickFoldersBrowseState = (() => {
  const FileTypes = typeof module !== "undefined"
    ? require("./file-types.js")
    : QuickFoldersFileTypes;
  function normalizePaths(paths) {
    if (!Array.isArray(paths)) return [];
    const unique = new Set();
    paths.forEach((path) => {
      if (typeof path === "string" && path.length > 0) unique.add(path);
    });
    return Array.from(unique);
  }

  function isPathWithinRoots(path, roots) {
    if (typeof path !== "string" || !path.startsWith("/")) return false;
    if (path.includes("\0") || path.split("/").includes("..")) return false;

    return (Array.isArray(roots) ? roots : []).some((root) => {
      if (!root || typeof root.path !== "string") return false;
      if (!root.path.startsWith("/") || root.path.includes("\0") || root.path.split("/").includes("..")) return false;
      const rootPath = root.path === "/" ? "/" : root.path.replace(/\/+$/, "");
      return rootPath === "/"
        ? path.startsWith("/")
        : path === rootPath || path.startsWith(rootPath + "/");
    });
  }

  function getAncestorLocations(currentPath, rootPath) {
    if (!isPathWithinRoots(currentPath, [{ path: rootPath }]) || currentPath === rootPath) return [];
    const normalizedRoot = rootPath === "/" ? "" : rootPath.replace(/\/+$/, "");
    const relativeSegments = currentPath.substring(normalizedRoot.length).split("/").filter(Boolean);
    return relativeSegments.map((_segment, index) => {
      const suffix = relativeSegments.slice(0, index).join("/");
      return suffix ? `${normalizedRoot}/${suffix}` : (normalizedRoot || "/");
    });
  }

  function partitionWatched(items) {
    const active = [];
    const watched = [];
    (Array.isArray(items) ? items : []).forEach((item) => {
      if (item && !item.isDir && item.watched) watched.push(item);
      else active.push(item);
    });
    return { active, watched };
  }

  function groupAvailableExtensions(extensions, preferences) {
    const groups = { video: [], audio: [], image: [] };
    const seen = new Set();
    const currentPreferences = preferences || {};
    (Array.isArray(extensions) ? extensions : []).forEach((extension) => {
      const normalized = FileTypes.normalizeExtension(extension);
      if (!normalized || seen.has(normalized)) return;
      seen.add(normalized);

      const fileType = FileTypes.getFileTypeByExt(normalized);
      if (fileType === FileTypes.FILE_TYPES.VIDEO) {
        groups.video.push(normalized);
      } else if (fileType === FileTypes.FILE_TYPES.AUDIO) {
        if (!currentPreferences.videoOnly && !currentPreferences.filterAudio) groups.audio.push(normalized);
      } else if (fileType === FileTypes.FILE_TYPES.IMAGE) {
        if (!currentPreferences.videoOnly && !currentPreferences.filterImages) groups.image.push(normalized);
      }
    });
    return groups;
  }

  function reconcileExtensionFilter(currentFilter, groups) {
    if (currentFilter === "all") return "all";
    if (["video", "audio", "image"].includes(currentFilter)) {
      return Array.isArray(groups && groups[currentFilter]) && groups[currentFilter].length > 0
        ? currentFilter
        : "all";
    }
    const availableFilters = new Set();
    Object.keys(groups || {}).forEach((group) => {
      (groups[group] || []).forEach((extension) => availableFilters.add(`ext:${extension}`));
    });
    return availableFilters.has(currentFilter) ? currentFilter : "all";
  }

  function matchesFileFilter(item, currentFilter, classifyExtension) {
    if (!item || currentFilter === "all" || item.isDir) return Boolean(item);
    const extension = FileTypes.getExtension(item.name);
    if (currentFilter.startsWith("ext:")) {
      return extension === currentFilter.substring(4).toLowerCase();
    }
    const classifier = typeof classifyExtension === "function"
      ? classifyExtension
      : FileTypes.getFileTypeByExt;
    return classifier(extension) === currentFilter;
  }

  function updateSelection(options) {
    const visiblePaths = normalizePaths(options && options.visiblePaths);
    const targetPath = options && options.targetPath;
    const current = new Set(normalizePaths(options && options.selectedPaths));
    const targetIndex = visiblePaths.indexOf(targetPath);
    if (targetIndex === -1) {
      return { selectedPaths: Array.from(current), anchorPath: options && options.anchorPath };
    }

    if (options && options.range && options.anchorPath) {
      const anchorIndex = visiblePaths.indexOf(options.anchorPath);
      if (anchorIndex !== -1) {
        const next = options.additive ? current : new Set();
        const start = Math.min(anchorIndex, targetIndex);
        const end = Math.max(anchorIndex, targetIndex);
        for (let index = start; index <= end; index++) next.add(visiblePaths[index]);
        return { selectedPaths: Array.from(next), anchorPath: options.anchorPath };
      }
    }

    if (options && options.additive) {
      if (current.has(targetPath)) current.delete(targetPath);
      else current.add(targetPath);
      return { selectedPaths: Array.from(current), anchorPath: targetPath };
    }

    return { selectedPaths: [targetPath], anchorPath: targetPath };
  }

  return {
    getAncestorLocations,
    groupAvailableExtensions,
    isPathWithinRoots,
    matchesFileFilter,
    normalizePaths,
    partitionWatched,
    reconcileExtensionFilter,
    updateSelection,
  };
})();

if (typeof module !== "undefined") {
  module.exports = QuickFoldersBrowseState;
}
