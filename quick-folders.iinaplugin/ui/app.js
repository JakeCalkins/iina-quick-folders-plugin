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
    currentState = state || {};
    availableExtensions = state.availableExtensions || [];
    indexedFiles = state.indexedFiles || [];
    if (state.preferences) currentPreferences = state.preferences;
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
}

const itemListEl = document.getElementById("item-list");
const backBtn = document.getElementById("back-btn");
const breadcrumb = document.getElementById("breadcrumb");
const addFolderBtn = document.getElementById("add-folder-btn");
const refreshBtn = document.getElementById("refresh-btn");
const searchInput = document.getElementById("search-input");
const clearSearchBtn = document.getElementById("clear-search-btn");
const filterDropdown = document.getElementById("filter-dropdown");
const videoGroup = document.getElementById("video-group");
const audioGroup = document.getElementById("audio-group");
const imageGroup = document.getElementById("image-group");
const otherGroup = document.getElementById("other-group");
const depthWarning = document.getElementById("depth-warning");

setTimeout(() => {
  if (!messageReceived) {
    spinnerContainer.classList.add("hidden");
    searchBar.classList.remove("hidden");
  }
}, 100);

let currentFilter = "all";
let currentSearchQuery = "";
let availableExtensions = [];
let indexedFiles = [];
let currentPreferences = {
  filterImages: true,
  filterAudio: true,
  videoOnly: false,
};

let currentState = {
  items: [],
  currentPath: null,
  atRoot: true,
};

function getFileIcon(filename, isDir) {
  if (isDir) return FILE_TYPE_ICONS.folder;
  const ext = filename.split(".").pop().toLowerCase();
  const fileType = getFileTypeByExt(ext);
  if (fileType === FILE_TYPES.VIDEO) return FILE_TYPE_ICONS.video;
  if (fileType === FILE_TYPES.AUDIO) return FILE_TYPE_ICONS.audio;
  if (fileType === FILE_TYPES.IMAGE) return FILE_TYPE_ICONS.image;
  return FILE_TYPE_ICONS.file;
}

// Try to load thumbnail from macOS filesystem if available
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
  }
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
  const query = currentSearchQuery.toLowerCase();
  return item.name.toLowerCase().includes(query);
}

function matchesFilter(item) {
  if (currentFilter === "all") return true;
  
  // If filter is by extension (e.g., "ext:mp4")
  if (currentFilter.startsWith("ext:")) {
    const ext = currentFilter.substring(4).toLowerCase();
    if (item.isDir) return false;
    return item.name.toLowerCase().endsWith("." + ext);
  }
  
  // Type-based filter (video, audio, image, other)
  if (item.isDir) return false;
  return getFileType(item.name) === currentFilter;
}

function getFilteredItems() {
  let items = currentState.items;
  
  // If there's a search query at root level, include matching files from indexed files
  if (currentSearchQuery && currentState.atRoot) {
    const query = currentSearchQuery.toLowerCase();
    const matchingFiles = indexedFiles.filter(f => 
      f.name.toLowerCase().includes(query)
    );
    
    // Convert indexed files to item format for display
    const searchResults = matchingFiles.map(f => ({
      path: f.path,
      name: f.name,
      isDir: false,
      size: null,
      fromSearch: true, // Mark to show folder path
    }));
    
    // Combine folders that contain matches with the matching files
    items = [
      ...currentState.items.filter(item => matchesSearch(item)),
      ...searchResults,
    ];
  } else {
    items = items.filter(item => matchesSearch(item));
  }
  
  // Apply filter (type/extension)
  return items.filter(item => matchesFilter(item));
}

function populateExtensionDropdown() {
  // Clear existing options
  videoGroup.innerHTML = "";
  audioGroup.innerHTML = "";
  imageGroup.innerHTML = "";
  otherGroup.innerHTML = "";

  // Group extensions by type (only include main types, skip "other")
  const videoExts = [];
  const audioExts = [];
  const imageExts = [];

  for (const ext of availableExtensions) {
    const extLower = ext.toLowerCase();
    if (/^(mp4|mkv|avi|mov|flv|wmv|webm|m4v|3gp|ts|mts|m2ts|mxf)$/.test(extLower)) {
      // Skip video if videoOnly mode is off and filterImages is on
      if (!currentPreferences.videoOnly && !currentPreferences.filterAudio) {
        videoExts.push(ext);
      } else if (currentPreferences.videoOnly) {
        // Always show video in video-only mode
        videoExts.push(ext);
      } else if (!currentPreferences.filterAudio) {
        // If not in video-only mode, show video if filterAudio is off
        videoExts.push(ext);
      }
    } else if (/^(mp3|aac|flac|ogg|wav|wma|aiff|opus|m4a)$/.test(extLower)) {
      // Only show audio if filterAudio is false (filter is OFF)
      if (!currentPreferences.filterAudio && !currentPreferences.videoOnly) {
        audioExts.push(ext);
      }
    } else if (/^(jpg|jpeg|png|gif|bmp|webp|svg|tiff|ico)$/.test(extLower)) {
      // Only show images if filterImages is false (filter is OFF)
      if (!currentPreferences.filterImages && !currentPreferences.videoOnly) {
        imageExts.push(ext);
      }
    }
    // Skip "other" extensions
  }

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
}

