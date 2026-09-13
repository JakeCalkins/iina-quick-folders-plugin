// This file is intentionally limited to orchestration. Search/filter state,
// row construction, dialogs, and asynchronous media previews live in focused
// modules loaded before app.js.
let messageReceived = false;

const spinnerContainer = document.getElementById("spinner-container");
const searchBar = document.getElementById("search-bar");
const progressBar = document.getElementById("progress-bar");
const progressText = document.getElementById("progress-text");
function registerBackendMessages() {
  QuickFoldersMessaging.onMessage("index-building", handleIndexBuilding);
  QuickFoldersMessaging.onMessage("index-progress", handleIndexProgress);
  QuickFoldersMessaging.onMessage("index-complete", handleIndexComplete);
  QuickFoldersMessaging.onMessage("update-items", handleStateUpdate);
  QuickFoldersMessaging.onMessage("item-action-result", (result) => handleItemActionResult(result || {}));
  QuickFoldersMessaging.onMessage("queue-action-result", (result) => handleQueueActionResult(result || {}));
  QuickFoldersMessaging.onMessage("diagnostics-ready", renderDiagnostics);
  QuickFoldersMessaging.onMessage("diagnostics-reset", () => {
    mediaPreview.clear();
    renderItems();
    showToast("Preview caches and diagnostics reset");
    QuickFoldersMessaging.send("request-diagnostics");
  });
  QuickFoldersMessaging.onMessage("thumbnail-ready", mediaPreview.handleThumbnailReady);
  QuickFoldersMessaging.onMessage("media-metadata-ready", (data) => {
    mediaPreview.handleMetadataReady(data);
    if (!data) return;
    const indexedChanged = browseModel.updateMetadata(data.path, data.metadata);
    let visibleChanged = false;
    currentState.items = (currentState.items || []).map((item) => {
      if (!item || item.path !== data.path || !data.metadata) return item;
      visibleChanged = true;
      return { ...item, ...data.metadata };
    });
    const queryUsesMediaMetadata = compiledSearchQuery.terms.some(
      (term) => term.field === "duration" || term.field === "resolution",
    );
    if ((indexedChanged || visibleChanged) && queryUsesMediaMetadata) scheduleMetadataRender();
  });
}

const itemListEl = document.getElementById("item-list");
const columnBrowser = document.getElementById("column-browser");
const backBtn = document.getElementById("back-btn");
const breadcrumb = document.getElementById("breadcrumb");
const addFolderBtn = document.getElementById("add-folder-btn");
const refreshBtn = document.getElementById("refresh-btn");
const helpBtn = document.getElementById("help-btn");
const commandBtn = document.getElementById("command-btn");
const listLayoutBtn = document.getElementById("list-layout-btn");
const gridLayoutBtn = document.getElementById("grid-layout-btn");
const searchInput = document.getElementById("search-input");
const clearSearchBtn = document.getElementById("clear-search-btn");
const searchChips = document.getElementById("search-chips");
const searchSuggestions = document.getElementById("search-suggestions");
const searchError = document.getElementById("search-error");
const filterDropdown = document.getElementById("filter-dropdown");
const videoFilterOption = document.getElementById("video-filter-option");
const audioFilterOption = document.getElementById("audio-filter-option");
const imageFilterOption = document.getElementById("image-filter-option");
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
const commandModal = document.getElementById("command-modal");
const commandInput = document.getElementById("command-input");
const commandList = document.getElementById("command-list");
const commandEmpty = document.getElementById("command-empty");
const diagnosticsModal = document.getElementById("diagnostics-modal");
const diagnosticsContent = document.getElementById("diagnostics-content");
const closeDiagnosticsBtn = document.getElementById("close-diagnostics-btn");
const resetPreviewCachesBtn = document.getElementById("reset-preview-caches-btn");

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
let currentLayout = "list";
let currentBrowserContext = QuickFoldersBrowserContext.createDefault();
let didRestoreBrowserContext = false;
let pendingScrollAnchor = null;
let pendingFocusedPath = null;
let restoreNavigationSent = false;
let restoreNavigationPending = false;
let restoreNavigationFallbackTimer = null;
let contextSaveTimer = null;
let metadataRenderTimer = null;
let currentItemViewOptions = null;
let suppressSearchSuggestions = false;
const MAX_RENDERED_SEARCH_RESULTS = 100000;
let currentPreferences = {
  filterImages: true,
  filterAudio: true,
  videoOnly: false,
  hideWatched: false,
  showBitrateChips: false,
  maxIndexDepth: 3,
  openWindowShortcut: "cmd+shift+k",
  addFolderShortcut: "n",
};

