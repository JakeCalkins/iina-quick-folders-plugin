const {
  console, core, event, file, utils, menu, playlist, standaloneWindow, preferences, global: globalApi,
} = iina;
const BrowseState = require("./browse-state.js");
const Diagnostics = require("./diagnostics.js");
const FileTypes = require("./file-types.js");
const IndexState = require("./index-state.js");
const IncrementalIndexState = require("./incremental-index-state.js");
const MediaMetadata = require("./media-metadata.js");
const PlaybackState = require("./playback-state.js");
const QueuePlayback = require("./queue-playback.js");
const QueueState = require("./queue-state.js");
const SeriesState = require("./series-state.js");
const ThumbnailService = require("./thumbnail-service.js");
const KeyboardShortcuts = require("./ui/keyboard-shortcuts.js");
const { createAsyncResourceLoader } = require("./async-resource-loader.js");


const STATE_FILE = "@data/quick-folders-state.json";
const INDEX_FILE = "@data/quick-folders-index.json";
const PLAYBACK_FILE = "@data/quick-folders-playback.json";
const BROWSER_CONTEXT_FILE = "@data/quick-folders-browser-context.json";
const DEFAULT_MAX_INDEX_DEPTH = 3;
const DEFAULT_COMPLETION_THRESHOLD_PERCENT = 90;
const DEFAULT_OPEN_WINDOW_SHORTCUT = "cmd+shift+k";
const DEFAULT_ADD_FOLDER_SHORTCUT = "n";
const QUEUE_PLAYER_LABEL = "quick-folders-queue";
const LEGACY_OPEN_WINDOW_SHORTCUT = "cmd+shift+a";
const SHORTCUT_REFRESH_INTERVAL = 1000;
const MAX_THUMBNAILS_IN_MEMORY = 200;
const MAX_CONCURRENT_THUMBNAILS = 2;
const METADATA_TOOL = "/usr/bin/mdls";
const FIND_TOOL = "/usr/bin/find";
const TOUCH_TOOL = "/usr/bin/touch";
const INDEX_MARKER_OVERLAP_SECONDS = 10;
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
const PROGRESS_WRITE_DELAY = 5000;
const INDEX_METADATA_WRITE_DELAY = 1000;
const MAX_SMART_VIEW_ITEMS = 100;
const hasOwn = (object, key) => Object.prototype.hasOwnProperty.call(object, key);

function postWindowMessage(type, data) {
  try {
    standaloneWindow.postMessage(type, data);
    return true;
  } catch (err) {
    return false;
  }
}

function isPathInFolderRoots(path) {
  return BrowseState.isPathWithinRoots(path, folderRoots);
}

function postThumbnail(path, dataUrl) {
  postWindowMessage("thumbnail-ready", { path, dataUrl });
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
  diagnostics.increment(metadata ? "metadata.completed" : "metadata.failures");
  if (!metadata) diagnostics.record("metadata", "unavailable");
  mergeIndexedMetadata(path, metadata);
  postWindowMessage("media-metadata-ready", { path, metadata });
}

function postGeneratedThumbnail(path, dataUrl) {
  diagnostics.increment(dataUrl ? "thumbnail.completed" : "thumbnail.failures");
  if (!dataUrl) diagnostics.record("thumbnail", "unavailable");
  postThumbnail(path, dataUrl);
}

const thumbnailLoader = ThumbnailService.createThumbnailService({
  file,
  utils,
  concurrency: MAX_CONCURRENT_THUMBNAILS,
  maxEntries: MAX_THUMBNAILS_IN_MEMORY,
  isValid: isValidMediaPath,
  onCacheHit: () => diagnostics.increment("cache.hits"),
  onCacheMiss: () => diagnostics.increment("cache.misses"),
  deliver: postGeneratedThumbnail,
});

