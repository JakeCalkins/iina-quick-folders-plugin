// This file is intentionally limited to orchestration. Search/filter state,
// row construction, dialogs, and asynchronous media previews live in focused
// modules loaded before app.js.
let messageReceived = false;

const spinnerContainer = document.getElementById("spinner-container");
const searchBar = document.getElementById("search-bar");
const progressBar = document.getElementById("progress-bar");
const progressText = document.getElementById("progress-text");
const indexingModal = document.getElementById("indexing-modal");
const modalProgressBar = document.getElementById("modal-progress-bar");
const modalProgressText = document.getElementById("modal-progress-text");
function registerBackendMessages() {
  if (typeof iina === "undefined" || !iina.onMessage) return;
  iina.onMessage("index-building", handleIndexBuilding);
  iina.onMessage("index-progress", handleIndexProgress);
  iina.onMessage("index-complete", handleIndexComplete);
  iina.onMessage("update-items", handleStateUpdate);
  iina.onMessage("item-action-result", (result) => handleItemActionResult(result || {}));
  iina.onMessage("queue-action-result", (result) => handleQueueActionResult(result || {}));
  iina.onMessage("thumbnail-ready", mediaPreview.handleThumbnailReady);
  iina.onMessage("media-metadata-ready", mediaPreview.handleMetadataReady);
}

const itemListEl = document.getElementById("item-list");
const backBtn = document.getElementById("back-btn");
const breadcrumb = document.getElementById("breadcrumb");
const addFolderBtn = document.getElementById("add-folder-btn");
const refreshBtn = document.getElementById("refresh-btn");
const helpBtn = document.getElementById("help-btn");
const searchInput = document.getElementById("search-input");
const clearSearchBtn = document.getElementById("clear-search-btn");
const filterDropdown = document.getElementById("filter-dropdown");
const videoGroup = document.getElementById("video-group");
const audioGroup = document.getElementById("audio-group");
const imageGroup = document.getElementById("image-group");
const otherGroup = document.getElementById("other-group");
const depthWarning = document.getElementById("depth-warning");
const actionBar = document.getElementById("action-bar");
const selectionCount = document.getElementById("selection-count");
const queueSelectionBtn = document.getElementById("queue-selection-btn");
const watchBtn = document.getElementById("watch-btn");
const deleteBtn = document.getElementById("delete-btn");
const cancelSelectionBtn = document.getElementById("cancel-selection-btn");
const deleteModal = document.getElementById("delete-modal");
const deleteModalMessage = document.getElementById("delete-modal-message");
const cancelDeleteBtn = document.getElementById("cancel-delete-btn");
const confirmDeleteBtn = document.getElementById("confirm-delete-btn");
const helpModal = document.getElementById("help-modal");
const closeHelpBtn = document.getElementById("close-help-btn");
const openWindowShortcut = document.getElementById("open-window-shortcut");
const addFolderShortcut = document.getElementById("add-folder-shortcut");
const toast = document.getElementById("toast");
const appShell = document.getElementById("app-shell");
const queuePanel = document.getElementById("queue-panel");
const queueBucket = document.getElementById("queue-bucket");
const queueBadge = document.getElementById("queue-badge");
const queueList = document.getElementById("queue-list");
const queueCount = document.getElementById("queue-count");
const queueClearBtn = document.getElementById("queue-clear-btn");
const queueRemoveSelectedBtn = document.getElementById("queue-remove-selected-btn");
const queueCloseBtn = document.getElementById("queue-close-btn");
const queuePlayBtn = document.getElementById("queue-play-btn");

setTimeout(() => {
  if (!messageReceived) setIndexingUi(false);
}, 100);

let currentFilter = "all";
let renderedExtensionOptionsKey = null;
let currentSearchQuery = "";
let compiledSearchQuery = QuickFoldersSearch.compileQuery("");
let availableExtensions = [];
let searchRenderTimer = null;
let selectedPaths = new Set();
let selectionAnchorPath = null;
let focusedPath = null;
let visibleItems = [];
let renderedItems = [];
let actionPending = false;
let toastTimer = null;
let breadcrumbLayoutTimer = null;
const MAX_RENDERED_SEARCH_RESULTS = 500;
let currentPreferences = {
  filterImages: true,
  filterAudio: true,
  videoOnly: false,
  hideWatched: false,
  maxIndexDepth: 3,
  openWindowShortcut: "cmd+shift+k",
  addFolderShortcut: "n",
};

