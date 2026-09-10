// Centralizes user intent at the browser/backend boundary. Keeping these
// commands pure makes navigation and native-select regressions testable without
// an IINA runtime or browser dependency.
const QuickFoldersInteractions = (() => {
  function create({ sendMessage, resetBrowseContext, changeFilter }) {
    function goBack() {
      resetBrowseContext();
      sendMessage("go-back");
    }

    function navigateTo(path) {
      if (typeof path !== "string" || path.length === 0) return false;
      resetBrowseContext();
      sendMessage("navigate-to", { path });
      return true;
    }

    function openFolder(folder) {
      if (!folder || typeof folder.path !== "string" || folder.path.length === 0) return false;
      resetBrowseContext();
      sendMessage("open-item", {
        path: folder.path,
        isDir: true,
        isWatchedRoot: Boolean(folder.isWatchedRoot),
      });
      return true;
    }

    function applyFilter(value, currentFilter) {
      if (typeof value !== "string" || !/^(all|ext:[a-z0-9]+)$/.test(value)) return false;
      if (value === currentFilter) return false;
      changeFilter(value);
      return true;
    }

    return { applyFilter, goBack, navigateTo, openFolder };
  }

  return { create };
})();

if (typeof module !== "undefined") {
  module.exports = QuickFoldersInteractions;
}