const mediaMetadataLoader = createAsyncResourceLoader({
  concurrency: MAX_CONCURRENT_METADATA_JOBS,
  maxEntries: MAX_MEDIA_METADATA_IN_MEMORY,
  isValid: isValidMediaPath,
  onCacheHit: () => diagnostics.increment("cache.hits"),
  onCacheMiss: () => diagnostics.increment("cache.misses"),
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
  prepareCachedIndex();
  mediaMetadataLoader.request(path);
}

function shouldShowFile(filename, preferenceSnapshot = getPreferencesSnapshot()) {
  return FileTypes.shouldShowFile(filename, preferenceSnapshot);
}

function getIndexMarkerPath(rootPath, slot) {
  return `@data/quick-folders-index-marker-${ThumbnailService.hashPath(rootPath)}-${slot}`;
}

function getPathDepth(path, rootPath) {
  if (!IncrementalIndexState.isPathWithinRoot(path, rootPath)) return Infinity;
  if (path === rootPath) return 0;
  return path.substring(rootPath === "/" ? 1 : rootPath.length + 1).split("/").length;
}

function isIndexableDirectoryPath(path, rootPath, maxDepth) {
  if (getPathDepth(path, rootPath) > maxDepth) return false;
  const relative = path === rootPath
    ? ""
    : path.substring(rootPath === "/" ? 1 : rootPath.length + 1);
  return !relative.split("/").filter(Boolean).some((segment) => (
    segment.startsWith(".") || segment.startsWith("~") || SKIP_DIRECTORIES.has(segment)
  ));
}

function parseFindPaths(output, rootPath) {
  return String(output || "")
    .split("\0")
    .map((path) => IncrementalIndexState.normalizeAbsolutePath(path))
    .filter((path) => path && IncrementalIndexState.isPathWithinRoot(path, rootPath));
}

function getParentPath(path) {
  const slashIndex = path.lastIndexOf("/");
  return slashIndex <= 0 ? "/" : path.substring(0, slashIndex);
}

async function prepareNextIndexMarker(rootPath, previousRoot) {
  const previousSlot = previousRoot && (previousRoot.markerSlot === 0 || previousRoot.markerSlot === 1)
    ? previousRoot.markerSlot
    : null;
  const nextSlot = previousSlot === 0 ? 1 : 0;
  try {
    const previousToken = previousSlot == null
      ? null
      : file.read(getIndexMarkerPath(rootPath, previousSlot));
    const expectedPreviousToken = previousRoot && previousRoot.markerToken;
    const token = `overlap-1:${Date.now()}-${Math.floor(Math.random() * 0x100000000).toString(16)}`;
    const nextPath = getIndexMarkerPath(rootPath, nextSlot);
    file.write(nextPath, token);
    if (!utils.fileInPath(TOUCH_TOOL)) return null;
    const touchResult = await utils.exec(TOUCH_TOOL, [
      "-A", `-0000${String(INDEX_MARKER_OVERLAP_SECONDS).padStart(2, "0")}`,
      utils.resolvePath(nextPath),
    ]);
    if (!touchResult || touchResult.status !== 0) return null;
    return {
      nextSlot,
      previousSlot,
      previousToken: expectedPreviousToken && previousToken === expectedPreviousToken
        ? previousToken
        : null,
      token,
    };
  } catch (err) {
    return null;
  }
}

function ownsIndexMarker(rootPath, marker) {
  if (!marker) return true;
  try {
    return file.read(getIndexMarkerPath(rootPath, marker.nextSlot)) === marker.token;
  } catch (err) {
    return false;
  }
}

function ownsPreviousIndexMarker(rootPath, marker) {
  if (!marker || marker.previousSlot == null || !marker.previousToken) return false;
  try {
    return file.read(getIndexMarkerPath(rootPath, marker.previousSlot)) === marker.previousToken;
  } catch (err) {
    return false;
  }
}

async function discoverChangedDirectories(rootPath, previousRoot, marker, preferenceSnapshot) {
  if (forceFullScanRoots.delete(rootPath)) return null;
  if (
    !marker
    || marker.previousSlot == null
    || !ownsPreviousIndexMarker(rootPath, marker)
    || !previousRoot
    || previousRoot.status !== "ready"
  ) return null;
  const markerPath = getIndexMarkerPath(rootPath, marker.previousSlot);
  try {
    if (!utils.fileInPath(FIND_TOOL)) return null;
    if (!file.exists(markerPath)) return null;
    const physicalMarkerPath = utils.resolvePath(markerPath);
    const findPrefix = [rootPath, "-maxdepth", String(preferenceSnapshot.maxIndexDepth + 1)];
    const [directoriesResult, filesResult] = await Promise.all([
      utils.exec(FIND_TOOL, [...findPrefix, "-newer", physicalMarkerPath, "-type", "d", "-print0"]),
      utils.exec(FIND_TOOL, [...findPrefix, "-newer", physicalMarkerPath, "-type", "f", "-print0"]),
    ]);
    if (
      !directoriesResult || directoriesResult.status !== 0
      || !filesResult || filesResult.status !== 0
      || !ownsPreviousIndexMarker(rootPath, marker)
    ) return null;
    const changedFiles = new Set(parseFindPaths(filesResult.stdout, rootPath));
    const changed = new Set(parseFindPaths(directoriesResult.stdout, rootPath));
    changedFiles.forEach((path) => changed.add(getParentPath(path)));
    return {
      changedFiles,
      paths: Array.from(changed)
      .filter((path) => isIndexableDirectoryPath(path, rootPath, preferenceSnapshot.maxIndexDepth))
      .sort((left, right) => getPathDepth(left, rootPath) - getPathDepth(right, rootPath)
        || left.localeCompare(right)),
    };
  } catch (err) {
    return null;
  }
}

function getKnownIndexedDirectories(files, rootPath) {
  const directories = new Set([rootPath]);
  (Array.isArray(files) ? files : []).forEach((item) => {
    let path = item && typeof item.path === "string" ? getParentPath(item.path) : null;
    while (path && IncrementalIndexState.isPathWithinRoot(path, rootPath)) {
      directories.add(path);
      if (path === rootPath) break;
      path = getParentPath(path);
    }
  });
  return directories;
}

function getListedChildPath(parentPath, entry) {
  const name = entry && (entry.filename || entry.name);
  if (
    typeof name !== "string"
    || !name
    || name === "."
    || name === ".."
    || name.includes("/")
    || name.includes("\0")
  ) return null;
  return parentPath === "/" ? `/${name}` : `${parentPath}/${name}`;
}

async function listChangedDirectories(paths, { rootPath, previousFiles, maxDepth }) {
  const snapshots = [];
  const knownDirectories = getKnownIndexedDirectories(previousFiles, rootPath);
  const queued = new Set(paths);
  const pending = paths.slice();
  for (let index = 0; index < pending.length; index++) {
    const path = pending[index];
    try {
      const entries = await file.list(path);
      if (!Array.isArray(entries)) return null;
      snapshots.push({ path, entries });
      entries.forEach((entry) => {
        const isDir = entry && (entry.isDir === true || entry.is_dir === true);
        if (!isDir) return;
        const childPath = getListedChildPath(path, entry);
        if (
          !childPath
          || queued.has(childPath)
          || knownDirectories.has(childPath)
          || !isIndexableDirectoryPath(childPath, rootPath, maxDepth)
        ) return;
        queued.add(childPath);
        pending.push(childPath);
      });
    } catch (err) {
      return null;
    }
    if (snapshots.length % 50 === 0) await new Promise((resolve) => setTimeout(resolve, 0));
  }
  return snapshots;
}

function createIndexedRecord(entry, context, preferenceSnapshot, changedFiles = new Set()) {
  const ext = FileTypes.getExtension(context.name);
  const type = ext ? getFileTypeByExt(ext) : FILE_TYPES.OTHER;
  if (type === FILE_TYPES.OTHER || !shouldShowFile(context.name, preferenceSnapshot)) return null;
  let previousRecord = context.previousRecord || {};
  if (changedFiles.has(context.path)) {
    const { duration, width, height, size, ...stableRecord } = previousRecord;
    previousRecord = stableRecord;
  }
  const baseRecord = {
    ...previousRecord,
    name: context.name,
    path: context.path,
    type,
    ext,
    parentPath: context.parentPath,
    rootPath: context.rootPath,
  };
  return {
    ...baseRecord,
    ...(SeriesState.parseEpisode(baseRecord, { rootPath: context.rootPath }) || {}),
  };
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
let currentView = null;
let browserContext = null;
let stateLoaded = false;

let fileIndex = { extensions: new Set(), files: [] };
let indexSnapshot = IndexState.createSnapshot();
let indexSnapshotPrepared = true;
let cachedIndexConfigCompatible = true;
let playbackSnapshot = PlaybackState.normalizeSnapshot();
const dirtyPlaybackPaths = new Set();
let playbackRevision = 0;
let smartViewCacheKey = null;
let smartViewCache = new Map();
let smartCountCacheKey = null;
let smartCountCache = null;
let indexedItemsCacheKey = null;
let indexedItemsCache = [];
let indexedItemPositions = new Map();
const indexedRecordsByPath = new Map();
const cachedChildrenByParent = new Map();
const pendingIndexedMetadata = new Map();
let fileIndexRevision = 0;
let publishedIndexRevision = null;
let isIndexing = false;
let indexProgress = { filesProcessed: 0, totalEstimate: 0 };
let activeIndexBuild = null;
let rootGeneration = 0;
let indexMetadataWriteTimer = null;
let deferredIndexTimer = null;
let deferHeavyIndexWork = false;
let windowIsOpen = false;
let diagnosticRootCount = 0;
const forceFullScanRoots = new Set();
const diagnostics = Diagnostics.create();

function scheduleIndexMetadataSave() {
  if (indexMetadataWriteTimer) return;
  indexMetadataWriteTimer = setTimeout(() => {
    indexMetadataWriteTimer = null;
    saveIndexSnapshot();
  }, INDEX_METADATA_WRITE_DELAY);
}

function mergeIndexedMetadata(path, metadata) {
  if (!isPathInFolderRoots(path) || !metadata || typeof metadata !== "object") return false;
  const normalized = {};
  ["duration", "width", "height"].forEach((field) => {
    const value = Number(metadata[field]);
    if (Number.isFinite(value) && value > 0) normalized[field] = value;
  });
  if (Object.keys(normalized).length === 0) return false;

  let changed = false;
  const record = indexedRecordsByPath.get(path);
  const indexedItem = record && record.item;
  if (indexedItem) {
    Object.keys(normalized).forEach((field) => {
      if (indexedItem[field] !== normalized[field]) {
        indexedItem[field] = normalized[field];
        changed = true;
      }
    });
  }
  const snapshotItem = record && record.snapshotItem;
  if (snapshotItem) Object.assign(snapshotItem, normalized);
  if (!changed) return false;

  pendingIndexedMetadata.set(path, normalized);
  fileIndexRevision++;
  smartViewCacheKey = null;
  scheduleIndexMetadataSave();
  return true;
}

function applyPendingIndexedMetadata(snapshot) {
  if (pendingIndexedMetadata.size === 0) return;
  Object.values(snapshot.roots || {}).forEach((root) => {
    root.files.forEach((item) => {
      const metadata = pendingIndexedMetadata.get(item.path);
      if (metadata) Object.assign(item, metadata);
    });
  });
}

function completionThreshold() {
  const percent = Number(preferences.get("completionThreshold"));
  const bounded = Number.isFinite(percent)
    ? Math.min(100, Math.max(1, percent))
    : DEFAULT_COMPLETION_THRESHOLD_PERCENT;
  return bounded / 100;
}

function refreshWatchedPaths() {
  watchedPaths = new Set(PlaybackState.getWatchedPaths(playbackSnapshot, {
    completionThreshold: completionThreshold(),
  }));
}

function getPlaybackPresentation(path) {
  const record = PlaybackState.normalizeRecord(playbackSnapshot.records[path]);
  return {
    state: PlaybackState.classifyRecord(record, { completionThreshold: completionThreshold() }),
    position: record.position,
    duration: record.duration,
    fraction: PlaybackState.getProgressRatio(record),
    lastPlayedAt: record.lastPlayedAt,
  };
}

function decorateFileItem(item) {
  if (!item || item.isDir) return item;
  const playback = getPlaybackPresentation(item.path);
  return {
    ...item,
    watched: playback.state === "watched",
    playbackState: playback.state,
    progress: playback,
  };
}

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
  prepareCachedIndex();
  isIndexing = true;
  indexProgress = { filesProcessed: 0, totalEstimate: 0 };
  const startedAt = Date.now();
  diagnostics.increment("index.scans");
  postWindowMessage("index-building", { progress: indexProgress });

  const rootPaths = folderRoots.map((root) => root.path);
  for (let ordinal = rootPaths.length + 1; ordinal <= diagnosticRootCount; ordinal++) {
    diagnostics.removeRootStatus(ordinal);
  }
  diagnosticRootCount = rootPaths.length;
  const buildGeneration = rootGeneration;
  const preferenceSnapshot = getPreferencesSnapshot();
  let needsFollowupScan = false;
  const adoptedMarkers = new Map();
  try {
    let candidateSnapshot = IndexState.normalizeSnapshot(indexSnapshot);
    let statusChanged = false;
    let playbackPruned = false;
    Object.keys(candidateSnapshot.roots || {}).forEach((rootPath) => {
      if (!rootPaths.includes(rootPath)) candidateSnapshot = IndexState.removeRoot(candidateSnapshot, rootPath);
    });
    candidateSnapshot.configKey = getIndexConfigKey(preferenceSnapshot);
    for (const rootPath of rootPaths) {
      const rootIndex = { extensions: new Set(), files: [] };
      const rootOrdinal = rootPaths.indexOf(rootPath) + 1;
      const previousRoot = candidateSnapshot.roots[rootPath];
      const marker = await prepareNextIndexMarker(rootPath, previousRoot);
      diagnostics.setRootStatus(rootOrdinal, "reconciling");
      const changedDirectories = await discoverChangedDirectories(
        rootPath,
        previousRoot,
        marker,
        preferenceSnapshot,
      );
      let complete = false;
      let reconciliationFiles = previousRoot ? previousRoot.files : [];
      if (changedDirectories) {
        const directorySnapshots = await listChangedDirectories(changedDirectories.paths, {
          rootPath,
          previousFiles: previousRoot.files,
          maxDepth: preferenceSnapshot.maxIndexDepth,
        });
        if (directorySnapshots) {
          changedDirectories.changedFiles.forEach((path) => {
            pendingIndexedMetadata.delete(path);
            thumbnailLoader.remove(path);
            mediaMetadataLoader.remove(path);
          });
          reconciliationFiles = previousRoot.files.map((item) => {
            if (!changedDirectories.changedFiles.has(item.path)) return item;
            const nextItem = { ...item };
            delete nextItem.duration;
            delete nextItem.width;
            delete nextItem.height;
            delete nextItem.size;
            return nextItem;
          });
          rootIndex.files = IncrementalIndexState.reconcileDirectories({
            files: reconciliationFiles,
            rootPath,
            changedDirectories: directorySnapshots,
            createRecord: (entry, context) => createIndexedRecord(
              entry,
              context,
              preferenceSnapshot,
              changedDirectories.changedFiles,
            ),
          });
          rootIndex.files.forEach((item) => {
            if (item.ext) rootIndex.extensions.add(item.ext);
          });
          indexProgress.filesProcessed += directorySnapshots.reduce(
            (count, snapshot) => count + snapshot.entries.length,
            0,
          );
          complete = true;
        }
      } else {
        complete = await indexFolderRecursive(
          rootPath,
          0,
          rootIndex,
          indexProgress,
          preferenceSnapshot,
          rootPath,
        );
      }
      if (complete && marker && !ownsIndexMarker(rootPath, marker)) {
        forceFullScanRoots.add(rootPath);
        needsFollowupScan = true;
        diagnostics.record("index", "marker-conflict");
        continue;
      }
      if (reconciliationFiles !== (previousRoot && previousRoot.files)) {
        candidateSnapshot.roots[rootPath] = { ...previousRoot, files: reconciliationFiles };
      }
      const merged = IndexState.mergeRoot(candidateSnapshot, rootPath, {
        ok: complete,
        files: rootIndex.files,
        markerSlot: complete && marker ? marker.nextSlot : undefined,
        markerToken: complete && marker ? marker.token : undefined,
        errorCode: complete ? null : "scan-failed",
      }, { now: Date.now() });
      candidateSnapshot = merged.snapshot;
      if (complete && marker) adoptedMarkers.set(rootPath, marker);
      statusChanged = statusChanged || merged.statusChanged;
      diagnostics.increment("index.files-added", merged.diff.added.length);
      diagnostics.increment("index.files-removed", merged.diff.removed.length);
      if (complete) {
        merged.diff.removed.forEach((path) => {
          let stillExists = true;
          try {
            stillExists = file.exists(path);
          } catch (err) {
            return;
          }
          if (!stillExists && hasOwn(playbackSnapshot.records, path)) {
            delete playbackSnapshot.records[path];
            dirtyPlaybackPaths.add(path);
            playbackPruned = true;
          }
        });
      }
      if (!complete) {
        diagnostics.increment("index.scan-failures");
        diagnostics.record("index", "scan-failed");
      }
      diagnostics.setRootStatus(rootOrdinal, complete ? "ready" : "unavailable", {
        files: (candidateSnapshot.roots[rootPath] && candidateSnapshot.roots[rootPath].files.length) || 0,
      });
    }
    if (buildGeneration !== rootGeneration) return;
    candidateSnapshot = mergeNewerPersistedIndex(candidateSnapshot, rootPaths);
    applyPendingIndexedMetadata(candidateSnapshot);
    const previousFiles = fileIndex.files;
    indexSnapshot = candidateSnapshot;
    rebuildFileIndexFromSnapshot();
    pendingIndexedMetadata.clear();
    const changed = JSON.stringify(previousFiles) !== JSON.stringify(fileIndex.files);
    if (changed || statusChanged) fileIndexRevision++;
    saveIndexSnapshot();
    adoptedMarkers.forEach((marker, rootPath) => {
      if (ownsIndexMarker(rootPath, marker)) return;
      forceFullScanRoots.add(rootPath);
      needsFollowupScan = true;
    });
    if (playbackPruned) {
      playbackRevision++;
      refreshWatchedPaths();
      savePlaybackSnapshot();
    }
    diagnostics.setGauge("index.file-count", fileIndex.files.length);
    diagnostics.setGauge("index.root-count", rootPaths.length);
  } finally {
    isIndexing = false;
    diagnostics.record("index", "completed", { durationMs: Date.now() - startedAt });
    postWindowMessage("index-complete", { progress: indexProgress });
    if (needsFollowupScan) {
      setTimeout(() => {
        buildFileIndex({ afterCurrent: true }).then(updateWindow).catch(() => {});
      }, 0);
    }
  }
}

async function indexFolderRecursive(folderPath, depth, targetIndex, progress, preferenceSnapshot, rootPath) {
  try {
    const folderName = folderPath.split("/").pop();
    if (depth > 0 && folderName && (folderName.startsWith(".") || folderName.startsWith("~"))) return true;
    const items = await file.list(folderPath);
    if (!items || !Array.isArray(items)) return false;

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
            const baseRecord = {
              name: itemName,
              path: fullPath,
              type: fileType,
              ext: ext,
              parentPath: folderPath,
              rootPath,
            };
            targetIndex.files.push({
              ...baseRecord,
              ...(SeriesState.parseEpisode(baseRecord, { rootPath }) || {}),
            });
          }
        }
        progress.filesProcessed++;
      }

      if ((i + 1) % BATCH_SIZE === 0) {
        await new Promise(resolve => setTimeout(resolve, 0));
        if (isIndexing && progress.filesProcessed % 1000 === 0) {
          postWindowMessage("index-progress", { progress });
        }
      }
    }
    
    await new Promise(resolve => setTimeout(resolve, 0));
    if (isIndexing && progress.filesProcessed % 100 === 0) {
      postWindowMessage("index-progress", { progress });
    }
    let complete = true;
    for (const subdir of subdirs) {
      if (!await indexFolderRecursive(
        subdir,
        depth + 1,
        targetIndex,
        progress,
        preferenceSnapshot,
        rootPath,
      )) complete = false;
    }
    return complete;
  } catch (err) {
    return false;
  }
}

