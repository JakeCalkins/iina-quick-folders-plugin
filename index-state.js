// Pure, JSON-compatible index snapshot operations. Filesystem traversal stays
// in main.js; this module only validates and atomically merges scan results.
const QuickFoldersIndexState = (() => {
  const SCHEMA_VERSION = 1;
  const ROOT_STATUSES = new Set(["ready", "stale", "unavailable"]);
  const ROOT_ERROR_CODES = new Set([
    "cancelled", "invalid-response", "not-found", "permission-denied", "scan-failed", "unknown",
  ]);
  const FILE_FIELDS = [
    "name", "type", "ext", "parentPath", "rootPath", "size",
    "duration", "width", "height",
    "seriesKey", "seriesTitle", "seriesPath", "seasonNumber",
    "episodeNumber", "endEpisodeNumber", "episodePart",
  ];

  function isSafeAbsolutePath(path) {
    return typeof path === "string"
      && path.startsWith("/")
      && !path.includes("\0")
      && !path.split("/").includes("..");
  }

  function normalizeRootPath(path) {
    if (!isSafeAbsolutePath(path)) return null;
    return path === "/" ? "/" : path.replace(/\/+$/, "");
  }

  function isPathWithinRoot(path, rootPath) {
    const root = normalizeRootPath(rootPath);
    if (!root || !isSafeAbsolutePath(path)) return false;
    return root === "/" ? path.startsWith("/") : path === root || path.startsWith(`${root}/`);
  }

  function finiteNonNegative(value) {
    if (value === null || value === "" || typeof value === "boolean") return null;
    const number = Number(value);
    return Number.isFinite(number) && number >= 0 ? number : null;
  }

  function nonNegativeInteger(value) {
    if (value === null || value === "" || typeof value === "boolean") return null;
    const number = Number(value);
    return Number.isInteger(number) && number >= 0 ? number : null;
  }

  function parentPath(path) {
    const slashIndex = path.lastIndexOf("/");
    return slashIndex <= 0 ? "/" : path.substring(0, slashIndex);
  }

  function basename(path) {
    return path.substring(path.lastIndexOf("/") + 1);
  }

  function optionalString(value) {
    return typeof value === "string" && value.length > 0 ? value : null;
  }

  function normalizeFileRecord(item, rootPath, discoveredAt = null) {
    if (!item || typeof item !== "object") return null;
    const root = normalizeRootPath(rootPath || item.rootPath);
    const path = item.path;
    if (!root || !isPathWithinRoot(path, root) || path === root) return null;
    const fallbackName = basename(path);
    const name = optionalString(item.name) || fallbackName;
    if (!name || name.includes("/") || name === "." || name === "..") return null;

    const record = {
      path,
      name,
      type: optionalString(item.type),
      ext: optionalString(item.ext),
      parentPath: isPathWithinRoot(item.parentPath, root) ? item.parentPath : parentPath(path),
      rootPath: root,
      firstSeenAt: finiteNonNegative(item.firstSeenAt),
    };
    if (record.firstSeenAt == null) record.firstSeenAt = finiteNonNegative(discoveredAt);

    const size = finiteNonNegative(item.size);
    if (size != null) record.size = size;
    ["duration", "width", "height"].forEach((field) => {
      const value = finiteNonNegative(item[field]);
      if (value != null) record[field] = value;
    });
    ["seriesKey", "seriesTitle", "seriesPath"].forEach((field) => {
      const value = optionalString(item[field]);
      if (value) record[field] = value;
    });
    ["seasonNumber", "episodeNumber", "endEpisodeNumber", "episodePart"].forEach((field) => {
      const value = nonNegativeInteger(item[field]);
      if (value != null) record[field] = value;
    });
    return record;
  }

  function normalizeErrorCode(value) {
    return ROOT_ERROR_CODES.has(value) ? value : null;
  }

  function normalizeMarkerToken(value) {
    return typeof value === "string" && /^overlap-1:\d+-[0-9a-f]+$/.test(value)
      ? value
      : null;
  }

  function normalizeRootSnapshot(rootSnapshot, rootPath) {
    const root = normalizeRootPath(rootPath || (rootSnapshot && rootSnapshot.path));
    if (!root) return null;
    const source = rootSnapshot && typeof rootSnapshot === "object" ? rootSnapshot : {};
    const byPath = new Map();
    (Array.isArray(source.files) ? source.files : []).forEach((item) => {
      const record = normalizeFileRecord(item, root);
      if (record) byPath.set(record.path, record);
    });
    const normalized = {
      path: root,
      status: ROOT_STATUSES.has(source.status) ? source.status : "stale",
      lastAttemptAt: finiteNonNegative(source.lastAttemptAt),
      lastSuccessfulAt: finiteNonNegative(source.lastSuccessfulAt),
      files: Array.from(byPath.values()).sort((left, right) => left.path.localeCompare(right.path)),
    };
    const errorCode = normalizeErrorCode(source.errorCode);
    if (errorCode) normalized.errorCode = errorCode;
    const markerSlot = nonNegativeInteger(source.markerSlot);
    if (markerSlot === 0 || markerSlot === 1) normalized.markerSlot = markerSlot;
    const markerToken = normalizeMarkerToken(source.markerToken);
    if (markerToken) normalized.markerToken = markerToken;
    return normalized;
  }

  function createSnapshot(configKey = "") {
    return {
      version: SCHEMA_VERSION,
      configKey: typeof configKey === "string" ? configKey : "",
      builtAt: null,
      roots: {},
    };
  }

  function normalizeSnapshot(snapshot) {
    const source = snapshot && typeof snapshot === "object" ? snapshot : {};
    const normalized = createSnapshot(source.configKey);
    normalized.builtAt = finiteNonNegative(source.builtAt);
    if (!source.roots || typeof source.roots !== "object" || Array.isArray(source.roots)) return normalized;
    Object.keys(source.roots).sort().forEach((rootPath) => {
      const root = normalizeRootSnapshot(source.roots[rootPath], rootPath);
      if (root) normalized.roots[root.path] = root;
    });
    return normalized;
  }

  function comparableFile(record) {
    const comparable = { path: record.path };
    FILE_FIELDS.forEach((field) => {
      if (record[field] !== undefined) comparable[field] = record[field];
    });
    return JSON.stringify(comparable);
  }

  function mergeRoot(snapshot, rootPath, scanResult, options = {}) {
    const normalized = normalizeSnapshot(snapshot);
    const root = normalizeRootPath(rootPath);
    if (!root) {
      return {
        snapshot: normalized,
        changed: false,
        filesChanged: false,
        statusChanged: false,
        diff: { added: [], removed: [], updated: [] },
      };
    }

    const attemptedAt = finiteNonNegative(options.now);
    const previous = normalized.roots[root] || normalizeRootSnapshot({}, root);
    const result = Array.isArray(scanResult) ? { ok: true, files: scanResult } : (scanResult || {});
    if (result.ok !== true) {
      const next = {
        ...previous,
        status: "unavailable",
        lastAttemptAt: attemptedAt,
      };
      const errorCode = normalizeErrorCode(result.errorCode) || "scan-failed";
      next.errorCode = errorCode;
      normalized.roots[root] = next;
      const statusChanged = previous.status !== next.status || previous.errorCode !== next.errorCode;
      return {
        snapshot: normalized,
        changed: statusChanged,
        filesChanged: false,
        statusChanged,
        diff: { added: [], removed: [], updated: [] },
      };
    }

    const previousByPath = new Map(previous.files.map((item) => [item.path, item]));
    const nextByPath = new Map();
    (Array.isArray(result.files) ? result.files : []).forEach((item) => {
      const record = normalizeFileRecord(item, root, attemptedAt);
      if (!record) return;
      const old = previousByPath.get(record.path);
      // A null timestamp is an intentional migration baseline: it prevents an
      // existing library from appearing wholly "recent" on the first new scan.
      if (old) record.firstSeenAt = old.firstSeenAt;
      if (old) {
        ["duration", "width", "height"].forEach((field) => {
          if (record[field] == null && old[field] != null) record[field] = old[field];
        });
      }
      nextByPath.set(record.path, record);
    });

    const added = [];
    const removed = [];
    const updated = [];
    nextByPath.forEach((record, path) => {
      const old = previousByPath.get(path);
      if (!old) added.push(path);
      else if (comparableFile(old) !== comparableFile(record)) updated.push(path);
    });
    previousByPath.forEach((_record, path) => {
      if (!nextByPath.has(path)) removed.push(path);
    });
    added.sort();
    removed.sort();
    updated.sort();

    const statusChanged = previous.status !== "ready" || Boolean(previous.errorCode);
    const filesChanged = added.length > 0 || removed.length > 0 || updated.length > 0;
    const markerSlot = nonNegativeInteger(result.markerSlot);
    normalized.roots[root] = {
      path: root,
      status: "ready",
      lastAttemptAt: attemptedAt,
      lastSuccessfulAt: attemptedAt,
      files: Array.from(nextByPath.values()).sort((left, right) => left.path.localeCompare(right.path)),
    };
    const nextMarkerSlot = markerSlot === 0 || markerSlot === 1 ? markerSlot : previous.markerSlot;
    if (nextMarkerSlot === 0 || nextMarkerSlot === 1) normalized.roots[root].markerSlot = nextMarkerSlot;
    const markerToken = markerSlot === 0 || markerSlot === 1
      ? normalizeMarkerToken(result.markerToken)
      : previous.markerToken;
    if (markerToken) normalized.roots[root].markerToken = markerToken;
    normalized.builtAt = attemptedAt;
    return {
      snapshot: normalized,
      changed: statusChanged || filesChanged,
      filesChanged,
      statusChanged,
      diff: { added, removed, updated },
    };
  }

  function markRootStale(snapshot, rootPath) {
    const normalized = normalizeSnapshot(snapshot);
    const root = normalizeRootPath(rootPath);
    if (!root || !normalized.roots[root]) return normalized;
    normalized.roots[root] = { ...normalized.roots[root], status: "stale" };
    delete normalized.roots[root].errorCode;
    return normalized;
  }

  function removeRoot(snapshot, rootPath) {
    const normalized = normalizeSnapshot(snapshot);
    const root = normalizeRootPath(rootPath);
    if (root) delete normalized.roots[root];
    return normalized;
  }

  function getFilesFromNormalizedSnapshot(normalized) {
    const byPath = new Map();
    Object.keys(normalized && normalized.roots || {})
      .sort((left, right) => right.length - left.length || left.localeCompare(right))
      .forEach((rootPath) => {
        normalized.roots[rootPath].files.forEach((record) => {
          if (!byPath.has(record.path)) byPath.set(record.path, record);
        });
      });
    return Array.from(byPath.values()).sort((left, right) => left.path.localeCompare(right.path));
  }

  function getFiles(snapshot) {
    return getFilesFromNormalizedSnapshot(normalizeSnapshot(snapshot));
  }

  function getExtensions(snapshot) {
    return Array.from(new Set(getFiles(snapshot).map((item) => item.ext).filter(Boolean))).sort();
  }

  function isCompatible(snapshot, configKey) {
    return Boolean(snapshot)
      && Number(snapshot.version) === SCHEMA_VERSION
      && typeof configKey === "string"
      && snapshot.configKey === configKey;
  }

  return {
    SCHEMA_VERSION,
    createSnapshot,
    getExtensions,
    getFiles,
    getFilesFromNormalizedSnapshot,
    isCompatible,
    isPathWithinRoot,
    markRootStale,
    mergeRoot,
    normalizeFileRecord,
    normalizeRootPath,
    normalizeSnapshot,
    removeRoot,
  };
})();

if (typeof module !== "undefined") {
  module.exports = QuickFoldersIndexState;
}
