const { console, core, file, utils, menu, standaloneWindow, preferences } = iina;

const STATE_FILE = "@data/quick-folders-state.json";
const DEFAULT_MAX_INDEX_DEPTH = 3;

// File type patterns (mirrored in constants.js for UI)
const videoExtensions = /\.(mp4|mkv|avi|mov|flv|wmv|webm|m4v|3gp|ts|mts|m2ts|mxf)$/i;
const audioExtensions = /\.(mp3|aac|flac|ogg|wav|wma|aiff|opus|m4a)$/i;
const imageExtensions = /\.(jpg|jpeg|png|gif|bmp|webp|svg|tiff|ico)$/i;

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
  if (!filename.includes(".")) return false;

  const filterImages = preferences.get("filterImages") ?? true;
  const filterAudio = preferences.get("filterAudio") ?? true;
  const videoOnly = preferences.get("videoOnly") ?? false;

  if (videoOnly) return videoExtensions.test(filename);
  if (filterImages && imageExtensions.test(filename)) return false;
  if (filterAudio && audioExtensions.test(filename)) return false;
  return true;
}

let folderRoots = [];
let currentPath = null;
let history = [];

let fileIndex = { extensions: new Set(), files: [] };
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
      if (item.isDir) {
        if (folderHasPlayableContent(item.path || folderPath + "/" + item.filename)) {
          return true;
        }
      } else {
        if (shouldShowFile(item.filename)) {
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
    return listing
      .filter((item) => {
        if (item.isDir) {
          const fullPath = path.endsWith("/") ? path + item.filename : path + "/" + item.filename;
          return folderHasPlayableContent(fullPath);
        }
        return shouldShowFile(item.filename);
      })
      .map((item) => {
        const fullPath = path.endsWith("/") ? path + item.filename : path + "/" + item.filename;
        let fileSize = null;
        if (!item.isDir) {
          try {
            const stats = file.stat(fullPath);
            fileSize = stats && stats.size ? stats.size : null;
          } catch (e) {
            // Ignore stat errors
          }
        }
        return {
          path: fullPath,
          name: item.filename,
          isDir: item.isDir,
          size: fileSize,
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
  const items = getCurrentItems();
  
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
          // Index rebuilt
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