function writeJson(path, value, category) {
  try {
    const serialized = JSON.stringify(value);
    if (file.exists(path)) {
      const previous = file.read(path);
      if (previous) {
        try {
          JSON.parse(previous);
          file.write(`${path}.backup`, previous);
        } catch (err) {
          // Keep the last known-good backup when the primary is corrupt.
        }
      }
    }
    file.write(path, serialized);
    return true;
  } catch (err) {
    diagnostics.record(category || "state", "write-failed");
    console.error("[Quick Folders] Failed to save plugin state");
    return false;
  }
}

function readJson(path) {
  try {
    if (file.exists(path)) {
      const data = file.read(path);
      if (data) return JSON.parse(data);
    }
  } catch (err) {
    diagnostics.record("state", "read-failed");
  }
  try {
    const backupPath = `${path}.backup`;
    if (!file.exists(backupPath)) return null;
    const backup = file.read(backupPath);
    return backup ? JSON.parse(backup) : null;
  } catch (err) {
    diagnostics.record("state", "read-failed");
    return null;
  }
}

function saveState() {
  return writeJson(STATE_FILE, { folderRoots, queuePaths, version: 4 }, "state");
}

function saveIndexSnapshot() {
  return writeJson(INDEX_FILE, indexSnapshot, "cache");
}