function renderItems() {
  const filteredItems = getFilteredItems();

  itemListEl.innerHTML = "";

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
          segmentEl.style.cursor = "pointer";
          segmentEl.addEventListener("click", () => {
          // Reconstruct path up to this segment
          let reconstructedPath = currentState.currentPath;
          const fullSegments = reconstructedPath.split("/").filter(Boolean);
          
          // Find where displayPath starts in the full path
          const startIndex = fullSegments.length - segments.length;
          const targetIndex = startIndex + index;
          const targetPath = "/" + fullSegments.slice(0, targetIndex + 1).join("/");
          currentSearchQuery = "";
          if (searchInput) searchInput.value = "";
          
          postMessage("navigate-to", { path: targetPath });
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
        // Replace parent segments with "../" from left to right
        let truncatedSegments = [...segments];
        for (let i = 0; i < segments.length - 1; i++) {
          truncatedSegments[i] = "../";
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
    emptyMsg.textContent = currentState.atRoot ? "No folders added yet" : "Empty folder";
    itemListEl.appendChild(emptyMsg);
    return;
  }

  if (filteredItems.length === 0) {
    const noResultsMsg = document.createElement("div");
    noResultsMsg.className = "empty";
    noResultsMsg.textContent = "No results match your search";
    itemListEl.appendChild(noResultsMsg);
    return;
  }

  filteredItems.forEach((item) => {
    const rowEl = document.createElement("div");
    rowEl.className = "row";
    
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
      // For folders at root, show the path; for subdirectories, show nothing
      if (currentState.atRoot) {
        let displayPath = item.path;
        const userHomeMatch = displayPath.match(/^\/Users\/[^\/]+\//);
        if (userHomeMatch) {
          displayPath = displayPath.substring(userHomeMatch[0].length);
        }
        infoEl.textContent = displayPath;
      }
      infoEl.title = item.path;
    } else {
      // For files, show extension tag and metadata
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
      
      // Show file size if available
      if (item.size) {
        const sizeSpan = document.createElement("span");
        sizeSpan.className = "metadata";
        sizeSpan.textContent = formatFileSize(item.size);
        infoEl.appendChild(sizeSpan);
      }
      
      // If this is a search result (file from a subfolder), show the containing folder path
      if (item.fromSearch && currentSearchQuery) {
        const pathSpan = document.createElement("span");
        pathSpan.className = "metadata";
        
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

    // Click handler - disabled during indexing
    if (!currentState.isIndexing) {
      rowEl.addEventListener("click", () => {
        postMessage("open-item", { path: item.path, isDir: item.isDir });
      });
    }

    // Remove button for root folders
    if (currentState.atRoot && item.isRoot) {
      const removeBtn = document.createElement("button");
      removeBtn.className = "remove-btn";
      removeBtn.innerHTML = `
        <span class='remove-icon'>
          <svg viewBox="0 0 12 12" fill="none" xmlns="http://www.w3.org/2000/svg">
            <path d="M2 2L10 10M10 2L2 10" stroke="currentColor"/>
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

// Search input handler
if (searchInput) {
  searchInput.addEventListener("input", (e) => {
    currentSearchQuery = e.target.value;
    renderItems();
  });
}

// Clear search button handler
if (clearSearchBtn) {
  clearSearchBtn.addEventListener("click", () => {
    currentSearchQuery = "";
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
    currentFilter = e.target.value;
    renderItems();
  });
}


// Request initial state from main.js
postMessage("request-state");

// Also request state after a delay to ensure we get updates
setTimeout(() => {
  postMessage("request-state");
}, 500);

// Render initial empty state
renderItems();
