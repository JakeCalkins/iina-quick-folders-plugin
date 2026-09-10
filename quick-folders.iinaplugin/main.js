const { console, core, file, utils, menu, standaloneWindow, preferences } = iina;
const BrowseState = require("./browse-state.js");
const FileTypes = require("./file-types.js");
const MediaMetadata = require("./media-metadata.js");
const { createAsyncResourceLoader } = require("./async-resource-loader.js");


const STATE_FILE = "@data/quick-folders-state.json";
const DEBUG_LOG_FILE = "@data/quick-folders-debug.log";
const DEFAULT_MAX_INDEX_DEPTH = 3;
const THUMBNAIL_SIZE = 128;
const MAX_THUMBNAILS_IN_MEMORY = 200;
const MAX_CONCURRENT_THUMBNAILS = 2;
const THUMBNAIL_TOOL = "/usr/bin/qlmanage";
const METADATA_TOOL = "/usr/bin/mdls";
const THUMBNAIL_CACHE_DIR = `@tmp/quick-folders-thumbnails/${Date.now()}`;

const { FILE_TYPES, SKIP_DIRECTORIES, getFileTypeByExt, isPlayableFile } = FileTypes;
const MAX_DEBUG_LINES = 1000;
const DEBUG_FLUSH_DELAY = 250;

let thumbnailJobSequence = 0;
const MAX_CONCURRENT_METADATA_JOBS = 3;
const MAX_MEDIA_METADATA_IN_MEMORY = 500;

function encodeBase64(bytes) {
  const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
  let encoded = "";

  for (let i = 0; i < bytes.length; i += 3) {
    const first = bytes[i];
    const second = i + 1 < bytes.length ? bytes[i + 1] : 0;
    const third = i + 2 < bytes.length ? bytes[i + 2] : 0;
    const combined = (first << 16) | (second << 8) | third;

    encoded += alphabet[(combined >> 18) & 63];
    encoded += alphabet[(combined >> 12) & 63];
    encoded += i + 1 < bytes.length ? alphabet[(combined >> 6) & 63] : "=";
    encoded += i + 2 < bytes.length ? alphabet[combined & 63] : "=";
  }

  return encoded;
}