function mergeNewerPersistedIndex(candidate, rootPaths) {
  const persisted = readJson(INDEX_FILE);
  if (!persisted || !IndexState.isCompatible(persisted, candidate.configKey)) return candidate;
  const latest = IndexState.normalizeSnapshot(persisted);
  rootPaths.forEach((rootPath) => {
    const currentRoot = candidate.roots[rootPath];
    const latestRoot = latest.roots[rootPath];
    if (!latestRoot) return;
    const currentTime = Number(currentRoot && currentRoot.lastSuccessfulAt) || 0;
    const latestTime = Number(latestRoot.lastSuccessfulAt) || 0;
    if (!currentRoot || latestTime > currentTime) candidate.roots[rootPath] = latestRoot;
  });
  return candidate;
}

function savePlaybackSnapshot() {
  const previousRecords = JSON.stringify(playbackSnapshot.records);
  const onDisk = PlaybackState.normalizeSnapshot(readJson(PLAYBACK_FILE) || playbackSnapshot);
  dirtyPlaybackPaths.forEach((path) => {
    if (hasOwn(playbackSnapshot.records, path)) onDisk.records[path] = playbackSnapshot.records[path];
    else delete onDisk.records[path];
  });
  playbackSnapshot = onDisk;
  playbackSnapshot = PlaybackState.pruneSnapshot(playbackSnapshot);
  if (JSON.stringify(playbackSnapshot.records) !== previousRecords) {
    playbackRevision++;
    indexedItemsCacheKey = null;
    smartCountCacheKey = null;
  }
  refreshWatchedPaths();
  const succeeded = writeJson(PLAYBACK_FILE, playbackSnapshot, "playback");
  if (succeeded) {
    dirtyPlaybackPaths.clear();
    diagnostics.increment("playback.flushes");
  }
  return succeeded;
}

function saveBrowserContext(nextContext) {
  if (!nextContext || typeof nextContext !== "object" || Array.isArray(nextContext)) return;
  const validView = typeof nextContext.view === "string" && hasOwn(SMART_VIEW_LABELS, nextContext.view)
    ? nextContext.view
    : null;
  const validPath = isPathInFolderRoots(nextContext.path) ? nextContext.path : null;
  const validOptionalPath = (value) => isPathInFolderRoots(value) ? value : null;
  const recents = (Array.isArray(nextContext.recents) ? nextContext.recents : [])
    .slice(0, 12)
    .map((location) => {
      if (!location || typeof location !== "object") return null;
      if (typeof location.view === "string" && hasOwn(SMART_VIEW_LABELS, location.view)) {
        return { view: location.view, path: null };
      }
      return isPathInFolderRoots(location.path) ? { view: null, path: location.path } : null;
    })
    .filter(Boolean);
  const allowed = {
    version: 1,
    view: validView,
    path: validPath,
    query: typeof nextContext.query === "string" ? nextContext.query.substring(0, 500) : "",
    filter: typeof nextContext.filter === "string" ? nextContext.filter.substring(0, 32) : "all",
    layout: nextContext.layout === "grid" ? "grid" : "list",
    focusedPath: validOptionalPath(nextContext.focusedPath),
    scrollAnchor: validOptionalPath(nextContext.scrollAnchor),
    scrollOffset: Number.isFinite(Number(nextContext.scrollOffset)) ? Number(nextContext.scrollOffset) : 0,
    recents,
  };
  browserContext = allowed;
  writeJson(BROWSER_CONTEXT_FILE, allowed, "state");
}

function getIndexConfigKey(preferenceSnapshot = getPreferencesSnapshot()) {
  return JSON.stringify({
    roots: folderRoots.map((root) => root.path),
    maxIndexDepth: preferenceSnapshot.maxIndexDepth,
    filterAudio: preferenceSnapshot.filterAudio,
    filterImages: preferenceSnapshot.filterImages,
    videoOnly: preferenceSnapshot.videoOnly,
  });
}

function rebuildFileIndexFromSnapshot() {
  const files = IndexState.getFilesFromNormalizedSnapshot(indexSnapshot);
  fileIndex = {
    extensions: new Set(files.map((item) => item.ext).filter(Boolean)),
    files,
  };
  indexedRecordsByPath.clear();
  cachedChildrenByParent.clear();
  const rememberChild = (parentPath, item) => {
    if (!cachedChildrenByParent.has(parentPath)) cachedChildrenByParent.set(parentPath, new Map());
    cachedChildrenByParent.get(parentPath).set(item.path, item);
  };
  fileIndex.files.forEach((item) => {
    indexedRecordsByPath.set(item.path, { item, snapshotItem: item });
    const rootSnapshot = indexSnapshot.roots[item.rootPath];
    if (!rootSnapshot || rootSnapshot.status !== "unavailable") return;
    rememberChild(item.parentPath, item);
    let childPath = item.parentPath;
    while (childPath && childPath !== item.rootPath) {
      const slashIndex = childPath.lastIndexOf("/");
      const parentPath = slashIndex <= 0 ? "/" : childPath.substring(0, slashIndex);
      rememberChild(parentPath, {
        path: childPath,
        name: childPath.substring(slashIndex + 1),
        isDir: true,
        rootPath: item.rootPath,
      });
      childPath = parentPath;
    }
  });
  indexedItemsCacheKey = null;
  smartCountCacheKey = null;
}

function prepareCachedIndex() {
  if (indexSnapshotPrepared) return;
  indexSnapshot = IndexState.normalizeSnapshot(indexSnapshot);
  reconcileIndexRoots();
  if (!cachedIndexConfigCompatible) {
    folderRoots.forEach((root) => {
      indexSnapshot = IndexState.markRootStale(indexSnapshot, root.path);
    });
  }
  rebuildFileIndexFromSnapshot();
  indexSnapshotPrepared = true;
}