let currentState = {
  items: [],
  currentPath: null,
  atRoot: true,
  viewingWatched: false,
};

const mediaPreview = QuickFoldersMediaPreview.create({
  rootElement: itemListEl,
  sendMessage: QuickFoldersMessaging.send,
  thumbnailCacheLimit: 200,
  metadataCacheLimit: 500,
});
const browseModel = QuickFoldersBrowseModel.create({ maxSearchResults: MAX_RENDERED_SEARCH_RESULTS });
const interactions = QuickFoldersInteractions.create({
  sendMessage: QuickFoldersMessaging.send,
  resetBrowseContext() {
    resetSearch();
  },
  changeFilter(filter) {
    clearSelection(false);
    currentFilter = filter;
    renderItems();
  },
});
const queueController = QuickFoldersQueueController.create({
  panel: queuePanel,
  toggleButton: queueBucket,
  badge: queueBadge,
  list: queueList,
  count: queueCount,
  clearButton: queueClearBtn,
  removeButton: queueRemoveSelectedBtn,
  closeButton: queueCloseBtn,
  playButton: queuePlayBtn,
  sendMessage: QuickFoldersMessaging.send,
  onOpenChange(open) {
    QuickFoldersMessaging.send("queue-panel-open", { open });
  },
});
const deleteDialog = QuickFoldersDialogs.create({
  element: deleteModal,
  initialFocus: confirmDeleteBtn,
  closeButtons: [cancelDeleteBtn],
  inertTarget: appShell,
});
const helpDialog = QuickFoldersDialogs.create({
  element: helpModal,
  trigger: helpBtn,
  initialFocus: closeHelpBtn,
  closeButtons: [closeHelpBtn],
  inertTarget: appShell,
  toggleKey: "?",
});

function setIndexingUi(isBuilding, indexReady = true) {
  spinnerContainer.classList.toggle("hidden", !isBuilding);
  if (isBuilding || indexReady) searchBar.classList.toggle("hidden", isBuilding);
  if (refreshBtn) refreshBtn.disabled = isBuilding;
  itemListEl.setAttribute("aria-busy", String(isBuilding));
}

function handleIndexBuilding() {
  setIndexingUi(true);
  if (progressBar) progressBar.style.width = "0%";
  if (progressText) progressText.textContent = "Indexing...";
}

function handleIndexProgress(data) {
  if (!data || !data.progress) return;
  const filesProcessed = Number(data.progress.filesProcessed) || 0;
  const visualProgress = Math.min(filesProcessed % 100, 99);
  if (filesProcessed > 50 && indexingModal) {
    indexingModal.classList.remove("hidden");
    if (modalProgressText) modalProgressText.textContent = `Processing: ${filesProcessed} files found`;
    if (modalProgressBar) modalProgressBar.style.width = `${visualProgress}%`;
  }
  if (progressText) progressText.textContent = `Indexing: ${filesProcessed} files found`;
  if (progressBar) progressBar.style.width = `${visualProgress}%`;
}

function handleIndexComplete() {
  if (progressBar) progressBar.style.width = "100%";
  if (modalProgressBar) modalProgressBar.style.width = "100%";
  setTimeout(() => {
    if (indexingModal) indexingModal.classList.add("hidden");
  }, 500);
  setIndexingUi(false);
}

function getLocationKey(state) {
  return `${state.currentPath || ""}:${Boolean(state.viewingWatched)}`;
}

function handleStateUpdate(state) {
  const nextState = state || { items: [], atRoot: true };
  if (getLocationKey(currentState) !== getLocationKey(nextState)) clearSelection(false);
  currentState = nextState;
  availableExtensions = nextState.availableExtensions || [];
  browseModel.updateIndex(nextState.indexedFiles, nextState.indexRevision);
  if (nextState.preferences) currentPreferences = { ...currentPreferences, ...nextState.preferences };
  queueController.setItems(nextState.queueItems || []);
  updateHelpShortcuts();
  setIndexingUi(Boolean(nextState.isIndexing), Boolean(nextState.indexReady));
  populateExtensionDropdown();
  renderItems();
  messageReceived = true;
}