function hashPath(path) {
  let hash = 2166136261;
  for (let i = 0; i < path.length; i++) {
    hash ^= path.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(16);
}

function isPathInFolderRoots(path) {
  return BrowseState.isPathWithinRoots(path, folderRoots);
}

function readThumbnailDataUrl(path) {
  let handle = null;
  try {
    handle = file.handle(path, "read");
    const bytes = handle.readToEnd();
    if (!bytes || bytes.length === 0) return null;
    return `data:image/png;base64,${encodeBase64(bytes)}`;
  } catch (err) {
    return null;
  } finally {
    if (handle) {
      try {
        handle.close();
      } catch (err) {
        // Ignore close errors
      }
    }
  }
}

async function generateThumbnail(path) {
  if (!utils.fileInPath(THUMBNAIL_TOOL)) return null;

  const outputDir = `${THUMBNAIL_CACHE_DIR}/${hashPath(path)}-${thumbnailJobSequence++}`;
  const mkdirResult = await utils.exec("/bin/mkdir", ["-p", utils.resolvePath(outputDir)]);
  if (mkdirResult.status !== 0) return null;

  const result = await utils.exec(THUMBNAIL_TOOL, [
    "-t",
    "-s", String(THUMBNAIL_SIZE),
    "-o", utils.resolvePath(outputDir),
    path,
  ]);
  if (result.status !== 0) return null;

  const generatedFiles = file.list(outputDir, { includeSubDir: false }) || [];
  const thumbnail = generatedFiles.find((item) => {
    const name = item.filename || item.name || "";
    return !(item.isDir || item.is_dir) && name.toLowerCase().endsWith(".png");
  });
  if (!thumbnail) return null;

  const thumbnailPath = thumbnail.path || `${outputDir}/${thumbnail.filename || thumbnail.name}`;
  return readThumbnailDataUrl(thumbnailPath);
}

function postThumbnail(path, dataUrl) {
  try {
    standaloneWindow.postMessage("thumbnail-ready", { path, dataUrl });
  } catch (err) {
    // The window may have closed while Quick Look was working.
  }
}

function isValidMediaPath(path) {
  if (typeof path !== "string" || !isPathInFolderRoots(path)) return false;
  const filename = path.split("/").pop() || "";
  return isPlayableFile(filename) && file.exists(path);
}

async function readMediaMetadata(path) {
  if (!utils.fileInPath(METADATA_TOOL)) return null;
  const result = await utils.exec(METADATA_TOOL, [
    "-name", "kMDItemDurationSeconds",
    "-name", "kMDItemPixelHeight",
    "-name", "kMDItemPixelWidth",
    path,
  ]);
  if (result.status !== 0) return null;
  const metadata = MediaMetadata.parseMdlsOutput(result.stdout);
  return Object.keys(metadata).length > 0 ? metadata : null;
}

function postMediaMetadata(path, metadata) {
  try {
    standaloneWindow.postMessage("media-metadata-ready", { path, metadata });
  } catch (err) {
    // The window may have closed while metadata was being read.
  }
}

const thumbnailLoader = createAsyncResourceLoader({
  concurrency: MAX_CONCURRENT_THUMBNAILS,
  maxEntries: MAX_THUMBNAILS_IN_MEMORY,
  isValid: isValidMediaPath,
  load: generateThumbnail,
  deliver: postThumbnail,
});

const mediaMetadataLoader = createAsyncResourceLoader({
  concurrency: MAX_CONCURRENT_METADATA_JOBS,
  maxEntries: MAX_MEDIA_METADATA_IN_MEMORY,
  isValid: isValidMediaPath,
  load: readMediaMetadata,
  deliver: postMediaMetadata,
});

function requestThumbnail(path) {
  thumbnailLoader.request(path);
}

function requestMediaMetadata(path) {
  mediaMetadataLoader.request(path);
}

function shouldShowFile(filename, preferenceSnapshot = getPreferencesSnapshot()) {
  return FileTypes.shouldShowFile(filename, preferenceSnapshot);
}

let debugLines = [];
let debugFlushTimer = null;

function flushDebugLog() {
  debugFlushTimer = null;
  try {
    file.write(DEBUG_LOG_FILE, debugLines.join(""));
  } catch (err) {
    // Diagnostics must never interrupt browsing.
  }
}

function resetDebugLog() {
  debugLines = [`=== Quick Folders Debug Log - Session started at ${new Date().toISOString()} ===\n`];
  flushDebugLog();
}

function logDebug(message, data = null) {
  try {
    const timestamp = new Date().toISOString();
    const payload = data ? ` ${JSON.stringify(data)}` : "";
    debugLines.push(`${timestamp} ${message}${payload}\n`);
    if (debugLines.length > MAX_DEBUG_LINES) debugLines.splice(1, debugLines.length - MAX_DEBUG_LINES);
    // Folder scans can emit hundreds of entries. Batch them so logging stays
    // diagnostic rather than becoming the dominant filesystem workload.
    if (!debugFlushTimer) debugFlushTimer = setTimeout(flushDebugLog, DEBUG_FLUSH_DELAY);
  } catch (err) {
    // Ignore logging errors
  }
}

const folderScanCache = new Map();
const folderScanPromises = new Map();
let folderScanUpdateTimer = null;

function scheduleWindowUpdate() {
  if (folderScanUpdateTimer) return;
  folderScanUpdateTimer = setTimeout(() => {
    folderScanUpdateTimer = null;
    updateWindow();
  }, 40);
}

async function scanFolderForPlayable(folderPath, depth = 0) {
  if (depth > 10) return false;
  try {
    const listing = file.list(folderPath, { includeSubDir: false }) || [];
    logDebug("scan-folder", { folderPath, depth, items: listing.length });
    for (let i = 0; i < listing.length; i++) {
      const item = listing[i];
      const itemName = item.filename || item.name;
      const isDir = item.isDir || item.is_dir;
      if (!itemName) continue;
      if (itemName.startsWith(".")) continue;

      if (isDir) {
        if (SKIP_DIRECTORIES.has(itemName)) continue;
        const fullPath = item.path || (folderPath.endsWith("/") ? folderPath + itemName : folderPath + "/" + itemName);
        if (await scanFolderForPlayable(fullPath, depth + 1)) return true;
      } else if (isPlayableFile(itemName)) {
        logDebug("playable-found", { folderPath, filename: itemName });
        return true;
      }

      if ((i + 1) % 200 === 0) {
        await new Promise(resolve => setTimeout(resolve, 0));
      }
    }
  } catch (err) {
    // Ignore scan errors
  }
  return false;
}

function ensureFolderScan(folderPath) {
  const cached = folderScanCache.get(folderPath);
  if (cached && cached.status === "done") return;
  if (folderScanPromises.has(folderPath)) return;

  folderScanCache.set(folderPath, { status: "scanning", hasPlayable: false });
  logDebug("scan-start", { folderPath });
  const promise = scanFolderForPlayable(folderPath)
    .then((hasPlayable) => {
      folderScanCache.set(folderPath, { status: "done", hasPlayable });
      folderScanPromises.delete(folderPath);
      logDebug("scan-done", { folderPath, hasPlayable });
      scheduleWindowUpdate();
      return hasPlayable;
    })
    .catch(() => {
      folderScanCache.set(folderPath, { status: "done", hasPlayable: false });
      folderScanPromises.delete(folderPath);
      logDebug("scan-error", { folderPath });
      scheduleWindowUpdate();
    });

  folderScanPromises.set(folderPath, promise);
}

let folderRoots = [];
let currentPath = null;
let history = [];
let watchedPaths = new Set();
let viewingWatched = false;

let fileIndex = { extensions: new Set(), files: [] };
let fileIndexRevision = 0;
let isIndexing = false;
let indexProgress = { filesProcessed: 0, totalEstimate: 0 };
let activeIndexBuild = null;

function buildFileIndex({ afterCurrent = false } = {}) {
  // Refresh commands and window startup can overlap. Sharing one promise keeps
  // them from racing over the same index and duplicating an expensive scan.
  if (activeIndexBuild) {
    return afterCurrent ? activeIndexBuild.then(() => buildFileIndex()) : activeIndexBuild;
  }
  activeIndexBuild = runFileIndexBuild().finally(() => {
    activeIndexBuild = null;
  });
  return activeIndexBuild;
}

async function runFileIndexBuild() {
  isIndexing = true;
  indexProgress = { filesProcessed: 0, totalEstimate: 0 };
  if (standaloneWindow) {
    standaloneWindow.postMessage("index-building", { progress: indexProgress });
  }

  const nextIndex = { extensions: new Set(), files: [] };
  const rootPaths = folderRoots.map((root) => root.path);
  const preferenceSnapshot = getPreferencesSnapshot();
  try {
    for (const rootPath of rootPaths) {
      await indexFolderRecursive(rootPath, 0, nextIndex, indexProgress, preferenceSnapshot);
    }
    // Publish atomically: the UI keeps the previous usable index until the new
    // scan is complete instead of observing a half-built global structure.
    fileIndex = nextIndex;
    fileIndexRevision++;
    saveState();
  } finally {
    isIndexing = false;
    if (standaloneWindow) {
      standaloneWindow.postMessage("index-complete", { progress: indexProgress });
    }
  }
}

async function indexFolderRecursive(folderPath, depth, targetIndex, progress, preferenceSnapshot) {
  try {
    const items = await file.list(folderPath);
    
    if (!items || !Array.isArray(items)) return;

    const folderName = folderPath.split("/").pop();
    if (folderName && (folderName.startsWith(".") || folderName.startsWith("~"))) return;

    const BATCH_SIZE = 500;
    const subdirs = [];
    
    for (let i = 0; i < items.length; i++) {
      const item = items[i];
      
      // Handle both 'name' and 'filename' properties since IINA's file.list uses 'filename'
      const itemName = item.filename || item.name;
      const isDir = item.isDir || item.is_dir;
      if (!itemName) continue;
      if (itemName.startsWith(".")) continue;

      const fullPath = folderPath.endsWith("/") ? folderPath + itemName : folderPath + "/" + itemName;

      if (isDir) {
        if (!SKIP_DIRECTORIES.has(itemName)) {
          if (depth < preferenceSnapshot.maxIndexDepth) subdirs.push(fullPath);
        }
      } else {
        const ext = FileTypes.getExtension(itemName);
        if (ext) {
          const fileType = getFileTypeByExt(ext);
          if (fileType === FILE_TYPES.OTHER) continue;
          targetIndex.extensions.add(ext);
          if (shouldShowFile(itemName, preferenceSnapshot)) {
            targetIndex.files.push({
              name: itemName,
              path: fullPath,
              type: fileType,
              ext: ext,
            });
          }
        }
        progress.filesProcessed++;
      }

      if ((i + 1) % BATCH_SIZE === 0) {
        await new Promise(resolve => setTimeout(resolve, 0));
        if (standaloneWindow && isIndexing && progress.filesProcessed % 1000 === 0) {
          standaloneWindow.postMessage("index-progress", { progress });
        }
      }
    }
    
    await new Promise(resolve => setTimeout(resolve, 0));
    if (standaloneWindow && isIndexing && progress.filesProcessed % 100 === 0) {
      standaloneWindow.postMessage("index-progress", { progress });
    }
    for (const subdir of subdirs) {
      await indexFolderRecursive(subdir, depth + 1, targetIndex, progress, preferenceSnapshot);
    }
  } catch (err) {
    // Silently continue on error
  }
}

function saveState() {
  try {
    const state = {
      folderRoots: folderRoots,
      fileIndex: {
        extensions: Array.from(fileIndex.extensions), // Convert Set to Array for JSON
        files: fileIndex.files,
      },
      watchedPaths: Array.from(watchedPaths),
      version: 2,
    };
    const json = JSON.stringify(state, null, 2);
    file.write(STATE_FILE, json);
  } catch (err) {
    console.error("[Quick Folders] Failed to save state:", err);
  }
}

function loadState() {
  try {
    const exists = file.exists(STATE_FILE);
    if (exists) {
      const data = file.read(STATE_FILE);
      if (data) {
        const state = JSON.parse(data);
        if (state.folderRoots && Array.isArray(state.folderRoots)) {
          folderRoots = state.folderRoots;
          watchedPaths = new Set(BrowseState.normalizePaths(state.watchedPaths));
          if (state.fileIndex && state.fileIndex.extensions) {
            fileIndex.extensions = new Set(state.fileIndex.extensions);
            fileIndex.files = state.fileIndex.files || [];
          }
          return;
        }
      }
    }
    
    const legacyPath = "@data/folders.json";
    if (file.exists(legacyPath)) {
      const data = file.read(legacyPath);
      if (data) {
        const legacyFolders = JSON.parse(data);
        if (Array.isArray(legacyFolders)) {
          folderRoots = legacyFolders.map(f => ({
            path: f.path,
            name: f.name
          }));
          saveState();
          return;
        }
      }
    }
  } catch (err) {
    // Silently continue on error
  }
}

function listFolder(path) {
  try {
    const listing = file.list(path, { includeSubDir: false }) || [];
    const preferenceSnapshot = getPreferencesSnapshot();
    logDebug("list-folder", { path, items: listing.length });
    const filtered = listing
      .filter((item) => {
        const itemName = item.filename || item.name;
        const isDir = item.isDir || item.is_dir;
        if (!itemName) return false;
        if (itemName.startsWith(".")) return false;

        if (isDir) {
          if (SKIP_DIRECTORIES.has(itemName)) return false;
          const fullPath = path.endsWith("/") ? path + itemName : path + "/" + itemName;
          const cached = folderScanCache.get(fullPath);
          if (cached && cached.status === "done") return cached.hasPlayable;

          ensureFolderScan(fullPath);
          return true;
        }

        return shouldShowFile(itemName, preferenceSnapshot);
      });
    logDebug("list-folder-filtered", { path, kept: filtered.length, skipped: listing.length - filtered.length });
    return filtered
      .map((item) => {
        const itemName = item.filename || item.name;
        const isDir = item.isDir || item.is_dir;
        const fullPath = path.endsWith("/") ? path + itemName : path + "/" + itemName;
        let fileSize = null;
        if (!isDir) {
          try {
            const stats = file.stat(fullPath);
            fileSize = stats && stats.size ? stats.size : null;
          } catch (e) {
            // Ignore stat errors
          }
        }
        const cached = isDir ? folderScanCache.get(fullPath) : null;
        return {
          path: fullPath,
          name: itemName,
          isDir: isDir,
          size: fileSize,
          scanning: isDir && (!cached || cached.status === "scanning"),
          watched: !isDir && watchedPaths.has(fullPath),
        };
      })
      .sort((a, b) => {
        if (a.isDir !== b.isDir) return b.isDir ? 1 : -1;
        return a.name.localeCompare(b.name);
      });
  } catch (err) {
    return [];
  }
}

function getFileItem(path, directoryCache = null) {
  if (!isPathInFolderRoots(path) || !file.exists(path)) return null;
  const slashIndex = path.lastIndexOf("/");
  if (slashIndex < 0) return null;
  const parentPath = slashIndex === 0 ? "/" : path.substring(0, slashIndex);
  const name = path.substring(slashIndex + 1);
  if (!isPlayableFile(name)) return null;

  try {
    let listing = directoryCache && directoryCache.get(parentPath);
    if (!listing) {
      listing = file.list(parentPath, { includeSubDir: false }) || [];
      if (directoryCache) directoryCache.set(parentPath, listing);
    }
    const entry = listing.find((item) => (item.filename || item.name) === name);
    if (!entry || entry.isDir || entry.is_dir) return null;
    let fileSize = null;
    try {
      const stats = file.stat(path);
      fileSize = stats && stats.size ? stats.size : null;
    } catch (err) {
      // Size is optional; the directory entry already verified this is a file.
    }
    return {
      path,
      name,
      isDir: false,
      size: fileSize,
      watched: watchedPaths.has(path),
      fromWatchedView: true,
    };
  } catch (err) {
    return null;
  }
}

function getWatchedItems() {
  const directoryCache = new Map();
  return Array.from(watchedPaths)
    .map((path) => getFileItem(path, directoryCache))
    .filter(Boolean)
    .sort((left, right) => left.name.localeCompare(right.name));
}

function getCurrentItems() {
  logDebug("get-current-items", { currentPath });
  if (viewingWatched) return getWatchedItems();

  if (!currentPath) {
    // At root: show folder roots
    const roots = folderRoots.map((f) => ({
      path: f.path,
      name: f.name,
      isDir: true,
      isRoot: true,
    }));
    if ((preferences.get("hideWatched") ?? false)) {
      roots.push({
        path: "@watched",
        name: "Watched",
        isDir: true,
        isWatchedRoot: true,
        watchedCount: getWatchedItems().length,
      });
    }
    return roots;
  }

  // Inside a folder: show contents
  return listFolder(currentPath);
}

function getPreferencesSnapshot() {
  return {
    filterImages: preferences.get("filterImages") ?? true,
    filterAudio: preferences.get("filterAudio") ?? true,
    videoOnly: preferences.get("videoOnly") ?? false,
    hideWatched: preferences.get("hideWatched") ?? false,
    maxIndexDepth: preferences.get("maxIndexDepth") ?? DEFAULT_MAX_INDEX_DEPTH,
    openWindowShortcut: preferences.get("openWindowShortcut") ?? "cmd+shift+a",
    addFolderShortcut: preferences.get("addFolderShortcut") ?? "n",
  };
}

function getCurrentFolderDepth() {
  if (!currentPath) return 0;
  const root = folderRoots.find((candidate) => BrowseState.isPathWithinRoots(currentPath, [candidate]));
  if (!root) return 0;
  return currentPath.substring(root.path.replace(/\/+$/, "").length).split("/").filter(Boolean).length;
}

function updateWindow() {
  logDebug("update-window", { currentPath, roots: folderRoots.length });
  const items = getCurrentItems();
  logDebug("update-window-items", { count: items.length, items: items.map(i => ({ name: i.name, isDir: i.isDir, scanning: i.scanning })) });
  
  const preferenceSnapshot = getPreferencesSnapshot();
  const indexReady = fileIndex.extensions.size > 0 || folderRoots.length === 0;

  standaloneWindow.postMessage("update-items", {
    items,
    currentPath: viewingWatched ? "@watched" : currentPath,
    atRoot: !currentPath && !viewingWatched,
    viewingWatched,
    availableExtensions: Array.from(fileIndex.extensions).sort(),
    indexedFiles: fileIndex.files.map((item) => ({
      ...item,
      watched: watchedPaths.has(item.path),
    })),
    indexRevision: fileIndexRevision,
    indexReady,
    isIndexing,
    folderDepth: getCurrentFolderDepth(),
    preferences: preferenceSnapshot,
  });
}

function rebuildIndexExtensions() {
  fileIndex.extensions = new Set(fileIndex.files.map((item) => item.ext).filter(Boolean));
  fileIndexRevision++;
}

function updateWatchedItems(paths, watched) {
  const succeeded = [];
  const failed = [];
  const directoryCache = new Map();
  BrowseState.normalizePaths(paths).slice(0, 1000).forEach((path) => {
    if (!getFileItem(path, directoryCache)) {
      failed.push({ path, reason: "File is unavailable or outside Quick Folders" });
      return;
    }
    if (watched) watchedPaths.add(path);
    else watchedPaths.delete(path);
    succeeded.push(path);
  });

  if (succeeded.length > 0) {
    fileIndexRevision++;
    saveState();
  }
  updateWindow();
  standaloneWindow.postMessage("item-action-result", {
    action: watched ? "watched" : "unwatched",
    succeeded,
    failed,
  });
}

function deleteItems(paths) {
  const succeeded = [];
  const failed = [];
  const directoryCache = new Map();
  BrowseState.normalizePaths(paths).slice(0, 1000).forEach((path) => {
    if (!getFileItem(path, directoryCache)) {
      failed.push({ path, reason: "File is unavailable or outside Quick Folders" });
      return;
    }
    try {
      file.delete(path);
      if (file.exists(path)) throw new Error("The file still exists after deletion");
      watchedPaths.delete(path);
      thumbnailLoader.remove(path);
      mediaMetadataLoader.remove(path);
      succeeded.push(path);
    } catch (err) {
      failed.push({ path, reason: err && err.message ? err.message : "Deletion failed" });
    }
  });

  if (succeeded.length > 0) {
    const deleted = new Set(succeeded);
    fileIndex.files = fileIndex.files.filter((item) => !deleted.has(item.path));
    folderScanCache.clear();
    rebuildIndexExtensions();
    saveState();
  }
  updateWindow();
  standaloneWindow.postMessage("item-action-result", {
    action: "deleted",
    succeeded,
    failed,
  });
}

async function addFolder() {
  try {
    const chosen = await utils.chooseFile("Select a folder to add", {
      chooseDir: true,
    });

    if (!chosen) return;

    let folderPath = chosen;
    if (Array.isArray(chosen)) {
      folderPath = chosen[0];
    }
    if (typeof folderPath === "object" && folderPath !== null) {
      folderPath = folderPath.path || String(folderPath);
    }

    if (!folderPath) return;
    if (folderRoots.some((f) => f.path === folderPath)) return;

    const folderName = folderPath.split("/").pop() || folderPath;
    folderRoots.push({ path: folderPath, name: folderName });
    updateWindow();

    await buildFileIndex({ afterCurrent: true });
    updateWindow();
  } catch (err) {
    console.error("[Quick Folders] Failed to add folder:", err);
  }
}

let windowHandlersRegistered = false;

function openItem({ path, isDir, isWatchedRoot } = {}) {
  if (isWatchedRoot || path === "@watched") {
    history = [];
    currentPath = null;
    viewingWatched = true;
    updateWindow();
    return;
  }
  if (!isPathInFolderRoots(path)) return;

  if (isDir) {
    history.push(currentPath);
    currentPath = path;
    viewingWatched = false;
    updateWindow();
    return;
  }
  if (!getFileItem(path)) return;
  try {
    core.open(path);
  } catch (err) {
    logDebug("open-file-error", { path, message: err && err.message });
  }
}

function goBack() {
  if (viewingWatched) {
    viewingWatched = false;
    currentPath = null;
    history = [];
  } else {
    currentPath = history.length > 0 ? history.pop() || null : null;
  }
  updateWindow();
}

function navigateTo({ path } = {}) {
  if (!isPathInFolderRoots(path)) return;
  history = [];
  currentPath = path;
  viewingWatched = false;
  updateWindow();
}

async function removeRoot({ path } = {}) {
  const nextRoots = folderRoots.filter((root) => root.path !== path);
  if (nextRoots.length === folderRoots.length) return;
  folderRoots = nextRoots;
  if (currentPath && BrowseState.isPathWithinRoots(currentPath, [{ path }])) {
    currentPath = null;
    history = [];
  }
  await buildFileIndex({ afterCurrent: true });
  updateWindow();
}

function registerWindowHandlers() {
  if (windowHandlersRegistered) return;
  windowHandlersRegistered = true;
  standaloneWindow.onMessage("open-item", openItem);
  standaloneWindow.onMessage("go-back", goBack);
  standaloneWindow.onMessage("request-state", updateWindow);
  standaloneWindow.onMessage("request-thumbnail", (data) => requestThumbnail(data && data.path));
  standaloneWindow.onMessage("request-media-metadata", (data) => requestMediaMetadata(data && data.path));
  standaloneWindow.onMessage("navigate-to", navigateTo);
  standaloneWindow.onMessage("set-watched", ({ paths, watched } = {}) => updateWatchedItems(paths, Boolean(watched)));
  standaloneWindow.onMessage("delete-items", ({ paths } = {}) => deleteItems(paths));
  standaloneWindow.onMessage("remove-root", removeRoot);
  standaloneWindow.onMessage("add-folder", addFolder);
  standaloneWindow.onMessage("refresh-index", async () => {
    await buildFileIndex();
    updateWindow();
  });
}

function openWindow() {
  try {
    loadState();

    resetDebugLog();
    logDebug("plugin-initializing");
    
    standaloneWindow.setProperty({ 
      title: "Quick Folders",
      vibrancy: "dark",
      titlebarStyle: "hidden"
    });

    standaloneWindow.setFrame(500, 600);
    standaloneWindow.loadFile("ui/index.html");
    registerWindowHandlers();
    
    // After UI loads, trigger index build if folders exist
    setTimeout(() => {
      if (folderRoots.length > 0) {
        buildFileIndex().then(() => {
          updateWindow();
        }).catch(err => {
          // Ignore errors
        });
      }
    }, 100);

    standaloneWindow.open();
    updateWindow();
  } catch (err) {
    console.error("[Quick Folders] Failed to open window:", err);
  }
}

try {
  const openWindowShortcut = preferences.get("openWindowShortcut") ?? "cmd+shift+a";
  const addFolderShortcut = preferences.get("addFolderShortcut") ?? "n";
  
  const openItem = menu.item("Open Quick Folders Window", openWindow, { keyBinding: openWindowShortcut });
  const addItem = menu.item("Add Folder", addFolder, { keyBinding: addFolderShortcut });
  menu.addItem(openItem);
  menu.addItem(addItem);
} catch (err) {
  console.error("[Quick Folders] Failed to register menu shortcuts:", err);
}