function migrateLegacyIndex(state) {
  if (!state || !state.fileIndex || !Array.isArray(state.fileIndex.files)) return;
  const now = Date.now();
  folderRoots.forEach((root) => {
    const files = state.fileIndex.files
      .filter((item) => BrowseState.isPathWithinRoots(item.path, [root]))
      .map((item) => ({ ...item, firstSeenAt: 0 }));
    indexSnapshot = IndexState.mergeRoot(indexSnapshot, root.path, { ok: true, files }, { now }).snapshot;
  });
  indexSnapshot.configKey = getIndexConfigKey();
}

function normalizeFolderRoots(roots) {
  const normalized = [];
  const seen = new Set();
  (Array.isArray(roots) ? roots : []).forEach((root) => {
    const source = root && typeof root === "object" ? root : {};
    const path = IndexState.normalizeRootPath(source.path);
    if (!path || seen.has(path)) return;
    seen.add(path);
    const fallbackName = path === "/" ? "/" : path.split("/").pop();
    const name = typeof source.name === "string" && source.name.trim() && !source.name.includes("/")
      ? source.name.trim().substring(0, 200)
      : fallbackName;
    normalized.push({ path, name });
  });
  return normalized;
}

function reconcileIndexRoots() {
  const configured = new Set(folderRoots.map((root) => root.path));
  let changed = false;
  Object.keys(indexSnapshot.roots || {}).forEach((rootPath) => {
    if (!configured.has(rootPath)) {
      indexSnapshot = IndexState.removeRoot(indexSnapshot, rootPath);
      changed = true;
    }
  });
  return changed;
}

function reloadSharedState() {
  const latest = readJson(STATE_FILE);
  if (!latest || !Array.isArray(latest.folderRoots)) {
    try {
      return !file.exists(STATE_FILE);
    } catch (err) {
      return false;
    }
  }
  const previousRoots = folderRoots.map((root) => root.path).join("\n");
  folderRoots = normalizeFolderRoots(latest.folderRoots);
  queuePaths = QueueState.normalizePaths(latest.queuePaths).filter(isValidMediaPath);
  if (previousRoots !== folderRoots.map((root) => root.path).join("\n")) rootGeneration++;
  if (reconcileIndexRoots()) {
    rebuildFileIndexFromSnapshot();
    fileIndexRevision++;
  }
  if (currentPath && !isPathInFolderRoots(currentPath)) {
    currentPath = null;
    currentView = null;
    history = [];
  }
  return true;
}

function loadState() {
  if (stateLoaded) return;
  stateLoaded = true;
  try {
    const state = readJson(STATE_FILE);
    if (state && Array.isArray(state.folderRoots)) {
      folderRoots = normalizeFolderRoots(state.folderRoots);
      const cachedIndex = readJson(INDEX_FILE);
      const compatibleSchema = cachedIndex && Number(cachedIndex.version) === IndexState.SCHEMA_VERSION;
      indexSnapshot = compatibleSchema
        ? cachedIndex
        : IndexState.createSnapshot();
      indexSnapshotPrepared = !compatibleSchema;
      cachedIndexConfigCompatible = !compatibleSchema || IndexState.isCompatible(cachedIndex, getIndexConfigKey());
      if (!compatibleSchema) migrateLegacyIndex(state);
      playbackSnapshot = PlaybackState.migrateSnapshot(readJson(PLAYBACK_FILE), {
        watchedPaths: BrowseState.normalizePaths(state.watchedPaths),
        now: Date.now(),
      });
      if (!file.exists(PLAYBACK_FILE)) {
        Object.keys(playbackSnapshot.records).forEach((path) => dirtyPlaybackPaths.add(path));
      }
      refreshWatchedPaths();
      if (indexSnapshotPrepared) rebuildFileIndexFromSnapshot();
      queuePaths = QueueState.normalizePaths(state.queuePaths).filter(isValidMediaPath);
      browserContext = readJson(BROWSER_CONTEXT_FILE);
      if (Number(state.version) < 4 || !compatibleSchema || !file.exists(PLAYBACK_FILE)) {
        const migratedIndexSaved = saveIndexSnapshot();
        const migratedPlaybackSaved = savePlaybackSnapshot();
        if (migratedIndexSaved && migratedPlaybackSaved) saveState();
      }
      return;
    }

    const legacyPath = "@data/folders.json";
    if (file.exists(legacyPath)) {
      const data = file.read(legacyPath);
      if (data) {
        const legacyFolders = JSON.parse(data);
        if (Array.isArray(legacyFolders)) {
          folderRoots = normalizeFolderRoots(legacyFolders);
          saveState();
        }
      }
    }
  } catch (err) {
    // Silently continue on error
  }
}

function listFolder(path, { includeFileSizes = true } = {}) {
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
        if (!isDir && includeFileSizes) {
          try {
            const stats = file.stat(fullPath);
            fileSize = stats && stats.size ? stats.size : null;
          } catch (e) {
            // Ignore stat errors
          }
        }
        const cached = isDir ? folderScanCache.get(fullPath) : null;
        return decorateFileItem({
          path: fullPath,
          name: itemName,
          isDir: isDir,
          size: fileSize,
          scanning: isDir && (!cached || cached.status === "scanning"),
        });
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
    return decorateFileItem({
      path,
      name,
      isDir: false,
      size: fileSize,
    });
  } catch (err) {
    return null;
  }
}

function isBrowsableDirectory(path) {
  if (!isPathInFolderRoots(path)) return false;
  const unavailableRoot = folderRoots.find((root) => (
    BrowseState.isPathWithinRoots(path, [root])
      && indexSnapshot.roots[root.path]
      && indexSnapshot.roots[root.path].status === "unavailable"
  ));
  if (unavailableRoot) {
    return path === unavailableRoot.path || cachedChildrenByParent.has(path);
  }
  if (!file.exists(path)) return false;
  try {
    return Array.isArray(file.list(path, { includeSubDir: false }));
  } catch (err) {
    return false;
  }
}

function getCachedFolderItems(path) {
  const root = folderRoots.find((candidate) => BrowseState.isPathWithinRoots(path, [candidate]));
  const rootSnapshot = root && indexSnapshot.roots[root.path];
  if (!rootSnapshot || rootSnapshot.status !== "unavailable") return null;
  const cachedChildren = cachedChildrenByParent.get(path);
  return Array.from(cachedChildren ? cachedChildren.values() : []).map((item) => (
    item.isDir
      ? { ...item, unavailable: true }
      : { ...decorateFileItem(item), isDir: false, unavailable: true }
  )).sort((left, right) => {
    if (left.isDir !== right.isDir) return left.isDir ? -1 : 1;
    return left.name.localeCompare(right.name) || left.path.localeCompare(right.path);
  });
}

function getWatchedItems() {
  return getSmartViewItems("watched");
}

function getQueueItems() {
  const directoryCache = new Map();
  return queuePaths.map((path) => getFileItem(path, directoryCache)).filter(Boolean);
}

function getIndexedItems() {
  const cacheKey = `${fileIndexRevision}:${completionThreshold()}`;
  if (cacheKey === indexedItemsCacheKey) return indexedItemsCache;
  const rootStatuses = indexSnapshot.roots || {};
  indexedItemsCache = fileIndex.files.map((item) => decorateFileItem({
    ...item,
    isDir: false,
    unavailable: rootStatuses[item.rootPath] && rootStatuses[item.rootPath].status === "unavailable",
  }));
  indexedItemPositions = new Map(indexedItemsCache.map((item, index) => [item.path, index]));
  indexedItemsCacheKey = cacheKey;
  return indexedItemsCache;
}

