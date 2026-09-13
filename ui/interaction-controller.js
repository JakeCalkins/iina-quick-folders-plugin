// Centralizes user intent at the browser/backend boundary. Keeping these
// commands pure makes navigation and native-select regressions testable without
// an IINA runtime or browser dependency.
const QuickFoldersInteractions = (() => {
  const INTERACTIVE_SELECTOR = [
    "button",
    "a",
    "input",
    "select",
    "textarea",
    "[contenteditable='true']",
    "[role='button']",
    "[role='link']",
  ].join(", ");

  function isInteractiveControl(target) {
    if (!target) return false;
    if (target.isContentEditable) return true;
    if (typeof target.closest === "function") {
      return Boolean(target.closest(INTERACTIVE_SELECTOR));
    }
    const tagName = String(target.tagName || "").toLowerCase();
    return ["button", "a", "input", "select", "textarea"].includes(tagName);
  }

  function getNavigationTarget(items, currentPath, key) {
    if (!["ArrowDown", "ArrowUp", "Home", "End"].includes(key)) return null;
    const candidates = Array.isArray(items)
      ? items.filter((item) => item && typeof item.path === "string")
      : [];
    if (candidates.length === 0) return null;

    const currentIndex = candidates.findIndex((item) => item.path === currentPath);
    if (key === "Home") return candidates[0];
    if (key === "End") return candidates[candidates.length - 1];
    if (currentIndex === -1) {
      return key === "ArrowUp" ? candidates[candidates.length - 1] : candidates[0];
    }
    if (key === "ArrowDown") return candidates[Math.min(currentIndex + 1, candidates.length - 1)];
    if (key === "ArrowUp") return candidates[Math.max(currentIndex - 1, 0)];
    return null;
  }

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
      const data = {
        path: folder.path,
        isDir: true,
        isWatchedRoot: Boolean(folder.isWatchedRoot),
      };
      if (folder.isSmartView && typeof folder.smartView === "string") {
        data.isSmartView = true;
        data.smartView = folder.smartView;
      }
      sendMessage("open-item", data);
      return true;
    }

    function applyFilter(value, currentFilter) {
      if (typeof value !== "string" || !/^(all|video|audio|image|ext:[a-z0-9]+)$/.test(value)) return false;
      if (value === currentFilter) return false;
      changeFilter(value);
      return true;
    }

    return { applyFilter, goBack, navigateTo, openFolder };
  }

  return { create, getNavigationTarget, isInteractiveControl };
})();

if (typeof module !== "undefined") {
  module.exports = QuickFoldersInteractions;
}