let currentState = {
  items: [],
  currentPath: null,
  atRoot: true,
  viewingWatched: false,
  currentView: null,
  folderRoots: [],
};

function updateClearSearchButton() {
  if (!clearSearchBtn) return;
  const hasQuery = currentSearchQuery.length > 0;
  clearSearchBtn.disabled = !hasQuery;
  clearSearchBtn.classList.toggle("hidden", !hasQuery);
}

function getContextOptions() {
  const availableMediaTypes = Array.from(new Set(
    availableExtensions.map((extension) => QuickFoldersFileTypes.getFileTypeByExt(extension)),
  )).filter((type) => type !== QuickFoldersFileTypes.FILE_TYPES.OTHER);
  return {
    roots: currentState.folderRoots || [],
    availableExtensions,
    availableMediaTypes,
    smartViewIds: ["continue", "series", "recent", "unwatched", "watched"],
  };
}

function getCurrentLocation() {
  if (currentState.currentView) return { kind: "smart", viewId: currentState.currentView };
  if (currentState.currentPath) return { kind: "folder", path: currentState.currentPath };
  return { kind: "root" };
}

function scheduleContextSave() {
  if (!didRestoreBrowserContext || restoreNavigationPending) return;
  if (contextSaveTimer) clearTimeout(contextSaveTimer);
  contextSaveTimer = setTimeout(() => {
    contextSaveTimer = null;
    const options = getContextOptions();
    currentBrowserContext = QuickFoldersBrowserContext.addRecentLocation(
      currentBrowserContext,
      getCurrentLocation(),
      options,
    );
    currentBrowserContext = QuickFoldersBrowserContext.reconcile({
      ...currentBrowserContext,
      location: getCurrentLocation(),
      query: currentSearchQuery,
      filter: currentFilter,
      layout: currentLayout,
      focusedPath,
      scrollAnchor: itemCollection.captureAnchor(),
    }, options);
    QuickFoldersMessaging.send(
      "save-browser-context",
      QuickFoldersBrowserContext.toPersistence(currentBrowserContext, options),
    );
  }, 180);
}

function setLayout(layout, { persist = true } = {}) {
  const nextLayout = QuickFoldersItemCollection.normalizeLayout(layout);
  if (nextLayout === currentLayout && persist) return;
  currentLayout = nextLayout;
  mediaPreview.beginRender({ preservePending: true });
  itemCollection.setLayout(nextLayout);
  if (visibleItems.length === 0) renderItems({ preservePending: true });
  if (listLayoutBtn) {
    listLayoutBtn.classList.toggle("active", nextLayout === "list");
    listLayoutBtn.setAttribute("aria-pressed", String(nextLayout === "list"));
  }
  if (gridLayoutBtn) {
    gridLayoutBtn.classList.toggle("active", nextLayout === "grid");
    gridLayoutBtn.setAttribute("aria-pressed", String(nextLayout === "grid"));
  }
  requestAnimationFrame(() => mediaPreview.requestVisible());
  if (persist) scheduleContextSave();
}

function applySearchValue(value, { render = true, focus = false } = {}) {
  currentSearchQuery = String(value || "");
  compiledSearchQuery = QuickFoldersSearch.compileQuery(currentSearchQuery);
  searchInput.value = currentSearchQuery;
  updateClearSearchButton();
  renderSearchAssists();
  if (render) renderItems();
  if (focus) searchInput.focus();
  scheduleContextSave();
}