function refreshCachedPlaybackItem(path) {
  if (!indexedItemsCacheKey) return;
  const index = indexedItemPositions.get(path);
  if (index >= 0) indexedItemsCache[index] = decorateFileItem(indexedItemsCache[index]);
}

function getSmartViewCounts() {
  const cacheKey = `${fileIndexRevision}:${completionThreshold()}`;
  if (cacheKey === smartCountCacheKey && smartCountCache) return smartCountCache;
  const counts = { continue: 0, recent: 0, series: 0, unwatched: 0, watched: 0 };
  const incompleteSeries = new Set();
  getIndexedItems().forEach((item) => {
    if (item.playbackState === "in-progress") counts.continue++;
    if (Number.isFinite(item.firstSeenAt) && item.firstSeenAt > 0) counts.recent++;
    if (item.playbackState === "watched") counts.watched++;
    else {
      counts.unwatched++;
      if (item.seriesKey) incompleteSeries.add(item.seriesKey);
    }
  });
  counts.series = incompleteSeries.size;
  smartCountCache = counts;
  smartCountCacheKey = cacheKey;
  return counts;
}

function getSmartViewItems(view) {
  const cacheKey = `${fileIndexRevision}:${playbackRevision}:${completionThreshold()}`;
  if (cacheKey !== smartViewCacheKey) {
    smartViewCacheKey = cacheKey;
    smartViewCache = new Map();
  }
  if (smartViewCache.has(view)) return smartViewCache.get(view);
  let items = getIndexedItems();
  if (view === "continue") {
    items = items
      .filter((item) => item.playbackState === "in-progress")
      .sort((left, right) => (right.progress.lastPlayedAt || 0) - (left.progress.lastPlayedAt || 0)
        || left.path.localeCompare(right.path));
  } else if (view === "recent") {
    items = items
      .filter((item) => Number.isFinite(item.firstSeenAt) && item.firstSeenAt > 0)
      .sort((left, right) => right.firstSeenAt - left.firstSeenAt
        || left.name.localeCompare(right.name)
        || left.path.localeCompare(right.path));
  } else if (view === "unwatched") {
    items = items
      .filter((item) => item.playbackState !== "watched")
      .sort((left, right) => left.name.localeCompare(right.name) || left.path.localeCompare(right.path));
  } else if (view === "watched") {
    items = items
      .filter((item) => item.playbackState === "watched")
      .sort((left, right) => left.name.localeCompare(right.name) || left.path.localeCompare(right.path));
  } else if (view === "series") {
    items = SeriesState.recommendSeries(items, {
      getPlaybackState: (item) => item.playbackState,
    }).map((recommendation) => ({
      ...recommendation.nextEpisode,
      seriesRecommendation: true,
    }));
  } else {
    return [];
  }
  const boundedItems = ["continue", "recent", "series"].includes(view)
    ? items.slice(0, MAX_SMART_VIEW_ITEMS)
    : items;
  const result = boundedItems.map((item) => ({
    ...item,
    fromSmartView: true,
    smartView: view,
  }));
  smartViewCache.set(view, result);
  return result;
}

const SMART_VIEW_LABELS = Object.freeze({
  continue: "Continue Watching",
  series: "Continue Series",
  recent: "Recently Added",
  unwatched: "Unwatched",
  watched: "Watched",
});

function makeSmartRoot(view, count) {
  const item = {
    path: `@view/${view}`,
    name: SMART_VIEW_LABELS[view],
    isDir: true,
    isSmartView: true,
    smartView: view,
  };
  if (Number.isFinite(count)) item.itemCount = count;
  return item;
}

function getRootItems() {
  const roots = folderRoots.map((f) => ({
      path: f.path,
      name: f.name,
      isDir: true,
      isRoot: true,
  }));
  const counts = deferHeavyIndexWork ? null : getSmartViewCounts();
  const smartRoots = ["continue", "series", "recent", "unwatched"].map((view) => makeSmartRoot(
    view,
    counts && ["continue", "recent", "series"].includes(view)
      ? Math.min(counts[view], MAX_SMART_VIEW_ITEMS)
      : counts && counts[view],
  ));
  if ((preferences.get("hideWatched") ?? false)) {
    smartRoots.push(makeSmartRoot("watched", counts && counts.watched));
  }
  return smartRoots.concat(roots);
}

function getCurrentItems() {
  if (currentView) return getSmartViewItems(currentView);
  if (!currentPath) return getRootItems();

  // Inside a folder: retain the last useful indexed children when the source
  // root is temporarily unavailable, otherwise use the live directory view.
  return getCachedFolderItems(currentPath) || listFolder(currentPath);
}

function getNavigationColumns() {
  if (!currentPath && !currentView) return [];

  const rootItems = getRootItems();
  if (currentView) {
    return [{
      id: "quick-folders",
      title: "Quick Folders",
      items: rootItems,
      selectedPath: `@view/${currentView}`,
    }];
  }

  const root = getCurrentFolderRoot();
  if (!root) return [];
  const locations = BrowseState.getAncestorLocations(currentPath, root.path);
  const columns = [{
    id: "quick-folders",
    title: "Quick Folders",
    items: rootItems,
    selectedPath: root.path,
  }];
  locations.forEach((location, index) => {
    columns.push({
      id: location,
      title: location.split("/").pop() || location,
      // Ancestor columns intentionally skip file stats; the active detail
      // column owns sizes and metadata, keeping resize/navigation inexpensive.
      items: listFolder(location, { includeFileSizes: false }),
      selectedPath: locations[index + 1] || currentPath,
    });
  });
  return columns;
}

function getPreferencesSnapshot() {
  return {
    filterImages: preferences.get("filterImages") ?? true,
    filterAudio: preferences.get("filterAudio") ?? true,
    videoOnly: preferences.get("videoOnly") ?? false,
    hideWatched: preferences.get("hideWatched") ?? false,
    showBitrateChips: preferences.get("showBitrateChips") ?? false,
    completionThreshold: completionThreshold(),
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
    folderRoots: folderRoots.map((root) => ({ path: root.path, name: root.name })),
    currentPath: currentView ? `@view/${currentView}` : currentPath,
    currentRootPath: currentRoot ? currentRoot.path : null,
    atRoot: !currentPath && !currentView,
    currentView,
    currentViewTitle: currentView ? SMART_VIEW_LABELS[currentView] : null,
    viewingWatched: currentView === "watched",
    availableExtensions: Array.from(fileIndex.extensions).sort(),
    indexRevision: fileIndexRevision,
    indexReady,
    isIndexing,
    folderDepth: getCurrentFolderDepth(),
    preferences: preferenceSnapshot,
    queueItems: getQueueItems(),
    navigationColumns: getNavigationColumns(),
    rootStatuses: Object.values(indexSnapshot.roots || {}).filter((root) => (
      root && typeof root === "object"
    )).map((root) => ({
      status: root.status,
      lastSuccessfulAt: root.lastSuccessfulAt,
    })),
    cacheBuiltAt: indexSnapshot.builtAt,
    browserContext,
  };

  // The complete index can be large. Publish it only when its revision changes;
  // ordinary navigation and queue updates already share the UI's cached copy.
  if (!deferHeavyIndexWork && publishedIndexRevision !== fileIndexRevision) {
    state.indexedFiles = getIndexedItems();
    publishedIndexRevision = fileIndexRevision;
  }
  postWindowMessage("update-items", state);
}

function scheduleDeferredIndexPublication(delay = 0) {
  if (deferredIndexTimer) return;
  deferredIndexTimer = setTimeout(() => {
    deferredIndexTimer = null;
    prepareCachedIndex();
    deferHeavyIndexWork = false;
    publishedIndexRevision = null;
    if (windowIsOpen) updateWindow();
  }, delay);
}

