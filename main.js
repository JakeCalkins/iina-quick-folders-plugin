const {
  console, core, file, utils, menu, playlist, standaloneWindow, preferences, global: globalApi,
} = iina;
const BrowseState = require("./browse-state.js");
const FileTypes = require("./file-types.js");
const MediaMetadata = require("./media-metadata.js");
const QueuePlayback = require("./queue-playback.js");
const QueueState = require("./queue-state.js");
const ThumbnailService = require("./thumbnail-service.js");
const KeyboardShortcuts = require("./ui/keyboard-shortcuts.js");
const { createAsyncResourceLoader } = require("./async-resource-loader.js");


const STATE_FILE = "@data/quick-folders-state.json";
const DEFAULT_MAX_INDEX_DEPTH = 3;
const DEFAULT_OPEN_WINDOW_SHORTCUT = "cmd+shift+k";
const DEFAULT_ADD_FOLDER_SHORTCUT = "n";
const QUEUE_PLAYER_LABEL = "quick-folders-queue";
const LEGACY_OPEN_WINDOW_SHORTCUT = "cmd+shift+a";
const SHORTCUT_REFRESH_INTERVAL = 1000;
const MAX_THUMBNAILS_IN_MEMORY = 200;
const MAX_CONCURRENT_THUMBNAILS = 2;
const METADATA_TOOL = "/usr/bin/mdls";
const MEDIA_PROBE_TOOLS = Object.freeze([
  "ffprobe",
  "/opt/homebrew/bin/ffprobe",
  "/usr/local/bin/ffprobe",
  "/opt/local/bin/ffprobe",
]);

const { FILE_TYPES, SKIP_DIRECTORIES, getFileTypeByExt, isPlayableFile } = FileTypes;

const MAX_CONCURRENT_METADATA_JOBS = 3;
const MAX_MEDIA_METADATA_IN_MEMORY = 500;
const BROWSER_WINDOW_WIDTH = 500;
const QUEUE_WINDOW_WIDTH = 840;
const WINDOW_HEIGHT = 600;

function isPathInFolderRoots(path) {
  return BrowseState.isPathWithinRoots(path, folderRoots);
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
  let metadata = {};
  if (utils.fileInPath(METADATA_TOOL)) {
    const result = await executeMetadataTool(METADATA_TOOL, [
      "-name", "kMDItemDurationSeconds",
      "-name", "kMDItemPixelHeight",
      "-name", "kMDItemPixelWidth",
      "-name", "kMDItemCodecs",
      "-name", "kMDItemVideoBitRate",
      "-name", "kMDItemAudioBitRate",
      "-name", "kMDItemAudioSampleRate",
      "-name", "kMDItemAudioChannelCount",
      path,
    ]);
    if (result && result.status === 0) metadata = MediaMetadata.parseMdlsOutput(result.stdout);
  }

  const fileType = getFileTypeByExt(path);
  const needsProbe = !metadata.duration
    || ((fileType === FILE_TYPES.VIDEO || fileType === FILE_TYPES.IMAGE) && (!metadata.width || !metadata.height))
    || (fileType !== FILE_TYPES.IMAGE && (!metadata.codecs || metadata.codecs.length === 0));
  const probeTool = needsProbe ? getMediaProbeTool() : null;
  if (probeTool) {
    const result = await executeMetadataTool(probeTool, [
      "-v", "error",
      "-show_entries", "format=duration,bit_rate:stream=codec_type,codec_name,width,height,duration,bit_rate,sample_rate,channels",
      "-of", "json",
      path,
    ]);
    if (result && result.status === 0) {
      metadata = MediaMetadata.mergeMetadata(metadata, MediaMetadata.parseFfprobeOutput(result.stdout));
    }
  }

  return Object.keys(metadata).length > 0 ? metadata : null;
}

async function executeMetadataTool(tool, args) {
  try {
    return await utils.exec(tool, args);
  } catch (err) {
    return null;
  }
}

let discoveredMediaProbeTool;
let didDiscoverMediaProbeTool = false;

function getMediaProbeTool() {
  if (didDiscoverMediaProbeTool) return discoveredMediaProbeTool;
  didDiscoverMediaProbeTool = true;
  discoveredMediaProbeTool = MEDIA_PROBE_TOOLS.find((tool) => {
    try {
      return utils.fileInPath(tool);
    } catch (err) {
      return false;
    }
  }) || null;
  return discoveredMediaProbeTool;
}

