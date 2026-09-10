let messageReceived = false;

const spinnerContainer = document.getElementById("spinner-container");
const searchBar = document.getElementById("search-bar");
const progressBar = document.getElementById("progress-bar");
const progressText = document.getElementById("progress-text");
const indexingModal = document.getElementById("indexing-modal");
const modalProgressBar = document.getElementById("modal-progress-bar");
const modalProgressText = document.getElementById("modal-progress-text");
if (typeof iina !== "undefined" && iina.onMessage) {
  iina.onMessage("index-building", (data) => {
    spinnerContainer.classList.remove("hidden");
    searchBar.classList.add("hidden");
    if (progressBar) progressBar.style.width = "0%";
    if (progressText) progressText.textContent = "Indexing...";
  });

  iina.onMessage("index-progress", (data) => {
    if (data && data.progress) {
      const { filesProcessed } = data.progress;
      if (filesProcessed > 50 && indexingModal) {
        indexingModal.classList.remove("hidden");
        if (modalProgressText) modalProgressText.textContent = `Processing: ${filesProcessed} files found`;
        if (modalProgressBar) {
          const progress = Math.min((filesProcessed % 100), 99);
          modalProgressBar.style.width = progress + "%";
        }
      }
      if (progressBar && progressText) {
        progressText.textContent = `Indexing: ${filesProcessed} files found`;
        const progress = Math.min((filesProcessed / 100) % 100, 99);
        progressBar.style.width = progress + "%";
      }
    }
  });

  iina.onMessage("index-complete", (data) => {
    if (progressBar) progressBar.style.width = "100%";
    if (modalProgressBar) modalProgressBar.style.width = "100%";
    setTimeout(() => {
      if (indexingModal) indexingModal.classList.add("hidden");
    }, 500);
    
    spinnerContainer.classList.add("hidden");
    searchBar.classList.remove("hidden");
  });

  iina.onMessage("update-items", (state) => {
    const previousLocation = `${currentState.currentPath || ""}:${Boolean(currentState.viewingWatched)}`;
    currentState = state || {};
    const nextLocation = `${currentState.currentPath || ""}:${Boolean(currentState.viewingWatched)}`;
    if (previousLocation !== nextLocation) clearSelection(false);
    availableExtensions = state.availableExtensions || [];
    if (indexedSearchRevision !== state.indexRevision) {
      indexedFiles = state.indexedFiles || [];
      indexedSearchRecords = indexedFiles.map(file => QuickFoldersSearch.createRecord(file));
      indexedSearchRevision = state.indexRevision;
    }
    if (selectedPaths.size > 0) {
      const selectableStateItems = state.atRoot && currentSearchQuery
        ? (state.items || []).concat(state.indexedFiles || [])
        : (state.items || []);
      const availablePaths = new Set(selectableStateItems.map((item) => item.path));
      selectedPaths = new Set(Array.from(selectedPaths).filter((path) => availablePaths.has(path)));
      if (selectionAnchorPath && !availablePaths.has(selectionAnchorPath)) selectionAnchorPath = null;
    }
    if (state.preferences) currentPreferences = { ...currentPreferences, ...state.preferences };
    updateHelpShortcuts();
    if (state.isIndexing) {
      spinnerContainer.classList.remove("hidden");
      searchBar.classList.add("hidden");
    } else if (state.indexReady) {
      spinnerContainer.classList.add("hidden");
      searchBar.classList.remove("hidden");
    }
    populateExtensionDropdown();
    
    renderItems();
    messageReceived = true;
  });

  iina.onMessage("item-action-result", (result) => {
    handleItemActionResult(result || {});
  });
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
const pane = document.querySelector(".pane");

setTimeout(() => {
  if (!messageReceived) {
    spinnerContainer.classList.add("hidden");
    searchBar.classList.remove("hidden");
  }
}, 100);

let currentFilter = "all";
let currentSearchQuery = "";
let compiledSearchQuery = QuickFoldersSearch.compileQuery("");
let availableExtensions = [];
let indexedFiles = [];
let indexedSearchRecords = [];
let indexedSearchRevision = null;
let searchRenderTimer = null;
let totalIndexedSearchMatches = 0;
let indexedResultCache = { key: null, files: [], total: 0 };
let selectedPaths = new Set();
let selectionAnchorPath = null;
let actionPending = false;
let toastTimer = null;
let helpReturnFocus = null;
const MAX_RENDERED_SEARCH_RESULTS = 500;
let currentPreferences = {
  filterImages: true,
  filterAudio: true,
  videoOnly: false,
  hideWatched: false,
  openWindowShortcut: "cmd+shift+a",
  addFolderShortcut: "n",
};

let currentState = {
  items: [],
  currentPath: null,
  atRoot: true,
  viewingWatched: false,
};

const thumbnailCache = new Map();
const pendingThumbnails = new Set();
const mediaMetadataCache = new Map();
const pendingMediaMetadata = new Set();
let thumbnailObserver = null;
const MAX_CACHED_THUMBNAILS = 200;
const MAX_CACHED_MEDIA_METADATA = 500;

function getFileIcon(filename, isDir) {
  if (isDir) return FILE_TYPE_ICONS.folder;
  const ext = filename.split(".").pop().toLowerCase();
  const fileType = getFileTypeByExt(ext);
  if (fileType === FILE_TYPES.VIDEO) return FILE_TYPE_ICONS.video;
  if (fileType === FILE_TYPES.AUDIO) return FILE_TYPE_ICONS.audio;
  if (fileType === FILE_TYPES.IMAGE) return FILE_TYPE_ICONS.image;
  return FILE_TYPE_ICONS.file;
}

function showThumbnail(thumbEl, dataUrl) {
  if (!dataUrl) return;

  const imageEl = document.createElement("img");
  imageEl.className = "thumbnail-image";
  imageEl.alt = "";
  imageEl.draggable = false;
  imageEl.src = dataUrl;
  thumbEl.textContent = "";
  thumbEl.appendChild(imageEl);
  thumbEl.classList.add("has-thumbnail");
}

function rememberThumbnail(filePath, dataUrl) {
  if (thumbnailCache.size >= MAX_CACHED_THUMBNAILS) {
    const oldestPath = thumbnailCache.keys().next().value;
    thumbnailCache.delete(oldestPath);
  }
  thumbnailCache.set(filePath, dataUrl || null);
}

function requestThumbnail(thumbEl, filePath) {
  if (thumbnailCache.has(filePath)) {
    showThumbnail(thumbEl, thumbnailCache.get(filePath));
    return;
  }
  if (pendingThumbnails.has(filePath)) return;

  pendingThumbnails.add(filePath);
  postMessage("request-thumbnail", { path: filePath });
}

function requestMediaMetadata(filePath) {
  if (mediaMetadataCache.has(filePath) || pendingMediaMetadata.has(filePath)) return;
  pendingMediaMetadata.add(filePath);
  postMessage("request-media-metadata", { path: filePath });
}

function rememberMediaMetadata(filePath, metadata) {
  if (mediaMetadataCache.size >= MAX_CACHED_MEDIA_METADATA) {
    mediaMetadataCache.delete(mediaMetadataCache.keys().next().value);
  }
  mediaMetadataCache.set(filePath, metadata || null);
}

function renderMediaMetadataChips(infoEl, filePath) {
  infoEl.querySelectorAll(".dynamic-metadata-chip").forEach((chip) => chip.remove());
  const metadata = mediaMetadataCache.get(filePath);
  if (!metadata) return;

  const values = [
    {
      value: QuickFoldersMediaMetadata.formatDuration(metadata.duration),
      className: "duration-chip",
      title: "Duration",
    },
    {
      value: QuickFoldersMediaMetadata.formatResolution(metadata.width, metadata.height),
      className: "resolution-chip",
      title: "Resolution",
    },
  ];
  const insertionPoint = infoEl.querySelector(".watched-tag, .size-chip, .path-metadata");
  values.forEach(({ value, className, title }) => {
    if (!value) return;
    const chip = document.createElement("span");
    chip.className = `metadata-chip dynamic-metadata-chip ${className}`;
    chip.textContent = value;
    chip.title = title;
    if (insertionPoint) infoEl.insertBefore(chip, insertionPoint);
    else infoEl.appendChild(chip);
  });
}

function observeThumbnail(thumbEl, filePath) {
  thumbEl.dataset.thumbnailPath = filePath;
  if (thumbnailObserver) {
    thumbnailObserver.observe(thumbEl);
  } else {
    requestThumbnail(thumbEl, filePath);
    requestMediaMetadata(filePath);
  }
}

// Keep the type icon visible until the real media thumbnail is ready.
function loadThumbnail(thumbEl, filePath, isDir) {
  const filename = filePath.split("/").pop();
  thumbEl.textContent = getFileIcon(filename, isDir);
  
  if (!isDir) {
    const ext = filename.split(".").pop().toLowerCase();
    const fileType = getFileTypeByExt(ext);
    if (fileType !== FILE_TYPES.OTHER) {
      thumbEl.classList.add(`${fileType}-${ext}`);
    } else if (ext && ext !== filename) {
      thumbEl.classList.add('other');
    }

    observeThumbnail(thumbEl, filePath);
  }
}

if (typeof IntersectionObserver !== "undefined") {
  thumbnailObserver = new IntersectionObserver((entries) => {
    entries.forEach((entry) => {
      if (!entry.isIntersecting) return;
      const filePath = entry.target.dataset.thumbnailPath;
      thumbnailObserver.unobserve(entry.target);
      requestThumbnail(entry.target, filePath);
      requestMediaMetadata(filePath);
    });
  }, {
    root: itemListEl,
    rootMargin: "100px 0px",
  });
}

if (typeof iina !== "undefined" && iina.onMessage) {
  iina.onMessage("thumbnail-ready", (data) => {
    if (!data || typeof data.path !== "string") return;
    const { path, dataUrl } = data;
    pendingThumbnails.delete(path);
    rememberThumbnail(path, dataUrl);

    document.querySelectorAll(".thumb[data-thumbnail-path]").forEach((thumbEl) => {
      if (thumbEl.dataset.thumbnailPath === path) {
        showThumbnail(thumbEl, dataUrl);
      }
    });
  });

  iina.onMessage("media-metadata-ready", (data) => {
    if (!data || typeof data.path !== "string") return;
    pendingMediaMetadata.delete(data.path);
    rememberMediaMetadata(data.path, data.metadata);
    document.querySelectorAll(".info[data-media-path]").forEach((infoEl) => {
      if (infoEl.dataset.mediaPath === data.path) {
        renderMediaMetadataChips(infoEl, data.path);
      }
    });
  });
}

function getRelativePath(fullPath, currentPath) {
  if (!currentPath) return fullPath;
  
  // Normalize paths
  const normalizedFull = fullPath.replace(/\/$/, "");
  const normalizedCurrent = currentPath.replace(/\/$/, "");
  
  // If file is in current directory or its subdirectories
  if (normalizedFull.startsWith(normalizedCurrent + "/")) {
    const relativePart = normalizedFull.substring(normalizedCurrent.length + 1);
    const dirPart = relativePart.split("/").slice(0, -1).join("/");
    return dirPart ? "../" + dirPart + "/" : "../";
  }
  
  // Otherwise, just strip /Users/username/ if present
  const userHomeMatch = normalizedFull.match(/^\/Users\/[^\/]+\//);
  if (userHomeMatch) {
    return "~/" + normalizedFull.substring(userHomeMatch[0].length);
  }
  
  return fullPath;
}

function formatFileSize(bytes) {
  if (!bytes || bytes === 0) return "";
  
  const units = ["B", "KB", "MB", "GB", "TB"];
  let size = bytes;
  let unitIndex = 0;
  
  while (size >= 1024 && unitIndex < units.length - 1) {
    size /= 1024;
    unitIndex++;
  }
  
  return `${size.toFixed(unitIndex === 0 ? 0 : 1)} ${units[unitIndex]}`;
}

function matchesSearch(item) {
  if (!currentSearchQuery) return true;
  return QuickFoldersSearch.match(
    QuickFoldersSearch.createRecord(item),
    compiledSearchQuery
  ).matches;
}

function matchesFilter(item) {
  return QuickFoldersBrowseState.matchesFileFilter(item, currentFilter, getFileTypeByExt);
}

function getFilteredItems() {
  let items = currentState.items;
  totalIndexedSearchMatches = 0;
  
  // If there's a search query at root level, include matching files from indexed files
  if (currentSearchQuery && currentState.atRoot) {
    const cacheKey = `${indexedSearchRevision}\u0000${currentFilter}\u0000${currentSearchQuery}`;
    let topMatchingFiles;

    if (indexedResultCache.key === cacheKey) {
      topMatchingFiles = indexedResultCache.files;
      totalIndexedSearchMatches = indexedResultCache.total;
    } else {
      const matchingFiles = [];
      for (const record of indexedSearchRecords) {
        const result = QuickFoldersSearch.match(record, compiledSearchQuery);
        if (result.matches && matchesFilter(record.item)) {
          matchingFiles.push({ file: record.item, score: result.score });
        }
      }
      matchingFiles.sort((left, right) => right.score - left.score);
      totalIndexedSearchMatches = matchingFiles.length;
      topMatchingFiles = matchingFiles.slice(0, MAX_RENDERED_SEARCH_RESULTS);
      indexedResultCache = {
        key: cacheKey,
        files: topMatchingFiles,
        total: totalIndexedSearchMatches,
      };
    }
    
    // Convert indexed files to item format for display
    const searchResults = topMatchingFiles.map(result => ({
      path: result.file.path,
      name: result.file.name,
      isDir: false,
      size: null,
      fromSearch: true, // Mark to show folder path
      watched: Boolean(result.file.watched),
    }));
    
    // Combine folders that contain matches with the matching files
    items = [
      ...currentState.items.filter(item => matchesSearch(item)),
      ...searchResults,
    ];
  } else {
    items = items.filter(item => matchesSearch(item));
  }
  
  // Apply filter (type/extension) and optionally keep watched files in their
  // dedicated virtual folder only.
  return items.filter((item) => {
    if (!matchesFilter(item)) return false;
    if (currentPreferences.hideWatched && !currentState.viewingWatched && item.watched) return false;
    return true;
  });
}

function populateExtensionDropdown() {
  // Clear existing options
  videoGroup.innerHTML = "";
  audioGroup.innerHTML = "";
  imageGroup.innerHTML = "";
  otherGroup.innerHTML = "";

  const extensionGroups = QuickFoldersBrowseState.groupAvailableExtensions(
    availableExtensions,
    currentPreferences
  );
  const videoExts = extensionGroups.video;
  const audioExts = extensionGroups.audio;
  const imageExts = extensionGroups.image;

  // Add options to appropriate groups (only if they have extensions)
  if (videoExts.length > 0) {
    videoExts.forEach(ext => {
      const option = document.createElement("option");
      option.value = "ext:" + ext;
      option.textContent = ext.toUpperCase();
      videoGroup.appendChild(option);
    });
  }

  if (audioExts.length > 0) {
    audioExts.forEach(ext => {
      const option = document.createElement("option");
      option.value = "ext:" + ext;
      option.textContent = ext.toUpperCase();
      audioGroup.appendChild(option);
    });
  }

  if (imageExts.length > 0) {
    imageExts.forEach(ext => {
      const option = document.createElement("option");
      option.value = "ext:" + ext;
      option.textContent = ext.toUpperCase();
      imageGroup.appendChild(option);
    });
  }

  const reconciledFilter = QuickFoldersBrowseState.reconcileExtensionFilter(currentFilter, extensionGroups);
  if (!(currentState.isIndexing && currentFilter !== "all" && reconciledFilter === "all")) {
    currentFilter = reconciledFilter;
  }
  filterDropdown.value = currentFilter;
}

function getSelectableItems() {
  return getFilteredItems().filter((item) => !item.isDir);
}

function getSelectedItems() {
  return getSelectableItems().filter((item) => selectedPaths.has(item.path));
}

function clearSelection(shouldRender = true) {
  selectedPaths.clear();
  selectionAnchorPath = null;
  if (shouldRender) renderItems();
}

function selectItem(item, event) {
  const result = QuickFoldersBrowseState.updateSelection({
    visiblePaths: getSelectableItems().map((entry) => entry.path),
    selectedPaths: Array.from(selectedPaths),
    anchorPath: selectionAnchorPath,
    targetPath: item.path,
    additive: Boolean(event.metaKey || event.ctrlKey),
    range: Boolean(event.shiftKey),
  });
  selectedPaths = new Set(result.selectedPaths);
  selectionAnchorPath = result.anchorPath;
  renderItems();
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
}

function setSelectedWatched() {
  if (actionPending) return;
  const items = getSelectedItems();
  if (items.length === 0) return;
  const watched = !items.every((item) => item.watched);
  actionPending = true;
  updateActionBar();
  postMessage("set-watched", { paths: items.map((item) => item.path), watched });
}

function openSelectedItem() {
  const items = getSelectedItems();
  if (items.length !== 1) return;
  postMessage("open-item", { path: items[0].path, isDir: false });
}

function showDeleteConfirmation() {
  if (actionPending || !deleteModal) return;
  const items = getSelectedItems();
  if (items.length === 0) return;
  deleteModalMessage.textContent = items.length === 1
    ? `“${items[0].name}” will be permanently deleted. This cannot be undone.`
    : `${items.length} files will be permanently deleted. This cannot be undone.`;
  deleteModal.classList.remove("hidden");
  confirmDeleteBtn.focus();
}

function hideDeleteConfirmation() {
  if (deleteModal) deleteModal.classList.add("hidden");
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

function showKeyboardHelp() {
  if (!helpModal || !helpModal.classList.contains("hidden")) return;
  helpReturnFocus = document.activeElement;
  updateHelpShortcuts();
  helpModal.classList.remove("hidden");
  if (pane) pane.setAttribute("inert", "");
  if (helpBtn) helpBtn.setAttribute("aria-expanded", "true");
  if (closeHelpBtn) closeHelpBtn.focus();
}

function hideKeyboardHelp() {
  if (!helpModal || helpModal.classList.contains("hidden")) return;
  helpModal.classList.add("hidden");
  if (pane) pane.removeAttribute("inert");
  if (helpBtn) helpBtn.setAttribute("aria-expanded", "false");
  const returnTarget = helpReturnFocus;
  helpReturnFocus = null;
  if (returnTarget && document.contains(returnTarget) && typeof returnTarget.focus === "function") {
    returnTarget.focus();
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

function deleteSelectedItems() {
  if (actionPending) return;
  const items = getSelectedItems();
  if (items.length === 0) return;
  hideDeleteConfirmation();
  actionPending = true;
  updateActionBar();
  postMessage("delete-items", { paths: items.map((item) => item.path) });
}

function renderItems() {
  if (thumbnailObserver) thumbnailObserver.disconnect();
  const filteredItems = getFilteredItems();

  itemListEl.innerHTML = "";
  updateActionBar();

  // Update back button
  backBtn.classList.toggle("hidden", currentState.atRoot);
  
  // Show/hide depth warning if folder depth exceeds indexing limit
  if (depthWarning) {
    const folderDepth = currentState.folderDepth || 0;
    const maxDepth = currentState.preferences?.maxIndexDepth || 3;
    depthWarning.classList.toggle("hidden", folderDepth < maxDepth);
  }

  // Update breadcrumb
  breadcrumb.innerHTML = "";
  if (currentState.atRoot) {
    breadcrumb.textContent = "Quick Folders";
    breadcrumb.classList.add("breadcrumb-root");
  } else if (currentState.viewingWatched) {
    breadcrumb.textContent = "Watched";
    breadcrumb.title = "Watched media";
    breadcrumb.classList.add("breadcrumb-root");
  } else {
    breadcrumb.classList.remove("breadcrumb-root");
    // Strip /Users/username/ and show the full path
    let displayPath = currentState.currentPath;
    const userHomeMatch = displayPath.match(/^\/Users\/[^\/]+\//);
    if (userHomeMatch) {
      displayPath = displayPath.substring(userHomeMatch[0].length);
    }
    breadcrumb.title = currentState.currentPath;
    
    // Split path into segments
    let segments = displayPath.split("/").filter(Boolean);
    
    // Truncate long folder names with ellipses in middle
    segments = segments.map(seg => {
      if (seg.length > 30) {
        const start = seg.substring(0, 12);
        const end = seg.substring(seg.length - 12);
        return start + "..." + end;
      }
      return seg;
    });
    
    // Build breadcrumb first to check if truncation needed
    const renderBreadcrumb = (segs) => {
      breadcrumb.innerHTML = "";
      segs.forEach((segment, index) => {
        const isLast = index === segs.length - 1;
        
        // Create segment element
        const segmentEl = document.createElement("span");
        segmentEl.className = isLast ? "breadcrumb-current" : "breadcrumb-parent";
        segmentEl.textContent = segment;
        
        // Make parent segments clickable
        if (!isLast) {
          segmentEl.setAttribute("role", "button");
          segmentEl.tabIndex = 0;
          segmentEl.addEventListener("click", () => {
          // Reconstruct path up to this segment
          let reconstructedPath = currentState.currentPath;
          const fullSegments = reconstructedPath.split("/").filter(Boolean);
          
          // Find where displayPath starts in the full path
          const startIndex = fullSegments.length - segments.length;
          const targetIndex = startIndex + index;
          const targetPath = "/" + fullSegments.slice(0, targetIndex + 1).join("/");
          if (searchRenderTimer) {
            clearTimeout(searchRenderTimer);
            searchRenderTimer = null;
          }
          currentSearchQuery = "";
          compiledSearchQuery = QuickFoldersSearch.compileQuery("");
          if (searchInput) searchInput.value = "";
          
          postMessage("navigate-to", { path: targetPath });
        });
          segmentEl.addEventListener("keydown", (event) => {
            if (event.key === "Enter" || event.key === " ") {
              event.preventDefault();
              segmentEl.click();
            }
          });
      }
      
      breadcrumb.appendChild(segmentEl);
        
        // Add separator
        if (!isLast) {
          const separator = document.createElement("span");
          separator.className = "breadcrumb-separator";
          separator.textContent = "/";
          breadcrumb.appendChild(separator);
        }
      });
    };
    
    // Render breadcrumb and check if truncation needed
    renderBreadcrumb(segments);
    
    // If breadcrumb overflows, progressively truncate parent segments
    setTimeout(() => {
      const breadcrumbWidth = breadcrumb.scrollWidth;
      const containerWidth = breadcrumb.clientWidth;
      
      if (breadcrumbWidth > containerWidth && segments.length > 1) {
        // Replace parent segments with ".." from left to right
        let truncatedSegments = [...segments];
        for (let i = 0; i < segments.length - 1; i++) {
          truncatedSegments[i] = "..";
          renderBreadcrumb(truncatedSegments);
          
          // Check if it fits now
          if (breadcrumb.scrollWidth <= breadcrumb.clientWidth) {
            break;
          }
        }
      }
    }, 0);
  }

  if (currentState.items.length === 0) {
    const emptyMsg = document.createElement("div");
    emptyMsg.className = "empty";
    emptyMsg.textContent = currentState.viewingWatched
      ? "No watched items"
      : currentState.atRoot ? "No folders added yet" : "Empty folder";
    itemListEl.appendChild(emptyMsg);
    return;
  }

  if (filteredItems.length === 0) {
    const noResultsMsg = document.createElement("div");
    noResultsMsg.className = "empty";
    if (currentSearchQuery) noResultsMsg.textContent = "No results match your search";
    else if (currentFilter !== "all") noResultsMsg.textContent = "No files match this filter";
    else if (currentPreferences.hideWatched) noResultsMsg.textContent = "No unwatched items in this folder";
    else noResultsMsg.textContent = "No items to display";
    itemListEl.appendChild(noResultsMsg);
    return;
  }

  if (totalIndexedSearchMatches > MAX_RENDERED_SEARCH_RESULTS) {
    const resultsSummary = document.createElement("div");
    resultsSummary.className = "results-summary";
    resultsSummary.textContent = `Showing the top ${MAX_RENDERED_SEARCH_RESULTS.toLocaleString()} of ${totalIndexedSearchMatches.toLocaleString()} file matches`;
    itemListEl.appendChild(resultsSummary);
  }

  const groupedItems = QuickFoldersBrowseState.partitionWatched(filteredItems);
  const orderedItems = groupedItems.active.concat(groupedItems.watched);

  orderedItems.forEach((item, itemIndex) => {
    if (
      item.watched &&
      !currentState.viewingWatched &&
      (itemIndex === 0 || !orderedItems[itemIndex - 1].watched)
    ) {
      const sectionEl = document.createElement("div");
      sectionEl.className = "section-label";
      sectionEl.textContent = `Watched · ${groupedItems.watched.length}`;
      itemListEl.appendChild(sectionEl);
    }

    const rowEl = document.createElement("div");
    rowEl.className = "row";
    rowEl.dataset.path = item.path;
    rowEl.setAttribute("role", "option");
    rowEl.setAttribute("aria-selected", String(selectedPaths.has(item.path)));
    if (item.watched) rowEl.classList.add("watched");
    if (selectedPaths.has(item.path)) rowEl.classList.add("selected");
    
    // Disable clicking on items during indexing
    if (currentState.isIndexing) {
      rowEl.classList.add("disabled");
    }

    // Thumbnail/icon area
    const thumbEl = document.createElement("div");
    thumbEl.className = "thumb";
    loadThumbnail(thumbEl, item.path, item.isDir);

    // Content area
    const metaEl = document.createElement("div");
    metaEl.className = "meta";

    // Title (filename without extension for files)
    const titleEl = document.createElement("div");
    titleEl.className = "title";
    if (item.isDir) {
      titleEl.textContent = item.name;
      titleEl.title = item.name;
    } else {
      const lastDot = item.name.lastIndexOf(".");
      const nameWithoutExt = lastDot > 0 ? item.name.substring(0, lastDot) : item.name;
      titleEl.textContent = nameWithoutExt;
      // Full filename with extension as tooltip
      titleEl.title = item.name;
      titleEl.setAttribute("data-full-name", item.name);
    }

    // Info area (extension tag and metadata for files, path for folders at root only)
    const infoEl = document.createElement("div");
    infoEl.className = "info";
    
    if (item.isDir) {
      if (item.scanning) {
        infoEl.classList.add("info-scanning");
        const scanWrapper = document.createElement("div");
        scanWrapper.className = "scan-bar-wrapper";
        const scanBar = document.createElement("div");
        scanBar.className = "scan-bar";
        scanWrapper.appendChild(scanBar);
        infoEl.appendChild(scanWrapper);
      } else {
        if (item.isWatchedRoot) {
          infoEl.textContent = `${item.watchedCount || 0} item${item.watchedCount === 1 ? "" : "s"}`;
          infoEl.title = "Show watched media";
        }
        // For folders at root, show the path; for subdirectories, show nothing
        else if (currentState.atRoot) {
          let displayPath = item.path;
          const userHomeMatch = displayPath.match(/^\/Users\/[^\/]+\//);
          if (userHomeMatch) {
            displayPath = displayPath.substring(userHomeMatch[0].length);
          }
          infoEl.textContent = displayPath;
        }
        if (!item.isWatchedRoot) infoEl.title = item.path;
      }
    } else {
      // For files, show extension tag and metadata
      infoEl.dataset.mediaPath = item.path;
      const lastDot = item.name.lastIndexOf(".");
      const ext = lastDot > 0 ? item.name.substring(lastDot + 1).toLowerCase() : "file";
      const extUpper = ext.toUpperCase();
      
      const extTag = document.createElement("span");
      extTag.className = "ext-tag";
      
      // Add specific color class based on file type and extension
      if (/^(mp4|mkv|avi|mov|flv|wmv|webm|m4v|3gp|ts|mts|m2ts|mxf)$/.test(ext)) {
        extTag.classList.add(`video-${ext}`);
      } else if (/^(mp3|aac|flac|ogg|wav|wma|aiff|opus|m4a)$/.test(ext)) {
        extTag.classList.add(`audio-${ext}`);
      } else if (/^(jpg|jpeg|png|gif|bmp|webp|svg|tiff|ico)$/.test(ext)) {
        extTag.classList.add(`image-${ext}`);
      } else {
        extTag.classList.add('other');
      }
      
      extTag.textContent = extUpper;
      infoEl.appendChild(extTag);

      renderMediaMetadataChips(infoEl, item.path);

      if (item.watched) {
        const watchedTag = document.createElement("span");
        watchedTag.className = "watched-tag";
        watchedTag.textContent = "Watched";
        infoEl.appendChild(watchedTag);
      }
      
      // Show file size if available
      if (item.size) {
        const sizeSpan = document.createElement("span");
        sizeSpan.className = "metadata-chip size-chip";
        sizeSpan.textContent = formatFileSize(item.size);
        sizeSpan.title = "File size";
        infoEl.appendChild(sizeSpan);
      }
      
      // If this is a search result (file from a subfolder), show the containing folder path
      if ((item.fromSearch && currentSearchQuery) || item.fromWatchedView) {
        const pathSpan = document.createElement("span");
        pathSpan.className = "metadata path-metadata";
        
        // Get the folder path
        const lastSlash = item.path.lastIndexOf("/");
        let folderPath = lastSlash > 0 ? item.path.substring(0, lastSlash) : item.path;
        
        // Strip user home directory
        const userHomeMatch = folderPath.match(/^\/Users\/[^\/]+\//);
        if (userHomeMatch) {
          folderPath = folderPath.substring(userHomeMatch[0].length);
        }
        
        pathSpan.textContent = folderPath;
        pathSpan.style.opacity = "0.7";
        infoEl.appendChild(pathSpan);
      }
      
      // Placeholder for duration and resolution (would need backend support)
      // Future: add duration (HH:MM:SS or MM:SS) and resolution (1080p, 320kbps, etc.)
      
      // Show full path in title for reference
      infoEl.title = item.path;
    }

    metaEl.appendChild(titleEl);
    metaEl.appendChild(infoEl);

    rowEl.appendChild(thumbEl);
    rowEl.appendChild(metaEl);

    // Folders retain one-click navigation; files use standard multi-selection.
    if (!currentState.isIndexing) {
      rowEl.addEventListener("click", (event) => {
        if (item.isDir) {
          clearSelection(false);
          postMessage("open-item", {
            path: item.path,
            isDir: true,
            isWatchedRoot: Boolean(item.isWatchedRoot),
          });
        } else {
          selectItem(item, event);
        }
      });
      if (!item.isDir) {
        rowEl.addEventListener("dblclick", () => {
          postMessage("open-item", { path: item.path, isDir: false });
        });
      }
    }

    if (!item.isDir) {
      const selectionEl = document.createElement("span");
      selectionEl.className = "selection-indicator";
      selectionEl.setAttribute("aria-hidden", "true");
      selectionEl.textContent = "✓";
      rowEl.appendChild(selectionEl);
    }

    // Remove button for root folders
    if (currentState.atRoot && item.isRoot) {
      const removeBtn = document.createElement("button");
      removeBtn.className = "remove-btn";
      removeBtn.innerHTML = `
        <span class='remove-icon'>
          <svg viewBox="0 0 16 16" aria-hidden="true">
            <path d="M4 4l8 8M12 4l-8 8" />
          </svg>
        </span>
        <span class='remove-text'>Remove</span>
      `;
      removeBtn.title = "Remove folder";
      removeBtn.addEventListener("click", (e) => {
        e.stopPropagation();
        postMessage("remove-root", { path: item.path });
      });
      rowEl.appendChild(removeBtn);
    }

    itemListEl.appendChild(rowEl);
  });
}

// Back button handler
backBtn.addEventListener("click", () => {
  postMessage("go-back");
});

// Add Folder button handler
if (addFolderBtn) {
  addFolderBtn.addEventListener("click", () => {
    postMessage("add-folder");
  });
}

// Refresh button handler
if (refreshBtn) {
  refreshBtn.addEventListener("click", () => {
    postMessage("refresh-index");
  });
}

if (helpBtn) helpBtn.addEventListener("click", showKeyboardHelp);
if (closeHelpBtn) closeHelpBtn.addEventListener("click", hideKeyboardHelp);
if (helpModal) {
  helpModal.addEventListener("click", (event) => {
    if (event.target === helpModal) hideKeyboardHelp();
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
    if (searchRenderTimer) {
      clearTimeout(searchRenderTimer);
      searchRenderTimer = null;
    }
    currentSearchQuery = "";
    clearSelection(false);
    compiledSearchQuery = QuickFoldersSearch.compileQuery("");
    if (searchInput) {
      searchInput.value = "";
      searchInput.focus();
    }
    renderItems();
  });
}

// Filter dropdown handler
if (filterDropdown) {
  filterDropdown.addEventListener("change", (e) => {
    clearSelection(false);
    currentFilter = e.target.value;
    renderItems();
  });
}

if (watchBtn) watchBtn.addEventListener("click", setSelectedWatched);
if (deleteBtn) deleteBtn.addEventListener("click", showDeleteConfirmation);
if (cancelSelectionBtn) cancelSelectionBtn.addEventListener("click", () => clearSelection());
if (cancelDeleteBtn) cancelDeleteBtn.addEventListener("click", hideDeleteConfirmation);
if (confirmDeleteBtn) {
  confirmDeleteBtn.addEventListener("click", deleteSelectedItems);
}
if (deleteModal) {
  deleteModal.addEventListener("click", (event) => {
    if (event.target === deleteModal) hideDeleteConfirmation();
  });
}

document.addEventListener("keydown", (event) => {
  if (!deleteModal.classList.contains("hidden")) {
    if (event.key === "Escape") hideDeleteConfirmation();
    return;
  }

  if (helpModal && !helpModal.classList.contains("hidden")) {
    if (event.key === "Escape" || event.key === "?") {
      event.preventDefault();
      hideKeyboardHelp();
    } else if (event.key === "Tab") {
      event.preventDefault();
      closeHelpBtn.focus();
    }
    return;
  }

  const target = event.target;
  const isTyping = target && (
    target.tagName === "INPUT" || target.tagName === "SELECT" || target.tagName === "TEXTAREA"
  );
  if (isTyping) return;

  if (event.key === "?" && !event.metaKey && !event.ctrlKey && !event.altKey) {
    event.preventDefault();
    showKeyboardHelp();
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
  } else if (event.key === "Enter") {
    openSelectedItem();
  }
});


// Request initial state from main.js
postMessage("request-state");

// Also request state after a delay to ensure we get updates
setTimeout(() => {
  postMessage("request-state");
}, 500);

// Render initial empty state
renderItems();