function rebuildIndexExtensions() {
  fileIndex.extensions = new Set(fileIndex.files.map((item) => item.ext).filter(Boolean));
  fileIndexRevision++;
}

function updateWatchedItems(paths, watched) {
  if (!reloadSharedState()) return;
  const succeeded = [];
  const failed = [];
  const directoryCache = new Map();
  BrowseState.normalizePaths(paths).slice(0, 1000).forEach((path) => {
    if (!getFileItem(path, directoryCache)) {
      failed.push({ path, reason: "File is unavailable or outside Quick Folders" });
      return;
    }
    succeeded.push(path);
  });

  if (succeeded.length > 0) {
    playbackSnapshot = PlaybackState.updateManualState(
      playbackSnapshot,
      succeeded,
      watched ? "watched" : "unwatched",
    );
    playbackRevision++;
    succeeded.forEach((path) => dirtyPlaybackPaths.add(path));
    refreshWatchedPaths();
    fileIndexRevision++;
    savePlaybackSnapshot();
  }
  updateWindow();
  postWindowMessage("item-action-result", {
    action: watched ? "watched" : "unwatched",
    succeeded,
    failed,
  });
}

function deleteItems(paths) {
  if (!reloadSharedState()) return;
  prepareCachedIndex();
  const succeeded = [];
  const failed = [];
  const directoryCache = new Map();
  BrowseState.normalizePaths(paths).slice(0, 1000).forEach((path) => {
    if (!getFileItem(path, directoryCache)) {
      failed.push({ path, reason: "File is unavailable or outside Quick Folders" });
      return;
    }
    try {
      // IINA only permits file.delete for plugin-owned @tmp/@data paths.
      // User media must go through the filesystem API's recoverable trash path.
      file.trash(path);
      if (file.exists(path)) throw new Error("The file still exists after moving it to Trash");
      delete playbackSnapshot.records[path];
      dirtyPlaybackPaths.add(path);
      playbackRevision++;
      queuePaths = QueueState.removePaths(queuePaths, [path]);
      thumbnailLoader.remove(path);
      mediaMetadataLoader.remove(path);
      succeeded.push(path);
    } catch (err) {
      failed.push({ path, reason: err && err.message ? err.message : "Deletion failed" });
    }
  });

  if (succeeded.length > 0) {
    const scanWasActive = Boolean(activeIndexBuild);
    rootGeneration++;
    const deleted = new Set(succeeded);
    Object.values(indexSnapshot.roots || {}).forEach((root) => {
      root.files = root.files.filter((item) => !deleted.has(item.path));
    });
    rebuildFileIndexFromSnapshot();
    refreshWatchedPaths();
    folderScanCache.clear();
    rebuildIndexExtensions();
    saveState();
    saveIndexSnapshot();
    savePlaybackSnapshot();
    if (scanWasActive) {
      buildFileIndex({ afterCurrent: true }).then(updateWindow).catch(() => {});
    }
  }
  updateWindow();
  postWindowMessage("item-action-result", {
    action: "trashed",
    succeeded,
    failed,
  });
}

function postQueueResult(action, succeeded = [], failed = []) {
  if (failed.length > 0) diagnostics.increment("queue.failures", failed.length);
  postWindowMessage("queue-action-result", { action, succeeded, failed });
}

function addQueueItems({ paths } = {}) {
  if (!reloadSharedState()) {
    postQueueResult("added", [], [{ reason: "Shared state is temporarily unavailable" }]);
    return;
  }
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
  if (!reloadSharedState()) {
    postQueueResult("removed", [], [{ reason: "Shared state is temporarily unavailable" }]);
    return;
  }
  const requested = new Set(QueueState.normalizePaths(paths));
  const succeeded = queuePaths.filter((path) => requested.has(path));
  if (succeeded.length === 0) return;
  queuePaths = QueueState.removePaths(queuePaths, succeeded);
  saveState();
  updateWindow();
  postQueueResult("removed", succeeded);
}

function clearQueue() {
  if (!reloadSharedState()) {
    postQueueResult("cleared", [], [{ reason: "Shared state is temporarily unavailable" }]);
    return;
  }
  if (queuePaths.length === 0) return;
  const succeeded = queuePaths.slice();
  queuePaths = [];
  saveState();
  updateWindow();
  postQueueResult("cleared", succeeded);
}

function reorderQueue({ paths, targetPath, position } = {}) {
  if (!reloadSharedState()) return;
  const nextQueue = QueueState.movePaths(queuePaths, paths, targetPath, position);
  if (nextQueue.join("\n") === queuePaths.join("\n")) return;
  queuePaths = nextQueue;
  saveState();
  updateWindow();
}

async function playQueue() {
  if (!reloadSharedState()) {
    postQueueResult("played", [], [{ reason: "Shared state is temporarily unavailable" }]);
    return;
  }
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

function setQueuePanelOpen({ open, resize = true } = {}) {
  if (!resize) return;
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
    if (!reloadSharedState()) return;
    folderPath = IndexState.normalizeRootPath(folderPath);
    if (!folderPath) return;
    if (folderRoots.some((f) => f.path === folderPath)) return;

    const folderName = folderPath.split("/").pop() || folderPath;
    folderRoots.push({ path: folderPath, name: folderName });
    rootGeneration++;
    saveState();
    updateWindow();

    await buildFileIndex({ afterCurrent: true });
    updateWindow();
  } catch (err) {
    console.error("[Quick Folders] Failed to add folder:", err);
  }
}

let windowHandlersRegistered = false;