function populateExtensionDropdown() {
  // Index replacement is atomic, but an in-progress state may temporarily
  // report no extensions. Keep the last usable native menu until completion.
  if (currentState.isIndexing && renderedExtensionOptionsKey !== null && availableExtensions.length === 0) {
    filterDropdown.value = currentFilter;
    return;
  }
  const extensionGroups = QuickFoldersBrowseState.groupAvailableExtensions(
    availableExtensions,
    currentPreferences
  );
  // Replacing options while WebKit's native menu is open dismisses it. State
  // updates are frequent, so rebuild only when the available choices change.
  const optionsKey = JSON.stringify(extensionGroups);
  if (optionsKey !== renderedExtensionOptionsKey) {
    [
      [videoGroup, extensionGroups.video],
      [audioGroup, extensionGroups.audio],
      [imageGroup, extensionGroups.image],
      [otherGroup, []],
    ].forEach(([group, extensions]) => {
      group.innerHTML = "";
      extensions.forEach((extension) => {
        const option = document.createElement("option");
        option.value = `ext:${extension}`;
        option.textContent = extension.toUpperCase();
        group.appendChild(option);
      });
    });
    renderedExtensionOptionsKey = optionsKey;
  }

  const reconciledFilter = QuickFoldersBrowseState.reconcileExtensionFilter(currentFilter, extensionGroups);
  currentFilter = reconciledFilter;
  filterDropdown.value = currentFilter;
}

function getSelectableItems() {
  return visibleItems.filter((item) => !item.isDir);
}

function getSelectedItems() {
  return getSelectableItems().filter((item) => selectedPaths.has(item.path));
}

function clearSelection(shouldRender = true) {
  selectedPaths.clear();
  selectionAnchorPath = null;
  if (shouldRender) renderItems();
}

function selectItem(item, event, behavior = {}) {
  const shouldRestoreFocus = behavior.restoreFocus || (
    document.activeElement &&
    document.activeElement.dataset &&
    document.activeElement.dataset.path === item.path
  );
  const result = QuickFoldersBrowseState.updateSelection({
    visiblePaths: getSelectableItems().map((entry) => entry.path),
    selectedPaths: Array.from(selectedPaths),
    anchorPath: selectionAnchorPath,
    targetPath: item.path,
    additive: Boolean(behavior.additive || event.metaKey || event.ctrlKey),
    range: Boolean(event.shiftKey),
  });
  selectedPaths = new Set(result.selectedPaths);
  selectionAnchorPath = result.anchorPath;
  focusedPath = item.path;
  renderItems();
  if (shouldRestoreFocus) focusItem(item.path);
}

function focusItem(path) {
  const rows = itemListEl.querySelectorAll(".row[data-path]");
  const row = Array.from(rows).find((candidate) => candidate.dataset.path === path);
  if (!row) return;
  rows.forEach((candidate) => {
    candidate.tabIndex = candidate === row ? 0 : -1;
  });
  row.focus();
}

function moveItemFocus(item, key, { extendSelection = false } = {}) {
  const currentPath = item && item.path ? item.path : focusedPath;
  const target = QuickFoldersInteractions.getNavigationTarget(renderedItems, currentPath, key);
  if (!target) return false;

  if (extendSelection && !target.isDir) {
    const currentItem = renderedItems.find((candidate) => candidate.path === currentPath);
    const anchorPath = selectionAnchorPath
      || (currentItem && !currentItem.isDir ? currentItem.path : target.path);
    const result = QuickFoldersBrowseState.updateSelection({
      visiblePaths: renderedItems.filter((entry) => !entry.isDir).map((entry) => entry.path),
      selectedPaths: Array.from(selectedPaths),
      anchorPath,
      targetPath: target.path,
      additive: false,
      range: true,
    });
    selectedPaths = new Set(result.selectedPaths);
    selectionAnchorPath = anchorPath;
    focusedPath = target.path;
    renderItems();
  } else {
    focusedPath = target.path;
  }
  focusItem(focusedPath);
  return true;
}

function openFocusedOrSelectedItem() {
  const focusedItem = renderedItems.find((item) => item.path === focusedPath);
  const selectedItems = getSelectedItems();
  const item = focusedItem || (selectedItems.length === 1 ? selectedItems[0] : null);
  if (!item) return false;
  if (item.isDir) interactions.openFolder(item);
  else QuickFoldersMessaging.send("open-item", { path: item.path, isDir: false });
  return true;
}