function renderSearchAssists() {
  if (searchError) {
    const firstError = compiledSearchQuery.errors[0];
    searchError.textContent = firstError ? firstError.message : "";
    searchError.classList.toggle("hidden", !firstError);
    searchInput.setAttribute("aria-invalid", String(Boolean(firstError)));
  }
  if (searchChips) {
    searchChips.innerHTML = "";
    compiledSearchQuery.terms
      .filter((term) => term.field !== "name")
      .forEach((term) => {
        const chip = document.createElement("button");
        chip.type = "button";
        chip.className = "search-chip";
        chip.textContent = `${term.raw} ×`;
        chip.title = `Remove ${term.raw}`;
        chip.addEventListener("click", () => {
          applySearchValue(QuickFoldersSearch.removeTerm(currentSearchQuery, term), { focus: true });
        });
        searchChips.appendChild(chip);
      });
    searchChips.classList.toggle("hidden", searchChips.children.length === 0);
  }
  if (!searchSuggestions) return;
  if (document.activeElement && searchSuggestions.contains(document.activeElement)) return;
  searchSuggestions.innerHTML = "";
  const activeElement = document.activeElement;
  const hasFocus = (
    activeElement === searchInput
    || (activeElement && searchSuggestions.contains(activeElement))
  ) && !suppressSearchSuggestions;
  const suggestions = hasFocus ? QuickFoldersSearch.getSuggestions(currentSearchQuery, {
    cursor: searchInput.selectionStart,
    folders: currentState.folderRoots || [],
    limit: 6,
  }) : [];
  suggestions.forEach((suggestion) => {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "search-suggestion";
    button.id = `search-suggestion-${suggestion.id}`.replace(/[^a-z0-9_-]/gi, "-");
    button.setAttribute("role", "option");
    button.setAttribute("aria-selected", "false");
    const label = document.createElement("span");
    label.textContent = suggestion.label;
    const description = document.createElement("small");
    description.textContent = suggestion.description;
    button.appendChild(label);
    button.appendChild(description);
    button.addEventListener("mousedown", (event) => event.preventDefault());
    button.addEventListener("focus", () => {
      searchSuggestions.querySelectorAll("[role='option']").forEach((option) => {
        option.setAttribute("aria-selected", String(option === button));
      });
      searchInput.setAttribute("aria-activedescendant", button.id);
    });
    const applyCurrentSuggestion = () => {
      const result = QuickFoldersSearch.applySuggestion(currentSearchQuery, suggestion);
      searchInput.focus();
      suppressSearchSuggestions = true;
      applySearchValue(result.value, { focus: true });
      searchInput.setSelectionRange(result.cursor, result.cursor);
    };
    button.addEventListener("click", applyCurrentSuggestion);
    button.addEventListener("keydown", (event) => {
      const buttons = Array.from(searchSuggestions.querySelectorAll("button"));
      const index = buttons.indexOf(button);
      if ((event.key === "Enter" || event.key === " ") && !event.isComposing) {
        event.preventDefault();
        applyCurrentSuggestion();
      } else if (event.key === "ArrowDown" || event.key === "ArrowUp") {
        event.preventDefault();
        const direction = event.key === "ArrowDown" ? 1 : -1;
        buttons[(index + direction + buttons.length) % buttons.length].focus();
      } else if (event.key === "Escape") {
        event.preventDefault();
        searchInput.focus();
        suppressSearchSuggestions = true;
        searchSuggestions.classList.add("hidden");
        searchInput.setAttribute("aria-expanded", "false");
      }
    });
    searchSuggestions.appendChild(button);
  });
  searchSuggestions.classList.toggle("hidden", suggestions.length === 0);
  searchInput.setAttribute("aria-expanded", String(suggestions.length > 0));
  if (suggestions.length === 0) searchInput.removeAttribute("aria-activedescendant");
}

function scheduleMetadataRender() {
  if (metadataRenderTimer) return;
  metadataRenderTimer = setTimeout(() => {
    metadataRenderTimer = null;
    renderItems({ preservePending: true });
  }, 60);
}

function appendDiagnosticGroup(title, values) {
  if (!diagnosticsContent || !values || Object.keys(values).length === 0) return;
  const heading = document.createElement("h3");
  heading.textContent = title;
  const list = document.createElement("dl");
  Object.entries(values).forEach(([name, value]) => {
    const row = document.createElement("div");
    const term = document.createElement("dt");
    const detail = document.createElement("dd");
    term.textContent = name.replace(/[.-]/g, " ");
    detail.textContent = String(value);
    row.appendChild(term);
    row.appendChild(detail);
    list.appendChild(row);
  });
  diagnosticsContent.appendChild(heading);
  diagnosticsContent.appendChild(list);
}

function renderDiagnostics(data) {
  if (!diagnosticsContent) return;
  diagnosticsContent.innerHTML = "";
  const snapshot = data && typeof data === "object" ? data : {};
  appendDiagnosticGroup("Current activity", snapshot.gauges || {});
  appendDiagnosticGroup("Session totals", snapshot.counters || {});
  const roots = Array.isArray(snapshot.roots) ? snapshot.roots : [];
  appendDiagnosticGroup("Library roots", Object.fromEntries(roots.map((root) => [root.id, root.status])));
  const events = Array.isArray(snapshot.events) ? snapshot.events.slice(-12).reverse() : [];
  appendDiagnosticGroup("Recent events", Object.fromEntries(events.map((entry, index) => [
    `${index + 1}. ${entry.category}`,
    `${entry.code}${Number.isFinite(entry.durationMs) ? ` · ${entry.durationMs} ms` : ""}`,
  ])));
  if (diagnosticsContent.children.length === 0) diagnosticsContent.textContent = "No diagnostic activity yet.";
}

