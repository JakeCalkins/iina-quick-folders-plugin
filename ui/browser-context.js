// Pure validation and migration for the browser state persisted by main.js.
// Only explicitly listed fields survive normalization; selections and other
// transient UI state are intentionally never serialized.
const QuickFoldersBrowserContext = (() => {
  const VERSION = 1;
  const DEFAULT_MAX_RECENTS = 12;
  const DEFAULT_MAX_QUERY_LENGTH = 512;
  const DEFAULT_SMART_VIEWS = Object.freeze([
    "continue",
    "recent",
    "series",
    "unwatched",
    "watched",
  ]);
  const LAYOUTS = new Set(["list", "grid"]);

  function boundedString(value, maxLength) {
    return typeof value === "string" ? value.substring(0, maxLength) : "";
  }

  function normalizeRootPaths(roots) {
    const values = Array.isArray(roots) ? roots : [];
    return values.reduce((paths, root) => {
      const path = typeof root === "string" ? root : root && root.path;
      if (isAbsoluteSafePath(path)) paths.push(path === "/" ? "/" : path.replace(/\/+$/, ""));
      return paths;
    }, []);
  }

  function isAbsoluteSafePath(path) {
    return typeof path === "string"
      && path.startsWith("/")
      && !path.includes("\0")
      && !path.split("/").includes("..");
  }

  function isPathWithinRoots(path, rootPaths) {
    if (!isAbsoluteSafePath(path)) return false;
    return rootPaths.some((rootPath) => (
      rootPath === "/" || path === rootPath || path.startsWith(`${rootPath}/`)
    ));
  }

  function getSmartViews(options) {
    const values = Array.isArray(options.smartViewIds)
      ? options.smartViewIds
      : DEFAULT_SMART_VIEWS;
    return new Set(values
      .filter((value) => typeof value === "string" && value.length > 0)
      .map(normalizeSmartViewId));
  }

  function normalizeSmartViewId(value) {
    if (value === "continue-watching") return "continue";
    if (value === "recently-added") return "recent";
    return value;
  }

  function normalizeLocation(value, options = {}) {
    const location = value && typeof value === "object" ? value : {};
    const rootPaths = normalizeRootPaths(options.roots);
    const kind = location.kind
      || (typeof location.view === "string" ? "smart" : null)
      || (typeof location.path === "string" ? "folder" : null);
    if (kind === "folder" && isPathWithinRoots(location.path, rootPaths)) {
      return { kind: "folder", path: location.path };
    }
    if (
      kind === "smart" &&
      typeof (location.viewId || location.view) === "string"
    ) {
      const viewId = normalizeSmartViewId(location.viewId || location.view);
      if (getSmartViews(options).has(viewId)) return { kind: "smart", viewId };
    }
    return { kind: "root" };
  }

  function locationKey(location) {
    if (!location || location.kind === "root") return "root";
    if (location.kind === "folder") return `folder:${location.path}`;
    if (location.kind === "smart") return `smart:${location.viewId}`;
    return "root";
  }

  function normalizeFilter(value, options = {}) {
    if (value === "all") return "all";
    if (["video", "audio", "image"].includes(value)) {
      return !Array.isArray(options.availableMediaTypes) || options.availableMediaTypes.includes(value)
        ? value
        : "all";
    }
    const match = typeof value === "string" && value.match(/^ext:([a-z0-9]+)$/i);
    if (!match) return "all";
    const extension = match[1].toLowerCase();
    if (Array.isArray(options.availableExtensions)) {
      const available = new Set(options.availableExtensions.map((entry) => String(entry).toLowerCase()));
      if (!available.has(extension)) return "all";
    }
    return `ext:${extension}`;
  }

  function normalizeAnchor(value, options = {}) {
    if (!value || typeof value !== "object") return null;
    const rootPaths = normalizeRootPaths(options.roots);
    if (!isPathWithinRoots(value.path, rootPaths)) return null;
    const offset = Number(value.offset);
    return {
      path: value.path,
      offset: Number.isFinite(offset) ? Math.max(-10000, Math.min(10000, offset)) : 0,
    };
  }

  function normalizeRecentLocations(values, options = {}) {
    const requestedLimit = Number(options.maxRecents);
    const maxRecents = Math.floor(Math.max(0, Math.min(
      50,
      Number.isFinite(requestedLimit) ? requestedLimit : DEFAULT_MAX_RECENTS,
    )));
    const seen = new Set();
    const recents = [];
    (Array.isArray(values) ? values : []).forEach((value) => {
      const location = normalizeLocation(value, options);
      const key = locationKey(location);
      if (key === "root" || seen.has(key) || recents.length >= maxRecents) return;
      seen.add(key);
      recents.push(location);
    });
    return recents;
  }

  function createDefault() {
    return {
      version: VERSION,
      location: { kind: "root" },
      query: "",
      filter: "all",
      layout: "list",
      focusedPath: null,
      scrollAnchor: null,
      recentLocations: [],
    };
  }

  function reconcile(value, options = {}) {
    const source = value && typeof value === "object" ? value : {};
    const maxQueryLength = Math.max(
      1,
      Math.min(4096, Number(options.maxQueryLength) || DEFAULT_MAX_QUERY_LENGTH),
    );
    const legacyPath = source.path || source.currentPath;
    const legacyView = source.view || source.viewId;
    const legacyLocation = typeof legacyView === "string"
      ? { kind: "smart", viewId: legacyView }
      : isAbsoluteSafePath(legacyPath) ? { kind: "folder", path: legacyPath } : null;
    const anchorSource = source.scrollAnchor && typeof source.scrollAnchor === "object"
      ? source.scrollAnchor
      : typeof source.scrollAnchor === "string"
        ? { path: source.scrollAnchor, offset: source.scrollOffset }
        : null;
    return {
      version: VERSION,
      location: normalizeLocation(source.location || legacyLocation, options),
      query: boundedString(source.query ?? source.searchQuery, maxQueryLength),
      filter: normalizeFilter(source.filter ?? source.currentFilter, options),
      layout: LAYOUTS.has(source.layout || source.layoutMode) ? source.layout || source.layoutMode : "list",
      focusedPath: isPathWithinRoots(source.focusedPath, normalizeRootPaths(options.roots))
        ? source.focusedPath
        : null,
      scrollAnchor: normalizeAnchor(anchorSource, options),
      recentLocations: normalizeRecentLocations(source.recentLocations || source.recents, options),
    };
  }

  function addRecentLocation(context, location, options = {}) {
    const current = reconcile(context, options);
    const nextLocation = normalizeLocation(location, options);
    if (nextLocation.kind === "root") return current;
    return reconcile({
      ...current,
      recentLocations: [nextLocation, ...current.recentLocations],
    }, options);
  }

  function serialize(value, options = {}) {
    return JSON.stringify(reconcile(value, options));
  }

  function toPersistence(value, options = {}) {
    const context = reconcile(value, options);
    return {
      version: VERSION,
      view: context.location.kind === "smart" ? context.location.viewId : null,
      path: context.location.kind === "folder" ? context.location.path : null,
      query: context.query,
      filter: context.filter,
      layout: context.layout,
      focusedPath: context.focusedPath,
      scrollAnchor: context.scrollAnchor ? context.scrollAnchor.path : null,
      scrollOffset: context.scrollAnchor ? context.scrollAnchor.offset : 0,
      recents: context.recentLocations.map((location) => ({
        view: location.kind === "smart" ? location.viewId : null,
        path: location.kind === "folder" ? location.path : null,
      })),
    };
  }

  function deserialize(value, options = {}) {
    if (value && typeof value === "object") return reconcile(value, options);
    try {
      return reconcile(JSON.parse(String(value || "")), options);
    } catch (error) {
      return createDefault();
    }
  }

  return {
    DEFAULT_MAX_RECENTS,
    DEFAULT_SMART_VIEWS,
    VERSION,
    addRecentLocation,
    createDefault,
    deserialize,
    isPathWithinRoots,
    locationKey,
    normalizeLocation,
    reconcile,
    serialize,
    toPersistence,
  };
})();

if (typeof module !== "undefined") {
  module.exports = QuickFoldersBrowserContext;
}