function updateActionBar() {
  if (!actionBar) return;
  const items = getSelectedItems();
  const hasSelection = items.length > 0;
  actionBar.classList.toggle("hidden", !hasSelection);
  if (!hasSelection) return;

  selectionCount.textContent = `${items.length} selected`;
  const allWatched = items.every((item) => item.watched);
  watchBtn.textContent = allWatched ? "Mark Unwatched" : "Mark Watched";
  watchBtn.title = `${watchBtn.textContent} (W)`;
  watchBtn.disabled = actionPending;
  deleteBtn.disabled = actionPending;
  queueSelectionBtn.disabled = actionPending;
}

function addSelectedToQueue() {
  const items = getSelectedItems();
  if (items.length === 0) return;
  QuickFoldersMessaging.send("queue-add", { paths: items.map((item) => item.path) });
}

function setSelectedWatched() {
  if (actionPending) return;
  const items = getSelectedItems();
  if (items.length === 0) return;
  const watched = !items.every((item) => item.watched);
  actionPending = true;
  updateActionBar();
  QuickFoldersMessaging.send("set-watched", { paths: items.map((item) => item.path), watched });
}

function showDeleteConfirmation() {
  if (actionPending || !deleteModal) return;
  const items = getSelectedItems();
  if (items.length === 0) return;
  deleteModalMessage.textContent = items.length === 1
    ? `“${items[0].name}” will be permanently deleted. This cannot be undone.`
    : `${items.length} files will be permanently deleted. This cannot be undone.`;
  deleteDialog.open();
}

function hideDeleteConfirmation() {
  deleteDialog.close();
}

function updateHelpShortcuts() {
  if (openWindowShortcut) {
    openWindowShortcut.textContent = QuickFoldersKeyboard.formatShortcut(
      currentPreferences.openWindowShortcut,
      "Not set"
    );
  }
  if (addFolderShortcut) {
    addFolderShortcut.textContent = QuickFoldersKeyboard.formatShortcut(
      currentPreferences.addFolderShortcut,
      "Not set"
    );
  }
}

function showToast(message, isError = false) {
  if (!toast) return;
  if (toastTimer) clearTimeout(toastTimer);
  toast.textContent = message;
  toast.classList.toggle("error", isError);
  toast.classList.remove("hidden");
  toastTimer = setTimeout(() => {
    toast.classList.add("hidden");
    toastTimer = null;
  }, 2800);
}

function handleItemActionResult(result) {
  actionPending = false;
  const succeeded = Array.isArray(result.succeeded) ? result.succeeded : [];
  const failed = Array.isArray(result.failed) ? result.failed : [];
  if (result.action === "deleted") succeeded.forEach((path) => mediaPreview.remove(path));
  succeeded.forEach((path) => selectedPaths.delete(path));
  if (selectedPaths.size === 0) selectionAnchorPath = null;

  const verb = result.action === "deleted"
    ? "deleted"
    : result.action === "unwatched" ? "marked unwatched" : "marked watched";
  if (succeeded.length > 0) {
    showToast(`${succeeded.length} file${succeeded.length === 1 ? "" : "s"} ${verb}`);
  }
  if (failed.length > 0) {
    showToast(`${failed.length} file${failed.length === 1 ? "" : "s"} could not be updated`, true);
  }
  renderItems();
}

function handleQueueActionResult(result) {
  const succeeded = Array.isArray(result.succeeded) ? result.succeeded : [];
  const failed = Array.isArray(result.failed) ? result.failed : [];
  const actionCopy = {
    added: `${succeeded.length} item${succeeded.length === 1 ? "" : "s"} added to queue`,
    removed: `${succeeded.length} item${succeeded.length === 1 ? "" : "s"} removed from queue`,
    cleared: "Queue cleared",
    played: `Playing ${succeeded.length} queued item${succeeded.length === 1 ? "" : "s"}`,
  };
  if (succeeded.length > 0) {
    showToast(actionCopy[result.action] || "Queue updated");
    if (result.action === "added") {
      queueBucket.classList.remove("just-added");
      requestAnimationFrame(() => queueBucket.classList.add("just-added"));
    }
  }
  if (failed.length > 0) {
    const reason = failed[0] && failed[0].reason;
    showToast(reason || `${failed.length} queued item${failed.length === 1 ? "" : "s"} could not be used`, true);
  }
}