const mediaPreview = QuickFoldersMediaPreview.create({
  rootElement: itemListEl,
  sendMessage: QuickFoldersMessaging.send,
  thumbnailCacheLimit: 200,
  metadataCacheLimit: 500,
  getPreferences: () => currentPreferences,
});
const browseModel = QuickFoldersBrowseModel.create({ maxSearchResults: MAX_RENDERED_SEARCH_RESULTS });
const itemCollection = QuickFoldersItemCollection.create({
  container: itemListEl,
  layout: currentLayout,
  schedule: requestAnimationFrame,
  createItem(item, _index, layout) {
    return QuickFoldersItemView.create(item, {
      ...currentItemViewOptions,
      focusedPath,
      layout,
      selectedPaths,
    });
  },
  onBeforeRender() {
    mediaPreview.beginRender({ preservePending: true });
  },
  onRender() {
    requestAnimationFrame(() => mediaPreview.requestVisible());
  },
});
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
let responsiveLayout = null;
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
    if (responsiveLayout) responsiveLayout.noteManualQueueChange();
    QuickFoldersMessaging.send("queue-panel-open", {
      open,
      resize: !responsiveLayout || !responsiveLayout.isWide(),
    });
  },
});
const columnView = QuickFoldersColumnView.create({
  element: columnBrowser,
  scrollContainer: columnBrowser.parentElement,
  schedule: requestAnimationFrame,
  onOpenFolder(folder) {
    interactions.openFolder(folder);
  },
  onOpenFile(file) {
    QuickFoldersMessaging.send("open-item", { path: file.path, isDir: false });
  },
});
responsiveLayout = QuickFoldersResponsiveLayout.create({
  windowObject: window,
  shell: appShell,
  queueController,
  onWideChange(wide) {
    if (wide) columnView.revealActive();
  },
});
const deleteDialog = QuickFoldersDialogs.create({
  element: deleteModal,
  // Default to the reversible choice so an accidental Return cannot delete.
  initialFocus: cancelDeleteBtn,
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
const commandDialog = QuickFoldersDialogs.create({
  element: commandModal,
  trigger: commandBtn,
  initialFocus: commandInput,
  inertTarget: appShell,
});
const diagnosticsDialog = QuickFoldersDialogs.create({
  element: diagnosticsModal,
  initialFocus: closeDiagnosticsBtn,
  closeButtons: [closeDiagnosticsBtn],
  inertTarget: appShell,
});

function getCommandContext() {
  const selected = getSelectedItems();
  return {
    availableViews: ["continue", "series", "recent", "unwatched", "watched"],
    availableMediaTypes: getContextOptions().availableMediaTypes,
    recentLocations: currentBrowserContext.recentLocations,
    canGoBack: !currentState.atRoot,
    hasQuery: Boolean(currentSearchQuery),
    isIndexing: Boolean(currentState.isIndexing),
    filter: currentFilter,
    layout: currentLayout,
    selectionCount: selected.length,
    selectionAllWatched: selected.length > 0 && selected.every((item) => item.watched),
    queueOpen: queueController.isOpen(),
    queueCount: Array.isArray(currentState.queueItems) ? currentState.queueItems.length : 0,
  };
}

function openSmartView(view) {
  QuickFoldersMessaging.send("open-item", {
    path: `@view/${view}`,
    isDir: true,
    isSmartView: true,
    smartView: view,
  });
}

function openRecentLocation(index) {
  const location = currentBrowserContext.recentLocations[index];
  if (!location) return;
  if (location.kind === "folder") QuickFoldersMessaging.send("navigate-to", { path: location.path });
  else if (location.kind === "smart") openSmartView(location.viewId);
}

function setFileFilter(filter) {
  if (filter === currentFilter) return;
  clearSelection(false);
  currentFilter = filter;
  filterDropdown.value = filter;
  renderItems();
  scheduleContextSave();
}

const commandRegistry = QuickFoldersCommands.create({
  handlers: {
    "navigation.root": () => QuickFoldersMessaging.send("go-root"),
    "navigation.back": () => interactions.goBack(),
    "navigation.continue-watching": () => openSmartView("continue"),
    "navigation.recently-added": () => openSmartView("recent"),
    "navigation.continue-series": () => openSmartView("series"),
    "navigation.unwatched": () => openSmartView("unwatched"),
    "navigation.watched": () => openSmartView("watched"),
    "browse.focus-search": () => setTimeout(() => searchInput.focus(), 0),
    "browse.clear-search": () => setTimeout(() => resetSearch({ focus: true, render: true }), 0),
    "browse.refresh": () => QuickFoldersMessaging.send("refresh-index"),
    "folder.add": () => QuickFoldersMessaging.send("add-folder"),
    "filter.all": () => setFileFilter("all"),
    "filter.video": () => setFileFilter("video"),
    "filter.audio": () => setFileFilter("audio"),
    "filter.image": () => setFileFilter("image"),
    "layout.list": () => setLayout("list"),
    "layout.grid": () => setLayout("grid"),
    "selection.queue": addSelectedToQueue,
    "selection.toggle-watched": setSelectedWatched,
    "selection.delete": () => setTimeout(showDeleteConfirmation, 0),
    "selection.clear": () => clearSelection(),
    "queue.open": () => queueController.setOpen(true),
    "queue.close": () => queueController.setOpen(false),
    "queue.play": () => QuickFoldersMessaging.send("queue-play"),
    "help.open": () => setTimeout(() => helpDialog.open(), 0),
    "diagnostics.open": () => {
      setTimeout(() => {
        diagnosticsDialog.open();
        QuickFoldersMessaging.send("request-diagnostics");
      }, 0);
    },
    ...Object.fromEntries(Array.from({ length: 5 }, (_entry, index) => [
      `navigation.recent-location-${index + 1}`,
      () => openRecentLocation(index),
    ])),
  },
});
const commandPalette = QuickFoldersCommandPalette.create({
  element: commandModal,
  input: commandInput,
  list: commandList,
  empty: commandEmpty,
  registry: commandRegistry,
  getContext: getCommandContext,
  dialog: commandDialog,
});
commandModal.addEventListener("click", (event) => {
  if (event.target === commandModal) commandPalette.close();
});

function setIndexingUi(isBuilding) {
  spinnerContainer.classList.toggle("hidden", !isBuilding);
  // Browsing and the last published search index remain useful during a
  // refresh, so progress must not replace the footer controls.
  searchBar.classList.remove("hidden");
  if (refreshBtn) refreshBtn.disabled = isBuilding;
  itemListEl.setAttribute("aria-busy", String(isBuilding));
}

function handleIndexBuilding() {
  setIndexingUi(true);
  if (progressBar) {
    progressBar.style.width = "35%";
    progressBar.classList.add("indeterminate");
  }
  if (progressText) progressText.textContent = "Indexing...";
}

function handleIndexProgress(data) {
  if (!data || !data.progress) return;
  const filesProcessed = Number(data.progress.filesProcessed) || 0;
  if (progressText) progressText.textContent = `Indexing: ${filesProcessed} files found`;
}

function handleIndexComplete() {
  if (progressBar) {
    progressBar.classList.remove("indeterminate");
    progressBar.style.width = "100%";
  }
  setIndexingUi(false);
}

function getLocationKey(state) {
  return `${state.currentPath || ""}:${state.currentView || (state.viewingWatched ? "watched" : "")}`;
}

function handleStateUpdate(state) {
  const nextState = state || { items: [], atRoot: true };
  if (getLocationKey(currentState) !== getLocationKey(nextState)) clearSelection(false);
  currentState = nextState;
  if (restoreNavigationPending) {
    const restoredLocation = currentBrowserContext.location;
    const reachedRestoredLocation = (
      restoredLocation.kind === "folder" && nextState.currentPath === restoredLocation.path
    ) || (
      restoredLocation.kind === "smart" && nextState.currentView === restoredLocation.viewId
    );
    if (reachedRestoredLocation) {
      restoreNavigationPending = false;
      if (restoreNavigationFallbackTimer) clearTimeout(restoreNavigationFallbackTimer);
      restoreNavigationFallbackTimer = null;
    }
  }
  availableExtensions = nextState.availableExtensions || [];
  browseModel.updateIndex(nextState.indexedFiles, nextState.indexRevision);
  if (nextState.preferences) currentPreferences = { ...currentPreferences, ...nextState.preferences };
  if (!didRestoreBrowserContext) {
    const restored = QuickFoldersBrowserContext.deserialize(nextState.browserContext, getContextOptions());
    currentBrowserContext = restored;
    currentSearchQuery = restored.query;
    compiledSearchQuery = QuickFoldersSearch.compileQuery(currentSearchQuery);
    searchInput.value = currentSearchQuery;
    currentFilter = restored.filter;
    pendingScrollAnchor = restored.scrollAnchor;
    pendingFocusedPath = restored.focusedPath;
    setLayout(restored.layout, { persist: false });
    updateClearSearchButton();
    renderSearchAssists();
    didRestoreBrowserContext = true;
  }
  queueController.setItems(nextState.queueItems || []);
  updateHelpShortcuts();
  setIndexingUi(Boolean(nextState.isIndexing));
  populateExtensionDropdown();
  renderItems();
  if (pendingScrollAnchor && itemCollection.restoreAnchor(pendingScrollAnchor)) pendingScrollAnchor = null;
  if (pendingFocusedPath && visibleItems.some((item) => item.path === pendingFocusedPath)) {
    focusedPath = pendingFocusedPath;
    itemCollection.focusPath(pendingFocusedPath);
    pendingFocusedPath = null;
  } else if (restoreNavigationSent && !restoreNavigationPending) {
    pendingFocusedPath = null;
  }
  if (!restoreNavigationSent && currentBrowserContext.location.kind !== "root") {
    restoreNavigationSent = true;
    restoreNavigationPending = true;
    restoreNavigationFallbackTimer = setTimeout(() => {
      restoreNavigationFallbackTimer = null;
      restoreNavigationPending = false;
      pendingFocusedPath = null;
      scheduleContextSave();
    }, 1000);
    if (currentBrowserContext.location.kind === "folder") {
      QuickFoldersMessaging.send("navigate-to", { path: currentBrowserContext.location.path });
    } else {
      QuickFoldersMessaging.send("open-item", {
        path: `@view/${currentBrowserContext.location.viewId}`,
        isDir: true,
        isSmartView: true,
        smartView: currentBrowserContext.location.viewId,
      });
    }
  }
  scheduleContextSave();
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
  [
    [videoFilterOption, extensionGroups.video],
    [audioFilterOption, extensionGroups.audio],
    [imageFilterOption, extensionGroups.image],
  ].forEach(([option, extensions]) => {
    if (!option) return;
    const unavailable = extensions.length === 0;
    option.disabled = unavailable;
    option.hidden = unavailable;
  });
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
      group.hidden = extensions.length === 0;
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
  if (shouldRender) refreshSelectionPresentation();
}

function refreshSelectionPresentation() {
  const itemsByPath = new Map(renderedItems.map((item) => [item.path, item]));
  itemListEl.querySelectorAll(".row[data-path]").forEach((row) => {
    const item = itemsByPath.get(row.dataset.path);
    if (!item || item.isDir) return;
    const selected = selectedPaths.has(item.path);
    row.classList.toggle("selected", selected);
    row.setAttribute("aria-selected", String(selected));
    row.setAttribute("aria-label", QuickFoldersItemView.getAriaLabel(item, selected));
    const indicator = row.querySelector(".selection-indicator");
    if (indicator) indicator.title = selected ? "Deselect file" : "Select file";
  });
  updateActionBar();
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
  refreshSelectionPresentation();
  if (shouldRestoreFocus) focusItem(item.path);
}

function focusItem(path) {
  itemCollection.focusPath(path);
}

function focusBrowseList() {
  const target = renderedItems.find((item) => item.path === focusedPath) || renderedItems[0];
  if (!target) return false;
  focusedPath = target.path;
  focusItem(target.path);
  return true;
}

function moveItemFocus(item, key, { extendSelection = false } = {}) {
  const currentPath = item && item.path ? item.path : focusedPath;
  const target = currentPath
    ? itemCollection.moveFocus(currentPath, key, { focus: false })
    : renderedItems[0];
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
    refreshSelectionPresentation();
  } else {
    focusedPath = target.path;
  }
  focusItem(focusedPath);
  return true;
}

function activateFocusedItem() {
  const focusedItem = renderedItems.find((item) => item.path === focusedPath);
  if (!focusedItem) return false;
  if (focusedItem.isDir) interactions.openFolder(focusedItem);
  else QuickFoldersMessaging.send("open-item", { path: focusedItem.path, isDir: false });
  return true;
}

function selectFocusedItem(event) {
  const focusedItem = renderedItems.find((item) => item.path === focusedPath);
  if (!focusedItem) return false;
  if (focusedItem.isDir) return interactions.openFolder(focusedItem);
  selectItem(focusedItem, event, { additive: true, restoreFocus: true });
  return true;
}

function updateActionBar() {
  if (!actionBar) return;
  const items = getSelectedItems();
  const hasSelection = items.length > 0;
  const wasHidden = actionBar.classList.contains("hidden");
  actionBar.classList.toggle("hidden", !hasSelection);
  if (wasHidden === hasSelection) {
    requestAnimationFrame(() => {
      itemCollection.render();
      if (focusedPath) itemCollection.focusPath(focusedPath, { focus: false });
    });
  }
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

function addKeyboardItemsToQueue() {
  const paths = QuickFoldersKeyboard.getQueuePaths(
    renderedItems,
    Array.from(selectedPaths),
    focusedPath,
  );
  if (paths.length === 0) return false;
  QuickFoldersMessaging.send("queue-add", { paths });
  return true;
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
    ? `“${items[0].name}” will be moved to Trash.`
    : `${items.length} files will be moved to Trash.`;
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
  if (result.action === "trashed") succeeded.forEach((path) => mediaPreview.remove(path));
  succeeded.forEach((path) => selectedPaths.delete(path));
  if (selectedPaths.size === 0) selectionAnchorPath = null;

  const verb = result.action === "trashed"
    ? "moved to Trash"
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
  updateClearSearchButton();
  renderSearchAssists();
  if (render) renderItems();
  scheduleContextSave();
}

function appendBreadcrumbSeparator() {
  const separator = document.createElement("span");
  separator.className = "breadcrumb-separator";
  separator.textContent = "/";
  breadcrumb.appendChild(separator);
}

function drawBreadcrumbSegments(segments) {
  breadcrumb.innerHTML = "";
  const { hidden, visible } = QuickFoldersView.partitionBreadcrumbSegments(segments);
  if (hidden.length > 0) {
    const overflow = document.createElement("select");
    overflow.className = "breadcrumb-overflow";
    overflow.setAttribute("aria-label", "Earlier folders");
    const placeholder = document.createElement("option");
    placeholder.value = "";
    placeholder.textContent = "…";
    overflow.appendChild(placeholder);
    hidden.forEach((segment) => {
      const option = document.createElement("option");
      option.value = segment.path;
      option.textContent = segment.label;
      overflow.appendChild(option);
    });
    const navigate = (event) => {
      const path = event.currentTarget.value;
      if (!path) return;
      // Reset before navigating so WebKit's input/change event pair only
      // dispatches once and a rejected navigation can still be retried.
      event.currentTarget.value = "";
      interactions.navigateTo(path);
    };
    overflow.addEventListener("input", navigate);
    overflow.addEventListener("change", navigate);
    breadcrumb.appendChild(overflow);
    appendBreadcrumbSeparator();
  }

  visible.forEach((segment, index) => {
    const isCurrent = index === visible.length - 1;
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
    }
    breadcrumb.appendChild(element);

    if (!isCurrent) {
      appendBreadcrumbSeparator();
    }
  });
}

function renderBreadcrumb() {
  breadcrumb.innerHTML = "";
  breadcrumb.title = "";
  breadcrumb.classList.toggle("breadcrumb-root", currentState.atRoot || Boolean(currentState.currentView));

  if (currentState.atRoot) {
    breadcrumb.textContent = "Quick Folders";
    return;
  }
  if (currentState.currentView || currentState.viewingWatched) {
    const label = currentState.currentViewTitle || "Watched";
    const current = document.createElement("span");
    current.className = "breadcrumb-current";
    current.textContent = label;
    breadcrumb.appendChild(current);
    breadcrumb.title = `${label} media`;
    return;
  }

  const segments = QuickFoldersView.getBreadcrumbSegments(
    currentState.currentPath,
    currentState.currentRootPath,
  );
  breadcrumb.title = currentState.currentPath;
  drawBreadcrumbSegments(segments);
}

function appendEmptyMessage(message) {
  const element = document.createElement("div");
  element.className = "empty";
  element.textContent = message;
  itemListEl.appendChild(element);
}

function renderItems({ preservePending = false } = {}) {
  mediaPreview.beginRender({ preservePending });
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
  columnView.render(currentState.navigationColumns);

  if (filteredItems.length === 0) {
    renderedItems = [];
    currentItemViewOptions = null;
    itemCollection.setItems([], { preserveAnchor: false });
    appendEmptyMessage(QuickFoldersView.getEmptyMessage({
      state: currentState,
      query: currentSearchQuery,
      filter: currentFilter,
      preferences: currentPreferences,
    }));
    return;
  }

  const groupedItems = currentState.currentView
    ? null
    : QuickFoldersBrowseState.partitionWatched(filteredItems);
  const orderedItems = groupedItems ? groupedItems.active.concat(groupedItems.watched) : filteredItems;
  renderedItems = orderedItems;
  if (!focusedPath && orderedItems[0]) focusedPath = orderedItems[0].path;
  currentItemViewOptions = {
    atRoot: currentState.atRoot,
    hasSearchQuery: Boolean(currentSearchQuery),
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
      scheduleContextSave();
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
  itemCollection.setItems(orderedItems);
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
if (commandBtn) commandBtn.addEventListener("click", () => commandPalette.show());
if (listLayoutBtn) listLayoutBtn.addEventListener("click", () => setLayout("list"));
if (gridLayoutBtn) gridLayoutBtn.addEventListener("click", () => setLayout("grid"));
if (closeDiagnosticsBtn) closeDiagnosticsBtn.addEventListener("click", () => diagnosticsDialog.close());
if (resetPreviewCachesBtn) {
  resetPreviewCachesBtn.addEventListener("click", () => QuickFoldersMessaging.send("reset-preview-caches"));
}

// Search input handler
if (searchInput) {
  searchInput.addEventListener("input", (e) => {
    suppressSearchSuggestions = false;
    clearSelection(false);
    currentSearchQuery = e.target.value;
    updateClearSearchButton();
    compiledSearchQuery = QuickFoldersSearch.compileQuery(currentSearchQuery);
    renderSearchAssists();
    scheduleContextSave();
    if (searchRenderTimer) clearTimeout(searchRenderTimer);
    searchRenderTimer = setTimeout(() => {
      searchRenderTimer = null;
      renderItems();
    }, 60);
  });
  searchInput.addEventListener("keydown", (event) => {
    if (event.key === "ArrowDown" && searchSuggestions && !searchSuggestions.classList.contains("hidden")) {
      const firstSuggestion = searchSuggestions.querySelector("button");
      if (firstSuggestion) {
        event.preventDefault();
        firstSuggestion.focus();
        return;
      }
    }
    if (event.key !== "Enter" || event.isComposing) return;
    event.preventDefault();
    if (searchRenderTimer) {
      clearTimeout(searchRenderTimer);
      searchRenderTimer = null;
      renderItems();
    }
    searchInput.blur();
    focusBrowseList();
  });
  searchInput.addEventListener("focus", () => {
    suppressSearchSuggestions = false;
    renderSearchAssists();
  });
  searchInput.addEventListener("blur", () => setTimeout(renderSearchAssists, 0));
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
    scheduleContextSave();
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
  if (
    deleteDialog.handleKeydown(event)
    || helpDialog.handleKeydown(event)
    || commandDialog.handleKeydown(event)
    || diagnosticsDialog.handleKeydown(event)
  ) return;

  if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") {
    event.preventDefault();
    commandPalette.show();
    return;
  }

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

  // Toolbar, breadcrumb, and dialog controls own their keyboard events. Letting
  // those events fall through can open or mutate media behind the focused UI.
  if (QuickFoldersInteractions.isInteractiveControl(target)) return;

  const hasCommandModifier = event.metaKey || event.ctrlKey || event.altKey;
  if (!hasCommandModifier && ["ArrowDown", "ArrowUp", "Home", "End"].includes(event.key)) {
    event.preventDefault();
    moveItemFocus(null, event.key, { extendSelection: event.shiftKey });
    return;
  }

  if (event.key === "ArrowLeft" && !event.metaKey && !event.ctrlKey && !event.altKey) {
    if (!currentState.atRoot) {
      event.preventDefault();
      interactions.goBack();
    }
    return;
  }

  if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "a") {
    event.preventDefault();
    const paths = getSelectableItems().map((item) => item.path);
    selectedPaths = new Set(paths);
    selectionAnchorPath = paths[0] || null;
    refreshSelectionPresentation();
  } else if (event.key === "Escape") {
    clearSelection();
  } else if (!hasCommandModifier && (event.key === "Delete" || event.key === "Backspace")) {
    if (selectedPaths.size > 0) {
      event.preventDefault();
      showDeleteConfirmation();
    }
  } else if (event.key.toLowerCase() === "w" && !hasCommandModifier) {
    if (selectedPaths.size > 0) {
      event.preventDefault();
      setSelectedWatched();
    }
  } else if (event.key.toLowerCase() === "q" && !event.metaKey && !event.ctrlKey && !event.altKey) {
    if (addKeyboardItemsToQueue()) {
      event.preventDefault();
    }
  } else if (event.key === "Enter" && !hasCommandModifier) {
    if (selectFocusedItem(event)) event.preventDefault();
  } else if (!hasCommandModifier && (event.key === " " || event.key === "Spacebar")) {
    if (activateFocusedItem()) event.preventDefault();
  }
});

itemListEl.addEventListener("scroll", scheduleContextSave);
window.addEventListener("resize", () => {
  if (visibleItems.length === 0) renderItems({ preservePending: true });
  else itemCollection.render();
});
window.addEventListener("beforeunload", () => QuickFoldersMessaging.send("window-closed"));


registerBackendMessages();

// Request initial state from main.js
QuickFoldersMessaging.send("request-state", { indexRevision: currentState.indexRevision });

// Also request state after a delay to ensure we get updates
setTimeout(() => {
  QuickFoldersMessaging.send("request-state", { indexRevision: currentState.indexRevision });
}, 500);

// Render initial empty state
renderItems();