function postMediaMetadata(path, metadata) {
  try {
    standaloneWindow.postMessage("media-metadata-ready", { path, metadata });
  } catch (err) {
    // The window may have closed while metadata was being read.
  }
}

const thumbnailLoader = ThumbnailService.createThumbnailService({
  file,
  utils,
  concurrency: MAX_CONCURRENT_THUMBNAILS,
  maxEntries: MAX_THUMBNAILS_IN_MEMORY,
  isValid: isValidMediaPath,
  deliver: postThumbnail,
});

const mediaMetadataLoader = createAsyncResourceLoader({
  concurrency: MAX_CONCURRENT_METADATA_JOBS,
  maxEntries: MAX_MEDIA_METADATA_IN_MEMORY,
  isValid: isValidMediaPath,
  load: readMediaMetadata,
  deliver: postMediaMetadata,
});

const queuePlayback = QueuePlayback.create({ core, playlist });

function getPlayerLabel() {
  if (!globalApi || typeof globalApi.getLabel !== "function") return null;
  try {
    return globalApi.getLabel();
  } catch (err) {
    return null;
  }
}

const isManagedQueuePlayer = getPlayerLabel() === QUEUE_PLAYER_LABEL;

function requestThumbnail(path) {
  if (!isValidMediaPath(path)) return;
  // Native Quick Look and ffmpeg work can take several seconds on a cold
  // launch. Give WebKit a useful preview immediately, then replace it with
  // the generated frame or artwork when the bounded worker finishes.
  postThumbnail(path, ThumbnailService.createFallbackThumbnailDataUrl(getFileTypeByExt(path)));
  thumbnailLoader.request(path);
}

function requestMediaMetadata(path) {
  mediaMetadataLoader.request(path);
}

function shouldShowFile(filename, preferenceSnapshot = getPreferencesSnapshot()) {
  return FileTypes.shouldShowFile(filename, preferenceSnapshot);
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
  const promise = scanFolderForPlayable(folderPath)
    .then((hasPlayable) => {
      folderScanCache.set(folderPath, { status: "done", hasPlayable });
      folderScanPromises.delete(folderPath);
      scheduleWindowUpdate();
      return hasPlayable;
    })
    .catch(() => {
      folderScanCache.set(folderPath, { status: "done", hasPlayable: false });
      folderScanPromises.delete(folderPath);
      scheduleWindowUpdate();
    });

  folderScanPromises.set(folderPath, promise);
}

let folderRoots = [];
let currentPath = null;
let history = [];
let watchedPaths = new Set();
let queuePaths = [];
let viewingWatched = false;

let fileIndex = { extensions: new Set(), files: [] };
let fileIndexRevision = 0;
let publishedIndexRevision = null;
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
      queuePaths,
      version: 3,
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
          queuePaths = QueueState.normalizePaths(state.queuePaths).filter(isValidMediaPath);
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

function getQueueItems() {
  const directoryCache = new Map();
  return queuePaths.map((path) => getFileItem(path, directoryCache)).filter(Boolean);
}

function getCurrentItems() {
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
    openWindowShortcut: getMenuShortcut("openWindowShortcut", DEFAULT_OPEN_WINDOW_SHORTCUT),
    addFolderShortcut: getMenuShortcut("addFolderShortcut", DEFAULT_ADD_FOLDER_SHORTCUT),
  };
}

function getMenuShortcut(preferenceKey, fallback) {
  return KeyboardShortcuts.resolveMenuShortcut(preferences.get(preferenceKey), fallback);
}

function migrateLegacyOpenWindowShortcut() {
  const configuredShortcut = preferences.get("openWindowShortcut");
  if (
    KeyboardShortcuts.normalizeMenuShortcut(configuredShortcut)
    !== KeyboardShortcuts.normalizeMenuShortcut(LEGACY_OPEN_WINDOW_SHORTCUT)
  ) return;

  preferences.set("openWindowShortcut", DEFAULT_OPEN_WINDOW_SHORTCUT);
  preferences.sync();
}

function getCurrentFolderRoot() {
  if (!currentPath) return null;
  return folderRoots.find((candidate) => BrowseState.isPathWithinRoots(currentPath, [candidate])) || null;
}