function deleteSelectedItems() {
  if (actionPending) return;
  const items = getSelectedItems();
  if (items.length === 0) return;
  hideDeleteConfirmation();
  actionPending = true;
  updateActionBar();
  QuickFoldersMessaging.send("delete-items", { paths: items.map((item) => item.path) });
}

function resetSearch({ focus = false, render = false } = {}) {
  if (searchRenderTimer) {
    clearTimeout(searchRenderTimer);
    searchRenderTimer = null;
  }
  currentSearchQuery = "";
  compiledSearchQuery = QuickFoldersSearch.compileQuery("");
  clearSelection(false);
  if (searchInput) {
    searchInput.value = "";
    if (focus) searchInput.focus();
  }
  if (render) renderItems();
}

function drawBreadcrumbSegments(segments) {
  breadcrumb.innerHTML = "";
  const parentElements = [];
  segments.forEach((segment, index) => {
    const isCurrent = index === segments.length - 1;
    const element = document.createElement(isCurrent ? "span" : "button");
    element.className = isCurrent ? "breadcrumb-current" : "breadcrumb-parent";
    element.textContent = segment.label;
    element.title = segment.path;

    if (!isCurrent) {
      element.type = "button";
      const destinationName = segment.path.split("/").pop() || segment.path;
      element.setAttribute("aria-label", `Go to ${destinationName}`);
      const navigate = () => {
        interactions.navigateTo(segment.path);
      };
      element.addEventListener("click", navigate);
      parentElements.push(element);
    }
    breadcrumb.appendChild(element);

    if (!isCurrent) {
      const separator = document.createElement("span");
      separator.className = "breadcrumb-separator";
      separator.textContent = "/";
      breadcrumb.appendChild(separator);
    }
  });
  return parentElements;
}

function renderBreadcrumb() {
  if (breadcrumbLayoutTimer) {
    clearTimeout(breadcrumbLayoutTimer);
    breadcrumbLayoutTimer = null;
  }
  breadcrumb.innerHTML = "";
  breadcrumb.title = "";
  breadcrumb.classList.toggle("breadcrumb-root", currentState.atRoot || currentState.viewingWatched);

  if (currentState.atRoot) {
    breadcrumb.textContent = "Quick Folders";
    return;
  }
  if (currentState.viewingWatched) {
    breadcrumb.textContent = "Watched";
    breadcrumb.title = "Watched media";
    return;
  }

  const segments = QuickFoldersView.getBreadcrumbSegments(
    currentState.currentPath,
    currentState.currentRootPath,
  );
  breadcrumb.title = currentState.currentPath;
  const parentElements = drawBreadcrumbSegments(segments);

  // Layout is available on the next task. Mutate labels in place rather than
  // replacing the nodes: replacing a breadcrumb between pointer-down and
  // pointer-up causes WebKit to discard the click.
  breadcrumbLayoutTimer = setTimeout(() => {
    breadcrumbLayoutTimer = null;
    for (let index = 0; index < segments.length - 1 && breadcrumb.scrollWidth > breadcrumb.clientWidth; index++) {
      parentElements[index].textContent = "..";
    }
  }, 0);
}

function appendEmptyMessage(message) {
  const element = document.createElement("div");
  element.className = "empty";
  element.textContent = message;
  itemListEl.appendChild(element);
}

