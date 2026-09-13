// Pure directory-level reconciliation for cached file records. Filesystem
// discovery and media classification stay with the caller so this module is
// usable in IINA and dependency-free Node tests.
const QuickFoldersIncrementalIndexState = (() => {
  function normalizeAbsolutePath(path) {
    if (typeof path !== "string" || !path.startsWith("/") || path.includes("\0")) return null;
    const normalized = path === "/" ? "/" : path.replace(/\/+$/, "");
    if (normalized === "/") return normalized;
    const parts = normalized.split("/");
    if (parts.slice(1).some((part) => !part || part === "." || part === "..")) return null;
    return normalized;
  }

  function isPathWithinRoot(path, rootPath) {
    const normalizedPath = normalizeAbsolutePath(path);
    const root = normalizeAbsolutePath(rootPath);
    if (!normalizedPath || !root) return false;
    return root === "/"
      ? normalizedPath.startsWith("/")
      : normalizedPath === root || normalizedPath.startsWith(`${root}/`);
  }

  function parentPath(path) {
    const slashIndex = path.lastIndexOf("/");
    return slashIndex <= 0 ? "/" : path.substring(0, slashIndex);
  }

  function childPath(directoryPath, name) {
    if (
      typeof name !== "string"
      || !name
      || name === "."
      || name === ".."
      || name.includes("/")
      || name.includes("\0")
    ) return null;
    return directoryPath === "/" ? `/${name}` : `${directoryPath}/${name}`;
  }

  function normalizeEntry(entry, directoryPath, rootPath) {
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) return null;
    const name = typeof entry.filename === "string" && entry.filename
      ? entry.filename
      : entry.name;
    const path = childPath(directoryPath, name);
    if (!path || !isPathWithinRoot(path, rootPath)) return null;
    // IINA may expose a directory-relative `path` value. The listing's
    // validated directory and basename are the authority for target identity.

    let isDir = null;
    if (typeof entry.isDir === "boolean") isDir = entry.isDir;
    else if (typeof entry.is_dir === "boolean") isDir = entry.is_dir;
    if (isDir == null) return null;
    return { entry, isDir, name, path };
  }

  function normalizeChangedDirectories(changedDirectories, rootPath) {
    const normalized = new Map();
    (Array.isArray(changedDirectories) ? changedDirectories : []).forEach((snapshot) => {
      if (!snapshot || typeof snapshot !== "object" || !Array.isArray(snapshot.entries)) return;
      const path = normalizeAbsolutePath(snapshot.path);
      if (!path || !isPathWithinRoot(path, rootPath)) return;

      const entries = [];
      const entryPaths = new Set();
      snapshot.entries.forEach((entry) => {
        const current = normalizeEntry(entry, path, rootPath);
        if (!current || entryPaths.has(current.path)) return;
        entryPaths.add(current.path);
        entries.push(current);
      });
      // The most recent valid snapshot is authoritative when discovery reports
      // the same directory more than once in one reconciliation batch.
      normalized.set(path, { path, entries });
    });
    return normalized;
  }

  function immediateChildPath(ancestorPath, descendantPath) {
    const relative = ancestorPath === "/"
      ? descendantPath.substring(1)
      : descendantPath.substring(ancestorPath.length + 1);
    const name = relative.split("/", 1)[0];
    return childPath(ancestorPath, name);
  }

  function isReachableSnapshot(snapshot, snapshots) {
    for (const ancestor of snapshots.values()) {
      if (ancestor.path === snapshot.path || !isPathWithinRoot(snapshot.path, ancestor.path)) continue;
      const branch = immediateChildPath(ancestor.path, snapshot.path);
      const branchExists = ancestor.entries.some((entry) => entry.isDir && entry.path === branch);
      if (!branchExists) return false;
    }
    return true;
  }

  function defaultCreateRecord(entry, context) {
    return {
      ...entry,
      name: context.name,
      path: context.path,
      parentPath: context.parentPath,
      rootPath: context.rootPath,
    };
  }

  function reconcileDirectories({
    files,
    rootPath,
    changedDirectories,
    createRecord = defaultCreateRecord,
  } = {}) {
    const root = normalizeAbsolutePath(rootPath);
    if (!root || typeof createRecord !== "function") return [];

    const records = new Map();
    (Array.isArray(files) ? files : []).forEach((record) => {
      const path = normalizeAbsolutePath(record && record.path);
      if (!path || path === root || !isPathWithinRoot(path, root)) return;
      records.set(path, record);
    });

    const snapshots = normalizeChangedDirectories(changedDirectories, root);
    const orderedSnapshots = Array.from(snapshots.values())
      .filter((snapshot) => isReachableSnapshot(snapshot, snapshots))
      .sort((left, right) => left.path.length - right.path.length || left.path.localeCompare(right.path));

    orderedSnapshots.forEach((snapshot) => {
      const currentFiles = new Set(
        snapshot.entries.filter((entry) => !entry.isDir).map((entry) => entry.path),
      );
      const currentDirectories = new Set(
        snapshot.entries.filter((entry) => entry.isDir).map((entry) => entry.path),
      );

      records.forEach((_record, path) => {
        if (parentPath(path) === snapshot.path) {
          if (!currentFiles.has(path)) records.delete(path);
          return;
        }
        if (!isPathWithinRoot(path, snapshot.path) || path === snapshot.path) return;
        const branch = immediateChildPath(snapshot.path, path);
        if (!currentDirectories.has(branch)) records.delete(path);
      });

      snapshot.entries.filter((entry) => !entry.isDir).forEach((current) => {
        const previousRecord = records.get(current.path) || null;
        const context = {
          name: current.name,
          path: current.path,
          parentPath: snapshot.path,
          rootPath: root,
          previousRecord,
        };
        const created = createRecord(current.entry, context);
        if (!created || typeof created !== "object" || Array.isArray(created)) {
          records.delete(current.path);
          return;
        }
        records.set(current.path, {
          ...created,
          name: current.name,
          path: current.path,
          parentPath: snapshot.path,
          rootPath: root,
        });
      });
    });

    return Array.from(records.values()).sort((left, right) => left.path.localeCompare(right.path));
  }

  return {
    isPathWithinRoot,
    normalizeAbsolutePath,
    reconcileDirectories,
  };
})();

if (typeof module !== "undefined") {
  module.exports = QuickFoldersIncrementalIndexState;
}
