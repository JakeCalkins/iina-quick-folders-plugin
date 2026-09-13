const BrowseState = require("./browse-state.js");

// IINA's file API follows symbolic links but does not expose lstat. Ask the
// fixed macOS stat binary for every path component so a configured-root check
// cannot be bypassed by placing a symlink anywhere in the path.
const QuickFoldersPathSecurity = (() => {
  const STAT_TOOL = "/usr/bin/stat";
  const MAX_STAT_ARGUMENT_CHARS = 60_000;

  function getAbsolutePathPrefixes(path) {
    if (typeof path !== "string" || !path.startsWith("/") || path.includes("\0")) return [];
    const segments = path.split("/").filter(Boolean);
    if (segments.some((segment) => segment === "." || segment === "..")) return [];
    const prefixes = ["/"];
    let current = "";
    segments.forEach((segment) => {
      current += `/${segment}`;
      prefixes.push(current);
    });
    return prefixes;
  }

  async function hasSymlinkComponent(path, utilsApi) {
    const prefixes = getAbsolutePathPrefixes(path);
    if (prefixes.length === 0 || !utilsApi || typeof utilsApi.exec !== "function") return true;
    try {
      const result = await utilsApi.exec(STAT_TOOL, ["-f", "%p", ...prefixes]);
      if (!result || Number(result.status) !== 0) return true;
      const types = String(result.stdout || "").split(/\r?\n/).filter(Boolean);
      return types.length !== prefixes.length || types.some((type) => /^120/.test(type));
    } catch (err) {
      return true;
    }
  }

  async function isPathWithinRootsWithoutSymlinks(path, roots, utilsApi) {
    if (!BrowseState.isPathWithinRoots(path, roots)) return false;
    return !await hasSymlinkComponent(path, utilsApi);
  }

  async function getPathsWithinRootsWithoutSymlinks(paths, roots, utilsApi) {
    const candidates = BrowseState.normalizePaths(paths).filter((path) => (
      BrowseState.isPathWithinRoots(path, roots) && getAbsolutePathPrefixes(path).length > 0
    ));
    if (candidates.length === 0 || !utilsApi || typeof utilsApi.exec !== "function") return [];

    const batches = [];
    let batch = [];
    let batchSize = 0;
    candidates.forEach((path) => {
      const pathSize = getAbsolutePathPrefixes(path).reduce((total, prefix) => total + prefix.length + 1, 0);
      if (batch.length > 0 && batchSize + pathSize > MAX_STAT_ARGUMENT_CHARS) {
        batches.push(batch);
        batch = [];
        batchSize = 0;
      }
      batch.push(path);
      batchSize += pathSize;
    });
    if (batch.length > 0) batches.push(batch);

    const safe = [];
    for (const currentBatch of batches) {
      const prefixSet = new Set();
      currentBatch.forEach((path) => {
        getAbsolutePathPrefixes(path).forEach((prefix) => prefixSet.add(prefix));
      });
      const prefixes = Array.from(prefixSet);
      try {
        const result = await utilsApi.exec(STAT_TOOL, ["-f", "%p", ...prefixes]);
        const types = result && Number(result.status) === 0
          ? String(result.stdout || "").split(/\r?\n/).filter(Boolean)
          : [];
        if (types.length !== prefixes.length) throw new Error("Incomplete stat result");
        const typeByPrefix = new Map(prefixes.map((prefix, index) => [prefix, types[index]]));
        currentBatch.forEach((path) => {
          if (getAbsolutePathPrefixes(path).every((prefix) => !/^120/.test(typeByPrefix.get(prefix)))) {
            safe.push(path);
          }
        });
      } catch (err) {
        // A disappearing item makes macOS stat fail the whole batch. Isolate
        // that uncommon case without penalizing the normal bulk path.
        for (const path of currentBatch) {
          if (!await hasSymlinkComponent(path, utilsApi)) safe.push(path);
        }
      }
    }
    return safe;
  }

  return {
    STAT_TOOL,
    getAbsolutePathPrefixes,
    getPathsWithinRootsWithoutSymlinks,
    hasSymlinkComponent,
    isPathWithinRootsWithoutSymlinks,
  };
})();

module.exports = QuickFoldersPathSecurity;