function renderItems() {
  mediaPreview.beginRender();
  const browseResult = browseModel.getItems({
    state: currentState,
    query: currentSearchQuery,
    compiledQuery: compiledSearchQuery,
    filter: currentFilter,
    preferences: currentPreferences,
  });
  const filteredItems = browseResult.items;
  visibleItems = filteredItems;
  const selectablePaths = new Set(filteredItems.filter((item) => !item.isDir).map((item) => item.path));
  selectedPaths = new Set(Array.from(selectedPaths).filter((path) => selectablePaths.has(path)));
  if (selectionAnchorPath && !selectablePaths.has(selectionAnchorPath)) selectionAnchorPath = null;
  if (focusedPath && !filteredItems.some((item) => item.path === focusedPath)) focusedPath = null;

  itemListEl.innerHTML = "";
  updateActionBar();

  // Update back button
  backBtn.classList.toggle("hidden", currentState.atRoot);
  
  // Show/hide depth warning if folder depth exceeds indexing limit
  if (depthWarning) {
    const folderDepth = currentState.folderDepth || 0;
    const maxDepth = currentPreferences.maxIndexDepth || 3;
    depthWarning.classList.toggle("hidden", folderDepth < maxDepth);
  }

  renderBreadcrumb();

  if (filteredItems.length === 0) {
    appendEmptyMessage(QuickFoldersView.getEmptyMessage({
      state: currentState,
      query: currentSearchQuery,
      filter: currentFilter,
      preferences: currentPreferences,
    }));
    return;
  }

  if (browseResult.totalIndexedMatches > MAX_RENDERED_SEARCH_RESULTS) {
    const resultsSummary = document.createElement("div");
    resultsSummary.className = "results-summary";
    resultsSummary.textContent = `Showing the top ${MAX_RENDERED_SEARCH_RESULTS.toLocaleString()} of ${browseResult.totalIndexedMatches.toLocaleString()} file matches`;
    itemListEl.appendChild(resultsSummary);
  }

  const groupedItems = QuickFoldersBrowseState.partitionWatched(filteredItems);
  const orderedItems = groupedItems.active.concat(groupedItems.watched);
  renderedItems = orderedItems;
  const fragment = document.createDocumentFragment();
  const itemViewOptions = {
    atRoot: currentState.atRoot,
    hasSearchQuery: Boolean(currentSearchQuery),
    isIndexing: currentState.isIndexing,
    mediaPreview,
    selectedPaths,
    focusedPath: focusedPath || (orderedItems[0] && orderedItems[0].path),
    onOpenFolder(folder) {
      interactions.openFolder(folder);
    },
    onOpenFile(file) {
      QuickFoldersMessaging.send("open-item", { path: file.path, isDir: false });
    },
    onRemoveRoot(folder) {
      QuickFoldersMessaging.send("remove-root", { path: folder.path });
    },
    onFocusItem(item) {
      focusedPath = item.path;
      itemListEl.querySelectorAll(".row[data-path]").forEach((row) => {
        row.tabIndex = row.dataset.path === focusedPath ? 0 : -1;
      });
    },
    onMoveFocus: moveItemFocus,
    onSelectFile: selectItem,
    onDragFiles(item, event) {
      const paths = QuickFoldersQueueState.getDraggedPaths(
        orderedItems.filter((entry) => !entry.isDir).map((entry) => entry.path),
        Array.from(selectedPaths),
        item.path,
      );
      queueController.startExternalDrag(event, paths, QuickFoldersView.getDisplayName(item));
      return paths;
    },
    onDragEnd() {
      queueController.endExternalDrag();
    },
  };

  orderedItems.forEach((item, itemIndex) => {
    if (
      item.watched &&
      !currentState.viewingWatched &&
      (itemIndex === 0 || !orderedItems[itemIndex - 1].watched)
    ) {
      const sectionEl = document.createElement("div");
      sectionEl.className = "section-label";
      sectionEl.textContent = `Watched · ${groupedItems.watched.length}`;
      fragment.appendChild(sectionEl);
    }
    fragment.appendChild(QuickFoldersItemView.create(item, itemViewOptions));
  });
  itemListEl.appendChild(fragment);
  // IINA can reopen this WebView after it was hidden for playback. WebKit does
  // not always deliver a fresh IntersectionObserver callback on that resume,
  // so explicitly sample only the visible/preload region after layout.
  requestAnimationFrame(() => mediaPreview.requestVisible());
}

window.addEventListener("focus", () => {
  requestAnimationFrame(() => mediaPreview.requestVisible());
});

document.addEventListener("visibilitychange", () => {
  if (!document.hidden) requestAnimationFrame(() => mediaPreview.requestVisible());
});

// Back button handler
backBtn.addEventListener("click", () => {
  interactions.goBack();
});

// Add Folder button handler
if (addFolderBtn) {
  addFolderBtn.addEventListener("click", () => {
    QuickFoldersMessaging.send("add-folder");
  });
}

