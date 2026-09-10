const { console, core, file, utils, menu, standaloneWindow, preferences } = iina;


const STATE_FILE = "@data/quick-folders-state.json";
const DEBUG_LOG_FILE = "@data/quick-folders-debug.log";
const DEFAULT_MAX_INDEX_DEPTH = 3;
const THUMBNAIL_SIZE = 128;
const MAX_THUMBNAILS_IN_MEMORY = 200;
const MAX_CONCURRENT_THUMBNAILS = 2;
const THUMBNAIL_TOOL = "/usr/bin/qlmanage";
const THUMBNAIL_CACHE_DIR = `@tmp/quick-folders-thumbnails/${Date.now()}`;

// File type patterns (mirrored in constants.js for UI)
const videoExtensions = /\.(mp4|mkv|avi|mov|flv|wmv|webm|m4v|3gp|ts|mts|m2ts|mxf)$/i;
const audioExtensions = /\.(mp3|aac|flac|ogg|wav|wma|aiff|opus|m4a)$/i;
const imageExtensions = /\.(jpg|jpeg|png|gif|bmp|webp|svg|tiff|ico)$/i;

const thumbnailCache = new Map();
const pendingThumbnails = new Set();
const thumbnailQueue = [];
let activeThumbnailJobs = 0;
let thumbnailJobSequence = 0;

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
  if (path.includes("/../") || path.includes("\0")) return false;
  return folderRoots.some((root) => {
    const rootPath = root.path === "/" ? "/" : root.path.replace(/\/+$/, "");
    return rootPath === "/" ? path.startsWith("/") : path === rootPath || path.startsWith(rootPath + "/");
  });
}

function rememberThumbnail(path, dataUrl) {
  if (thumbnailCache.size >= MAX_THUMBNAILS_IN_MEMORY) {
    const oldestPath = thumbnailCache.keys().next().value;
    thumbnailCache.delete(oldestPath);
  }
  thumbnailCache.set(path, dataUrl);
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

function processThumbnailQueue() {
  while (activeThumbnailJobs < MAX_CONCURRENT_THUMBNAILS && thumbnailQueue.length > 0) {
    const path = thumbnailQueue.shift();
    activeThumbnailJobs++;

    generateThumbnail(path)
      .then((dataUrl) => {
        rememberThumbnail(path, dataUrl);
        postThumbnail(path, dataUrl);
      })
      .catch(() => {
        rememberThumbnail(path, null);
        postThumbnail(path, null);
      })
      .then(() => {
        pendingThumbnails.delete(path);
        activeThumbnailJobs--;
        processThumbnailQueue();
      });
  }
}

function requestThumbnail(path) {
  if (typeof path !== "string" || !isPathInFolderRoots(path)) return;
  const filename = path.split("/").pop() || "";
  if (!isPlayableFile(filename) || !file.exists(path)) return;

  if (thumbnailCache.has(path)) {
    postThumbnail(path, thumbnailCache.get(path));
    return;
  }
  if (pendingThumbnails.has(path)) return;

  pendingThumbnails.add(path);
  thumbnailQueue.push(path);
  processThumbnailQueue();
}

// Skip directories (mirrored in constants.js)
const SKIP_DIRECTORIES = new Set([
  '.app', '.bundle', '.framework', '.plugin', '.component',
  'node_modules', '__pycache__', '.venv', 'venv',
  '.git', '.svn', '.hg', '.idea', '.vscode',
  'build', 'dist', 'out', 'bin', 'target',
  '.logicx', '.band', '.serato', '.xcodeproj', '.xcworkspace',
  'Caches', '.cache', 'vendor', '.gem', 'Databases', 'Tags', '.Trash', 'Library', '.Spotlight-V100',
]);

// Skip extensions (mirrored in constants.js)
const SKIP_EXTENSIONS = new Set([
  'ds_store', 'localized', 'plist', 'json', 'xml', 'yaml', 'yml', 'ini', 'cfg', 'conf',
  'txt', 'md', 'pdf', 'doc', 'docx', 'rtf', 'pages',
  'js', 'ts', 'py', 'java', 'c', 'cpp', 'h', 'hpp', 'swift', 'sh', 'bash',
  'zip', 'rar', '7z', 'tar', 'gz', 'bz2', 'xz',
  'db', 'sqlite', 'sql', 'cache', 'tmp', 'temp',
  'tagset', 'tagpool', 'asd', 'als', 'logic', 'ptx', 'sessiondata',
  'log', 'bak', 'old', 'swp', 'swo',
]);

function shouldShowFile(filename) {
  if (!filename || filename.startsWith(".")) return false;
  if (!filename.includes(".")) return false;

  const ext = filename.split(".").pop().toLowerCase();
  if (!ext || ext === filename) return false;
  if (SKIP_EXTENSIONS.has(ext)) return false;

  const filterImages = preferences.get("filterImages") ?? true;
  const filterAudio = preferences.get("filterAudio") ?? true;
  const videoOnly = preferences.get("videoOnly") ?? false;

  const isVideo = videoExtensions.test(filename);
  const isAudio = audioExtensions.test(filename);
  const isImage = imageExtensions.test(filename);

  if (videoOnly) return isVideo;
  if (filterImages && isImage) return false;
  if (filterAudio && isAudio) return false;

  return isVideo || isAudio || isImage;
}

function isPlayableFile(filename) {
  if (!filename || filename.startsWith(".")) return false;
  if (!filename.includes(".")) return false;

  const ext = filename.split(".").pop().toLowerCase();
  if (!ext || ext === filename) return false;
  if (SKIP_EXTENSIONS.has(ext)) return false;

  return videoExtensions.test(filename) || audioExtensions.test(filename) || imageExtensions.test(filename);
}

function logDebug(message, data = null) {
  try {
    const timestamp = new Date().toISOString();
    const payload = data ? ` ${JSON.stringify(data)}` : "";
    const line = `${timestamp} ${message}${payload}\n`;
    const existing = file.exists(DEBUG_LOG_FILE) ? (file.read(DEBUG_LOG_FILE) || "") : "";
    file.write(DEBUG_LOG_FILE, existing + line);
  } catch (err) {
    // Ignore logging errors
  }
}

const folderScanCache = new Map();
const folderScanPromises = new Map();

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
      updateWindow();
      return hasPlayable;
    })
    .catch(() => {
      folderScanCache.set(folderPath, { status: "done", hasPlayable: false });
      folderScanPromises.delete(folderPath);
      logDebug("scan-error", { folderPath });
      updateWindow();
    });

  folderScanPromises.set(folderPath, promise);
}