function getCurrentFolderDepth() {
  if (!currentPath) return 0;
  const root = getCurrentFolderRoot();
  if (!root) return 0;
  return currentPath.substring(root.path.replace(/\/+$/, "").length).split("/").filter(Boolean).length;
}

function updateWindow() {
  const items = getCurrentItems();
  const preferenceSnapshot = getPreferencesSnapshot();
  const indexReady = fileIndex.extensions.size > 0 || folderRoots.length === 0;
  const currentRoot = getCurrentFolderRoot();
  const state = {
    items,
    currentPath: viewingWatched ? "@watched" : currentPath,
    currentRootPath: currentRoot ? currentRoot.path : null,
    atRoot: !currentPath && !viewingWatched,
    viewingWatched,
    availableExtensions: Array.from(fileIndex.extensions).sort(),
    indexRevision: fileIndexRevision,
    indexReady,
    isIndexing,
    folderDepth: getCurrentFolderDepth(),
    preferences: preferenceSnapshot,
    queueItems: getQueueItems(),
  };

  // The complete index can be large. Publish it only when its revision changes;
  // ordinary navigation and queue updates already share the UI's cached copy.
  if (publishedIndexRevision !== fileIndexRevision) {
    state.indexedFiles = fileIndex.files.map((item) => ({
      ...item,
      watched: watchedPaths.has(item.path),
    }));
    publishedIndexRevision = fileIndexRevision;
  }
  standaloneWindow.postMessage("update-items", state);
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
      queuePaths = QueueState.removePaths(queuePaths, [path]);
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

function postQueueResult(action, succeeded = [], failed = []) {
  standaloneWindow.postMessage("queue-action-result", { action, succeeded, failed });
}

function addQueueItems({ paths } = {}) {
  const requested = QueueState.normalizePaths(paths);
  const existing = new Set(queuePaths);
  const directoryCache = new Map();
  const valid = [];
  const failed = [];
  requested.forEach((path) => {
    if (!getFileItem(path, directoryCache)) {
      failed.push({ path, reason: "File is unavailable or outside Quick Folders" });
    } else {
      valid.push(path);
    }
  });

  queuePaths = QueueState.addPaths(queuePaths, valid);
  const succeeded = valid.filter((path) => !existing.has(path));
  if (succeeded.length > 0) saveState();
  updateWindow();
  postQueueResult("added", succeeded, failed);
}

function removeQueueItems({ paths } = {}) {
  const requested = new Set(QueueState.normalizePaths(paths));
  const succeeded = queuePaths.filter((path) => requested.has(path));
  if (succeeded.length === 0) return;
  queuePaths = QueueState.removePaths(queuePaths, succeeded);
  saveState();
  updateWindow();
  postQueueResult("removed", succeeded);
}

function clearQueue() {
  if (queuePaths.length === 0) return;
  const succeeded = queuePaths.slice();
  queuePaths = [];
  saveState();
  updateWindow();
  postQueueResult("cleared", succeeded);
}

function reorderQueue({ paths, targetPath, position } = {}) {
  const nextQueue = QueueState.movePaths(queuePaths, paths, targetPath, position);
  if (nextQueue.join("\n") === queuePaths.join("\n")) return;
  queuePaths = nextQueue;
  saveState();
  updateWindow();
}

async function playQueue() {
  const directoryCache = new Map();
  const validPaths = queuePaths.filter((path) => Boolean(getFileItem(path, directoryCache)));
  const failed = queuePaths
    .filter((path) => !validPaths.includes(path))
    .map((path) => ({ path, reason: "File is unavailable or outside Quick Folders" }));

  if (validPaths.length !== queuePaths.length) {
    queuePaths = validPaths;
    saveState();
    updateWindow();
  }
  if (validPaths.length === 0) {
    postQueueResult("played", [], failed.length > 0 ? failed : [{ reason: "Queue is empty" }]);
    return;
  }

  try {
    if (!isManagedQueuePlayer && globalApi && typeof globalApi.postMessage === "function") {
      globalApi.postMessage("quick-folders-play-queue", { paths: validPaths });
      return;
    }
    // QueuePlayback opens the first item and reconciles IINA's native playlist,
    // including the containing-folder entries IINA may append automatically.
    await queuePlayback.start(validPaths);
    postQueueResult("played", validPaths, failed);
  } catch (err) {
    postQueueResult("played", [], [{ reason: err && err.message ? err.message : "Unable to start queue" }]);
  }
}

function registerNativeQueueBridge() {
  if (!globalApi || typeof globalApi.onMessage !== "function") return;

  if (!isManagedQueuePlayer) {
    globalApi.onMessage("quick-folders-queue-result", (result) => {
      postQueueResult(
        "played",
        BrowseState.normalizePaths(result && result.succeeded),
        Array.isArray(result && result.failed) ? result.failed : [],
      );
    });
    return;
  }

  globalApi.onMessage("quick-folders-queue-items", async ({ paths } = {}) => {
    loadState();
    const directoryCache = new Map();
    const requested = QueueState.normalizePaths(paths);
    const validPaths = requested.filter((path) => Boolean(getFileItem(path, directoryCache)));
    const failed = requested
      .filter((path) => !validPaths.includes(path))
      .map((path) => ({ path, reason: "File is unavailable or outside Quick Folders" }));
    try {
      if (validPaths.length === 0) throw new Error("Queue is empty");
      // createPlayerInstance already opened the first item. Reopening it here
      // would launch a second folder-matcher pass and race playlist cleanup.
      await queuePlayback.start(validPaths, { openFirst: false });
      globalApi.postMessage("quick-folders-queue-player-result", {
        action: "played",
        succeeded: validPaths,
        failed,
      });
    } catch (err) {
      globalApi.postMessage("quick-folders-queue-player-result", {
        action: "played",
        succeeded: [],
        failed: failed.concat([{ reason: err && err.message ? err.message : "Unable to start queue" }]),
      });
    }
  });
  setTimeout(() => globalApi.postMessage("quick-folders-queue-player-ready"), 0);
}

function setQueuePanelOpen({ open } = {}) {
  standaloneWindow.setFrame(open ? QUEUE_WINDOW_WIDTH : BROWSER_WINDOW_WIDTH, WINDOW_HEIGHT, null, null);
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
    console.error("[Quick Folders] Failed to open media:", err);
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
  queuePaths = queuePaths.filter((queuedPath) => !BrowseState.isPathWithinRoots(queuedPath, [{ path }]));
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
  standaloneWindow.onMessage("queue-add", addQueueItems);
  standaloneWindow.onMessage("queue-remove", removeQueueItems);
  standaloneWindow.onMessage("queue-clear", clearQueue);
  standaloneWindow.onMessage("queue-reorder", reorderQueue);
  standaloneWindow.onMessage("queue-play", playQueue);
  standaloneWindow.onMessage("queue-panel-open", setQueuePanelOpen);
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
    // A newly loaded WebView has no cached index even when the backend revision
    // is unchanged from the previous window instance.
    publishedIndexRevision = null;

    standaloneWindow.setProperty({ 
      title: "Quick Folders",
      vibrancy: "dark",
      titlebarStyle: "hidden"
    });

    standaloneWindow.setFrame(BROWSER_WINDOW_WIDTH, WINDOW_HEIGHT);
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

registerNativeQueueBridge();

if (!isManagedQueuePlayer) {
  try {
    // The previous default collides with IINA's built-in Audio panel command.
    migrateLegacyOpenWindowShortcut();
    const openItem = menu.item("Open Quick Folders Window", openWindow, {
      keyBinding: getMenuShortcut("openWindowShortcut", DEFAULT_OPEN_WINDOW_SHORTCUT),
    });
    const addItem = menu.item("Add Folder", addFolder, {
      keyBinding: getMenuShortcut("addFolderShortcut", DEFAULT_ADD_FOLDER_SHORTCUT),
    });
    menu.addItem(openItem);
    menu.addItem(addItem);

    // IINA updates its preference store without reloading the running plugin.
    // Poll the two inexpensive values so edited shortcuts take effect promptly.
    setInterval(() => {
      const nextOpenShortcut = getMenuShortcut("openWindowShortcut", DEFAULT_OPEN_WINDOW_SHORTCUT);
      const nextAddShortcut = getMenuShortcut("addFolderShortcut", DEFAULT_ADD_FOLDER_SHORTCUT);
      if (openItem.keyBinding === nextOpenShortcut && addItem.keyBinding === nextAddShortcut) return;
      openItem.keyBinding = nextOpenShortcut;
      addItem.keyBinding = nextAddShortcut;
      menu.forceUpdate();
    }, SHORTCUT_REFRESH_INTERVAL);
  } catch (err) {
    console.error("[Quick Folders] Failed to register menu shortcuts:", err);
  }
}