// Refresh button handler
if (refreshBtn) {
  refreshBtn.addEventListener("click", () => {
    QuickFoldersMessaging.send("refresh-index");
  });
}

if (helpBtn) {
  helpBtn.addEventListener("click", () => {
    updateHelpShortcuts();
    helpDialog.open();
  });
}

// Search input handler
if (searchInput) {
  searchInput.addEventListener("input", (e) => {
    clearSelection(false);
    currentSearchQuery = e.target.value;
    compiledSearchQuery = QuickFoldersSearch.compileQuery(currentSearchQuery);
    if (searchRenderTimer) clearTimeout(searchRenderTimer);
    searchRenderTimer = setTimeout(() => {
      searchRenderTimer = null;
      renderItems();
    }, 60);
  });
}

// Clear search button handler
if (clearSearchBtn) {
  clearSearchBtn.addEventListener("click", () => {
    resetSearch({ focus: true, render: true });
  });
}

// Filter dropdown handler
if (filterDropdown) {
  const applyFilter = (event) => {
    const nextFilter = event.currentTarget.value;
    interactions.applyFilter(nextFilter, currentFilter);
  };
  // WebKit versions differ on whether native select commits arrive as input,
  // change, or both. The idempotent handler supports each behavior.
  filterDropdown.addEventListener("input", applyFilter);
  filterDropdown.addEventListener("change", applyFilter);
}

if (watchBtn) watchBtn.addEventListener("click", setSelectedWatched);
if (queueSelectionBtn) queueSelectionBtn.addEventListener("click", addSelectedToQueue);
if (deleteBtn) deleteBtn.addEventListener("click", showDeleteConfirmation);
if (cancelSelectionBtn) cancelSelectionBtn.addEventListener("click", () => clearSelection());
if (confirmDeleteBtn) {
  confirmDeleteBtn.addEventListener("click", deleteSelectedItems);
}

document.addEventListener("keydown", (event) => {
  if (deleteDialog.handleKeydown(event) || helpDialog.handleKeydown(event)) return;

  const target = event.target;
  if (target && target.closest && target.closest("#queue-panel")) return;
  const isTyping = target && (
    target.tagName === "INPUT" || target.tagName === "SELECT" || target.tagName === "TEXTAREA"
  );
  if (isTyping) return;

  if (event.key === "?" && !event.metaKey && !event.ctrlKey && !event.altKey) {
    event.preventDefault();
    updateHelpShortcuts();
    helpDialog.open();
    return;
  }

  const isSearchShortcut = (
    event.key === "/" && !event.metaKey && !event.ctrlKey && !event.altKey
  ) || (
    event.key.toLowerCase() === "f" && (event.metaKey || event.ctrlKey)
  );
  if (isSearchShortcut && searchInput && !searchBar.classList.contains("hidden")) {
    event.preventDefault();
    searchInput.focus();
    searchInput.select();
    return;
  }

  if (["ArrowDown", "ArrowUp", "Home", "End"].includes(event.key)) {
    event.preventDefault();
    moveItemFocus(null, event.key, { extendSelection: event.shiftKey });
    return;
  }

  if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "a") {
    event.preventDefault();
    const paths = getSelectableItems().map((item) => item.path);
    selectedPaths = new Set(paths);
    selectionAnchorPath = paths[0] || null;
    renderItems();
  } else if (event.key === "Escape") {
    clearSelection();
  } else if (event.key === "Delete" || event.key === "Backspace") {
    if (selectedPaths.size > 0) {
      event.preventDefault();
      showDeleteConfirmation();
    }
  } else if (event.key.toLowerCase() === "w" && !event.metaKey && !event.ctrlKey) {
    if (selectedPaths.size > 0) {
      event.preventDefault();
      setSelectedWatched();
    }
  } else if (event.key.toLowerCase() === "q" && !event.metaKey && !event.ctrlKey && !event.altKey) {
    if (selectedPaths.size > 0) {
      event.preventDefault();
      addSelectedToQueue();
    }
  } else if (event.key === "Enter") {
    openFocusedOrSelectedItem();
  }
});


registerBackendMessages();

// Request initial state from main.js
QuickFoldersMessaging.send("request-state");

// Also request state after a delay to ensure we get updates
setTimeout(() => {
  QuickFoldersMessaging.send("request-state");
}, 500);

// Render initial empty state
renderItems();