let folderRoots = [];
let currentPath = null;
let history = [];

let fileIndex = { extensions: new Set(), files: [] };
let fileIndexRevision = 0;
let isIndexing = false;
let indexProgress = { filesProcessed: 0, totalEstimate: 0 };

async function buildFileIndex() {
  isIndexing = true;
  indexProgress = { filesProcessed: 0, totalEstimate: 0 };
  
  // Send message to UI that indexing is starting
  if (standaloneWindow) {
    standaloneWindow.postMessage("index-building", { progress: indexProgress });
  }
  
  fileIndex = { extensions: new Set(), files: [] };

  for (const root of folderRoots) {
    await indexFolderRecursive(root.path);
  }

  saveState();
  fileIndexRevision++;
  
  isIndexing = false;
  
  // Send message to UI that indexing is complete
  if (standaloneWindow) {
    standaloneWindow.postMessage("index-complete", { progress: indexProgress });
  }
}

async function indexFolderRecursive(folderPath, depth = 0) {
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
          const maxDepth = preferences.get("maxIndexDepth") ?? DEFAULT_MAX_INDEX_DEPTH;
          if (depth < maxDepth) subdirs.push(fullPath);
        }
      } else {
        const ext = itemName.split(".").pop().toLowerCase();
        if (ext && ext !== itemName) {
          if (SKIP_EXTENSIONS.has(ext)) continue;
          const fileType = getFileTypeByExt(ext);
          if (fileType === "other") continue;
          const shouldShow = shouldShowFile(itemName);
          fileIndex.extensions.add(ext);
          if (shouldShow) {
            fileIndex.files.push({
              name: itemName,
              path: fullPath,
              type: fileType,
              ext: ext,
            });
          }
        }
        indexProgress.filesProcessed++;
      }

      if ((i + 1) % BATCH_SIZE === 0) {
        await new Promise(resolve => setTimeout(resolve, 0));
        if (standaloneWindow && isIndexing && indexProgress.filesProcessed % 1000 === 0) {
          standaloneWindow.postMessage("index-progress", { progress: indexProgress });
        }
      }
    }
    
    await new Promise(resolve => setTimeout(resolve, 0));
    if (standaloneWindow && isIndexing && indexProgress.filesProcessed % 100 === 0) {
      standaloneWindow.postMessage("index-progress", { progress: indexProgress });
    }
    for (const subdir of subdirs) {
      await indexFolderRecursive(subdir, depth + 1);
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
      version: 1,
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

function folderHasPlayableContent(folderPath) {
  try {
    const listing = file.list(folderPath, { includeSubDir: false }) || [];

    for (const item of listing) {
      const itemName = item.filename || item.name;
      const isDir = item.isDir || item.is_dir;
      if (!itemName) continue;
      if (itemName.startsWith(".")) continue;

      if (isDir) {
        if (SKIP_DIRECTORIES.has(itemName)) continue;
        const fullPath = item.path || (folderPath.endsWith("/") ? folderPath + itemName : folderPath + "/" + itemName);
        if (folderHasPlayableContent(fullPath)) {
          return true;
        }
      } else {
        if (isPlayableFile(itemName)) {
          return true;
        }
      }
    }

    return false;
  } catch (err) {
    return false;
  }
}

function listFolder(path) {
  try {
    const listing = file.list(path, { includeSubDir: false }) || [];
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

        return shouldShowFile(itemName);
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

function getCurrentItems() {
  logDebug("get-current-items", { currentPath });
  if (!currentPath) {
    // At root: show folder roots
    return folderRoots.map((f) => ({
      path: f.path,
      name: f.name,
      isDir: true,
      isRoot: true,
    }));
  }

  // Inside a folder: show contents
  return listFolder(currentPath);
}

function updateWindow() {
  logDebug("update-window", { currentPath, roots: folderRoots.length });
  const items = getCurrentItems();
  logDebug("update-window-items", { count: items.length, items: items.map(i => ({ name: i.name, isDir: i.isDir, scanning: i.scanning })) });
  
  // Get current preferences
  const filterImages = preferences.get("filterImages") ?? true;
  const filterAudio = preferences.get("filterAudio") ?? true;
  const videoOnly = preferences.get("videoOnly") ?? false;
  
  // Determine if index is ready (has extensions or no folders to index)
  const indexReady = fileIndex.extensions.size > 0 || folderRoots.length === 0;
  
  // Calculate folder depth (number of levels deep from root folder)
  let folderDepth = 0;
  if (currentPath) {
    // Find the matching root folder
    const rootFolder = folderRoots.find(root => currentPath.startsWith(root.path));
    if (rootFolder) {
      // Count path segments after the root
      const relativePath = currentPath.substring(rootFolder.path.length);
      folderDepth = relativePath.split("/").filter(Boolean).length;
    }
  }
  
  // Use two-argument form: postMessage(type, data)
  standaloneWindow.postMessage("update-items", {
    items: items,
    currentPath: currentPath,
    atRoot: !currentPath,
    availableExtensions: Array.from(fileIndex.extensions).sort(),
    indexedFiles: fileIndex.files,
    indexRevision: fileIndexRevision,
    indexReady: indexReady,
    isIndexing: isIndexing,
    folderDepth: folderDepth,
    preferences: {
      filterImages: filterImages,
      filterAudio: filterAudio,
      videoOnly: videoOnly,
      maxIndexDepth: preferences.get("maxIndexDepth") ?? DEFAULT_MAX_INDEX_DEPTH,
    },
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
    
    buildFileIndex().then(() => {
      updateWindow();
    }).catch(err => {
      // Ignore index errors
    });
  } catch (err) {
    // Ignore errors
  }
}

function openWindow() {
  try {
    loadState();

    try {
      const header = `=== Quick Folders Debug Log - Session started at ${new Date().toISOString()} ===\n`;
      file.write(DEBUG_LOG_FILE, header);
      logDebug("plugin-initializing");
    } catch (e) {
      // Ignore log init errors
    }
    
    standaloneWindow.setProperty({ 
      title: "Quick Folders",
      vibrancy: "dark",
      titlebarStyle: "hidden"
    });

    standaloneWindow.setFrame(500, 600);
    standaloneWindow.loadFile("ui/index.html");
    
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

    standaloneWindow.onMessage("open-item", ({ path, isDir }) => {
      if (isDir) {
        history.push(currentPath);
        currentPath = path;
        updateWindow();
      } else {
        try {
          core.open(path);
        } catch (err) {
          // Ignore errors
        }
      }
    });

    standaloneWindow.onMessage("go-back", () => {
      if (history.length > 0) {
        currentPath = history.pop() || null;
      } else {
        currentPath = null;
      }
      updateWindow();
    });

    // Listen for request-state from UI (happens when UI loads)
    standaloneWindow.onMessage("request-state", () => {
      updateWindow();
    });

    standaloneWindow.onMessage("request-thumbnail", (data) => {
      requestThumbnail(data && data.path);
    });

    // Listen for navigate-to request (from breadcrumb clicks)
    standaloneWindow.onMessage("navigate-to", ({ path }) => {
      history = [];
      currentPath = path;
      updateWindow();
    });

    // Listen for remove-root request
    standaloneWindow.onMessage("remove-root", async ({ path }) => {
      folderRoots = folderRoots.filter((f) => f.path !== path);
      if (currentPath && currentPath.startsWith(path)) {
        currentPath = null;
        history = [];
      }
      
      await buildFileIndex();
      updateWindow();
    });

    // Listen for add-folder request from UI
    standaloneWindow.onMessage("add-folder", async () => {
      await addFolder();
    });

    // Listen for refresh-index request from UI
    standaloneWindow.onMessage("refresh-index", async () => {
      await buildFileIndex();
      updateWindow();
    });

    standaloneWindow.open();
    updateWindow();
  } catch (err) {
    // Ignore errors
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
  // Ignore menu registration errors
}
