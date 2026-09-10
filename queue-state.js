// Pure queue operations shared by the IINA backend and WebKit UI.
// Queue entries use paths as stable identities, so duplicate drops stay
// predictable and multi-item moves preserve the order users selected.
const QuickFoldersQueueState = (() => {
  const DEFAULT_LIMIT = 1000;

  function normalizePaths(paths, limit = DEFAULT_LIMIT) {
    if (!Array.isArray(paths)) return [];
    const seen = new Set();
    const normalized = [];
    for (const path of paths) {
      if (typeof path !== "string" || path.length === 0 || seen.has(path)) continue;
      seen.add(path);
      normalized.push(path);
      if (normalized.length >= limit) break;
    }
    return normalized;
  }

  function addPaths(queuePaths, paths, limit = DEFAULT_LIMIT) {
    const queue = normalizePaths(queuePaths, limit);
    const seen = new Set(queue);
    for (const path of normalizePaths(paths, limit)) {
      if (seen.has(path) || queue.length >= limit) continue;
      seen.add(path);
      queue.push(path);
    }
    return queue;
  }

  function removePaths(queuePaths, paths) {
    const removed = new Set(normalizePaths(paths));
    return normalizePaths(queuePaths).filter((path) => !removed.has(path));
  }

  function movePaths(queuePaths, paths, targetPath, position = "before") {
    const queue = normalizePaths(queuePaths);
    const requested = new Set(normalizePaths(paths));
    const moving = queue.filter((path) => requested.has(path));
    if (moving.length === 0 || moving.includes(targetPath)) return queue;

    const movingSet = new Set(moving);
    const remaining = queue.filter((path) => !movingSet.has(path));
    const targetIndex = remaining.indexOf(targetPath);
    const insertAt = targetIndex === -1
      ? remaining.length
      : targetIndex + (position === "after" ? 1 : 0);
    remaining.splice(insertAt, 0, ...moving);
    return remaining;
  }

  function getDraggedPaths(orderedPaths, selectedPaths, activePath) {
    const ordered = normalizePaths(orderedPaths);
    if (!ordered.includes(activePath)) return [];
    const selected = new Set(normalizePaths(selectedPaths));
    return selected.has(activePath)
      ? ordered.filter((path) => selected.has(path))
      : [activePath];
  }

  return { addPaths, getDraggedPaths, movePaths, normalizePaths, removePaths };
})();

if (typeof module !== "undefined") {
  module.exports = QuickFoldersQueueState;
}