function openItem({ path, isDir, isWatchedRoot, isSmartView, smartView } = {}) {
  prepareCachedIndex();
  const requestedView = isWatchedRoot || path === "@watched"
    ? "watched"
    : (isSmartView && typeof smartView === "string" ? smartView : String(path || "").replace(/^@view\//, ""));
  if (hasOwn(SMART_VIEW_LABELS, requestedView)) {
    history = [];
    currentPath = null;
    currentView = requestedView;
    updateWindow();
    return;
  }
  if (!isPathInFolderRoots(path)) return;

  if (isDir) {
    if (!isBrowsableDirectory(path)) return;
    history.push(currentPath);
    currentPath = path;
    currentView = null;
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
  if (currentView) {
    currentView = null;
    currentPath = null;
    history = [];
  } else {
    currentPath = history.length > 0 ? history.pop() || null : null;
  }
  updateWindow();
}

function navigateTo({ path } = {}) {
  prepareCachedIndex();
  if (!isBrowsableDirectory(path)) {
    history = [];
    currentPath = null;
    currentView = null;
    updateWindow();
    return;
  }
  history = [];
  currentPath = path;
  currentView = null;
  updateWindow();
}

function goRoot() {
  history = [];
  currentPath = null;
  currentView = null;
  updateWindow();
}

async function removeRoot({ path } = {}) {
  if (!reloadSharedState()) return;
  prepareCachedIndex();
  const nextRoots = folderRoots.filter((root) => root.path !== path);
  if (nextRoots.length === folderRoots.length) return;
  folderRoots = nextRoots;
  rootGeneration++;
  indexSnapshot = IndexState.removeRoot(indexSnapshot, path);
  queuePaths = queuePaths.filter((queuedPath) => !BrowseState.isPathWithinRoots(queuedPath, [{ path }]));
  if (currentPath && BrowseState.isPathWithinRoots(currentPath, [{ path }])) {
    currentPath = null;
    history = [];
  }
  saveState();
  saveIndexSnapshot();
  await buildFileIndex({ afterCurrent: true });
  updateWindow();
}

function registerWindowHandlers() {
  if (windowHandlersRegistered) return;
  windowHandlersRegistered = true;
  standaloneWindow.onMessage("open-item", openItem);
  standaloneWindow.onMessage("go-back", goBack);
  standaloneWindow.onMessage("request-state", ({ indexRevision } = {}) => {
    windowIsOpen = true;
    if (indexRevision !== fileIndexRevision) publishedIndexRevision = null;
    updateWindow();
    scheduleDeferredIndexPublication();
  });
  standaloneWindow.onMessage("window-closed", () => {
    windowIsOpen = false;
  });
  standaloneWindow.onMessage("request-thumbnail", (data) => requestThumbnail(data && data.path));
  standaloneWindow.onMessage("request-media-metadata", (data) => requestMediaMetadata(data && data.path));
  standaloneWindow.onMessage("navigate-to", navigateTo);
  standaloneWindow.onMessage("go-root", goRoot);
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
  standaloneWindow.onMessage("save-browser-context", saveBrowserContext);
  standaloneWindow.onMessage("request-diagnostics", () => {
    const thumbnailStats = thumbnailLoader.getStats();
    const metadataStats = mediaMetadataLoader.getStats();
    diagnostics.setGauge("thumbnail.active", thumbnailStats.active);
    diagnostics.setGauge("thumbnail.cache-size", thumbnailStats.cached);
    diagnostics.setGauge("thumbnail.queued", thumbnailStats.queued);
    diagnostics.setGauge("metadata.active", metadataStats.active);
    diagnostics.setGauge("metadata.cache-size", metadataStats.cached);
    diagnostics.setGauge("metadata.queued", metadataStats.queued);
    diagnostics.setGauge("queue.depth", queuePaths.length);
    diagnostics.setGauge("playback.record-count", Object.keys(playbackSnapshot.records).length);
    postWindowMessage("diagnostics-ready", diagnostics.getSnapshot());
  });
  standaloneWindow.onMessage("reset-preview-caches", () => {
    thumbnailLoader.clear();
    mediaMetadataLoader.clear();
    diagnostics.reset();
    postWindowMessage("diagnostics-reset", { succeeded: true });
  });
  standaloneWindow.onMessage("continue-series", ({ path, queue = false } = {}) => {
    if (!isValidMediaPath(path)) return;
    const source = getIndexedItems().find((item) => item.path === path);
    if (!source || !source.seriesKey) return;
    const recommendation = SeriesState.recommendNextEpisode(
      getIndexedItems().filter((item) => item.seriesKey === source.seriesKey),
      { getPlaybackState: (item) => item.playbackState },
    );
    if (!recommendation) return;
    if (queue) addQueueItems({ paths: [recommendation.path] });
    else openItem({ path: recommendation.path, isDir: false });
  });
  standaloneWindow.onMessage("refresh-index", async () => {
    await buildFileIndex();
    updateWindow();
  });
}

let currentPlaybackPath = null;
let progressWriteTimer = null;

function getLocalPlaybackPath(value) {
  if (typeof value !== "string" || !value || value.includes("\0")) return null;
  let path = value;
  const isFileUrl = path.startsWith("file://localhost/") || path.startsWith("file:///");
  if (path.startsWith("file://localhost/")) path = path.substring("file://localhost".length);
  else if (path.startsWith("file:///")) path = path.substring("file://".length);
  else if (/^[a-z][a-z0-9+.-]*:/i.test(path)) return null;
  if (isFileUrl) {
    try {
      path = decodeURIComponent(path);
    } catch (err) {
      return null;
    }
  }
  return isValidMediaPath(path) ? path : null;
}

function getPlaybackStatus() {
  return core && core.status && typeof core.status === "object" ? core.status : null;
}

function schedulePlaybackFlush() {
  if (progressWriteTimer) return;
  progressWriteTimer = setTimeout(() => {
    progressWriteTimer = null;
    savePlaybackSnapshot();
    if (windowIsOpen) updateWindow();
  }, PROGRESS_WRITE_DELAY);
}

function flushPlaybackState() {
  if (progressWriteTimer) clearTimeout(progressWriteTimer);
  progressWriteTimer = null;
  if (dirtyPlaybackPaths.size > 0) savePlaybackSnapshot();
  if (windowIsOpen) updateWindow();
}

function capturePlaybackSample({ flush = false } = {}) {
  const status = getPlaybackStatus();
  const rawPosition = status && status.position;
  const canCapture = status && !status.isNetworkResource && currentPlaybackPath
    && rawPosition !== null && rawPosition !== "" && typeof rawPosition !== "boolean";
  const position = canCapture ? Number(rawPosition) : NaN;
  if (Number.isFinite(position) && position >= 0) {
    const rawDuration = status.duration;
    const duration = rawDuration === null || rawDuration === "" || typeof rawDuration === "boolean"
      ? NaN
      : Number(rawDuration);
    const previousState = getPlaybackPresentation(currentPlaybackPath).state;
    playbackSnapshot = PlaybackState.updateProgress(playbackSnapshot, currentPlaybackPath, {
      position,
      duration: Number.isFinite(duration) && duration > 0 ? duration : null,
      lastPlayedAt: Date.now(),
    });
    playbackRevision++;
    dirtyPlaybackPaths.add(currentPlaybackPath);
    diagnostics.increment("playback.updates");
    refreshWatchedPaths();
    const nextState = getPlaybackPresentation(currentPlaybackPath).state;
    if (nextState !== previousState) fileIndexRevision++;
    else refreshCachedPlaybackItem(currentPlaybackPath);
    if (!flush) schedulePlaybackFlush();
  }
  if (flush) flushPlaybackState();
}

function handlePlaybackLoaded(url) {
  if (dirtyPlaybackPaths.size > 0) savePlaybackSnapshot();
  const status = getPlaybackStatus();
  currentPlaybackPath = getLocalPlaybackPath(url || (status && status.url));
  if (!currentPlaybackPath) diagnostics.record("playback", "invalid-path");
}

function resumeCurrentPlayback() {
  const status = getPlaybackStatus();
  if (!status || status.isNetworkResource) return;
  if (!currentPlaybackPath) currentPlaybackPath = getLocalPlaybackPath(status.url);
  if (!currentPlaybackPath) return;
  const record = PlaybackState.normalizeRecord(playbackSnapshot.records[currentPlaybackPath]);
  const livePosition = status.position == null || typeof status.position === "boolean"
    ? 0
    : Number(status.position);
  const liveDuration = status.duration == null || typeof status.duration === "boolean"
    ? null
    : Number(status.duration);
  const resumePosition = PlaybackState.getResumePosition(record, {
    currentPosition: Number.isFinite(livePosition) ? livePosition : 0,
    completionThreshold: completionThreshold(),
  });
  if (
    resumePosition == null
    || PlaybackState.hasMaterialDurationChange(record.duration, liveDuration)
    || !core || typeof core.seekTo !== "function"
  ) return;
  try {
    core.seekTo(resumePosition);
  } catch (err) {
    diagnostics.record("playback", "unavailable");
  }
}

function registerPlaybackHandlers() {
  if (!event || typeof event.on !== "function") return;
  event.on("iina.file-loaded", handlePlaybackLoaded);
  event.on("iina.file-started", resumeCurrentPlayback);
  event.on("mpv.time-pos.changed", () => capturePlaybackSample());
  event.on("mpv.pause.changed", () => capturePlaybackSample({ flush: true }));
  event.on("mpv.end-file", () => capturePlaybackSample({ flush: true }));
  event.on("iina.window-will-close", () => capturePlaybackSample({ flush: true }));
}

function openWindow() {
  try {
    loadState();
    // A newly loaded WebView has no cached index even when the backend revision
    // is unchanged from the previous window instance.
    publishedIndexRevision = null;
    deferHeavyIndexWork = true;
    windowIsOpen = true;
    if (deferredIndexTimer) clearTimeout(deferredIndexTimer);
    deferredIndexTimer = null;

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
    scheduleDeferredIndexPublication(250);
  } catch (err) {
    console.error("[Quick Folders] Failed to open window:", err);
  }
}

loadState();
registerPlaybackHandlers();
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
