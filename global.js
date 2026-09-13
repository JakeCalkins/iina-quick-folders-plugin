const BrowseState = require("./browse-state.js");
const FileTypes = require("./file-types.js");
const PathSecurity = require("./path-security.js");
const QueueState = require("./queue-state.js");
const SharedStateLock = require("./shared-state-lock.js");

// The global entry owns only cross-player queue startup. Browsing and playback
// logic stay in main.js, inside the player instance that can use IINA's APIs.
const { file, global: globalApi, utils } = iina;
const QUEUE_PLAYER_LABEL = "quick-folders-queue";
const STATE_FILE = "@data/quick-folders-state.json";
const MAX_PENDING_QUEUE_LAUNCHES = 16;
const QUEUE_LAUNCH_TIMEOUT_MS = 30_000;
const pendingQueues = new Map();
const pendingLaunchesByRequester = new Map();
let launchSequence = 0;

// Plugin data is shared by all IINA player runtimes. Serialize their
// read-merge-write sections here so one window cannot overwrite another.
SharedStateLock.createCoordinator(globalApi);

function sendFailure(player, reason) {
  if (player === undefined || player === null) return;
  globalApi.postMessage(player, "quick-folders-queue-result", {
    action: "played",
    succeeded: [],
    failed: [{ reason }],
  });
}

function getPersistedFolderRoots() {
  try {
    if (!file || !file.exists(STATE_FILE)) return [];
    const state = JSON.parse(file.read(STATE_FILE) || "null");
    if (!state || !Array.isArray(state.folderRoots)) return [];
    return state.folderRoots.filter((root) => (
      root && typeof root.path === "string" && BrowseState.isPathWithinRoots(root.path, [root])
    )).map((root) => ({ path: root.path === "/" ? "/" : root.path.replace(/\/+$/, "") }));
  } catch (err) {
    return [];
  }
}

function isRealPlayableFile(path) {
  if (typeof path !== "string") return false;
  const slashIndex = path.lastIndexOf("/");
  if (slashIndex < 0) return false;
  const parentPath = slashIndex === 0 ? "/" : path.substring(0, slashIndex);
  const filename = path.substring(slashIndex + 1);
  if (!FileTypes.isPlayableFile(filename)) return false;
  try {
    if (!file.exists(path)) return false;
    const listing = file.list(parentPath, { includeSubDir: false });
    return Array.isArray(listing) && listing.some((entry) => (
      entry
      && (entry.filename || entry.name) === filename
      && entry.isDir !== true
      && entry.is_dir !== true
    ));
  } catch (err) {
    return false;
  }
}

async function isAuthorizedLaunchPath(path) {
  const roots = getPersistedFolderRoots();
  if (!await PathSecurity.isPathWithinRootsWithoutSymlinks(path, roots, utils)) return false;
  // Re-read shared state after the asynchronous lstat-equivalent check. The
  // remaining checks and createPlayerInstance call are synchronous, narrowing
  // the boundary in which a removed root or replaced file could be reused.
  if (!BrowseState.isPathWithinRoots(path, getPersistedFolderRoots())) return false;
  return isRealPlayableFile(path);
}

function cancelPendingLaunch(pending) {
  if (!pending) return null;
  const requesterKey = String(pending.requestingPlayer);
  if (pendingLaunchesByRequester.get(requesterKey) === pending) {
    pendingLaunchesByRequester.delete(requesterKey);
  }
  if (pending.playerKey && pendingQueues.get(pending.playerKey) === pending) {
    pendingQueues.delete(pending.playerKey);
  }
  if (pending.timer) clearTimeout(pending.timer);
  return pending;
}

function reservePendingLaunch(paths, requestingPlayer) {
  const requesterKey = String(requestingPlayer);
  cancelPendingLaunch(pendingLaunchesByRequester.get(requesterKey));

  while (pendingLaunchesByRequester.size >= MAX_PENDING_QUEUE_LAUNCHES) {
    const evicted = cancelPendingLaunch(pendingLaunchesByRequester.values().next().value);
    if (evicted) sendFailure(evicted.requestingPlayer, "Queue startup was superseded");
  }

  const pending = {
    id: ++launchSequence,
    paths,
    requestingPlayer,
    playerKey: null,
    ready: false,
    timer: null,
  };
  pending.timer = setTimeout(() => {
    if (pendingLaunchesByRequester.get(requesterKey) !== pending) return;
    cancelPendingLaunch(pending);
    sendFailure(requestingPlayer, "Queue player did not finish starting");
  }, QUEUE_LAUNCH_TIMEOUT_MS);
  pendingLaunchesByRequester.set(requesterKey, pending);
  return pending;
}

function attachPendingPlayer(pending, player) {
  const playerKey = String(player);
  cancelPendingLaunch(pendingQueues.get(playerKey));
  pending.playerKey = playerKey;
  pendingQueues.set(playerKey, pending);
}

globalApi.onMessage("quick-folders-play-queue", async (data, requestingPlayer) => {
  const paths = QueueState.normalizePaths(data && data.paths);
  if (paths.length === 0) {
    sendFailure(requestingPlayer, "Queue is empty");
    return;
  }

  const pending = reservePendingLaunch(paths, requestingPlayer);
  try {
    if (!await isAuthorizedLaunchPath(paths[0])) {
      if (pendingLaunchesByRequester.get(String(requestingPlayer)) !== pending) return;
      cancelPendingLaunch(pending);
      sendFailure(requestingPlayer, "Queue item is unavailable or outside Quick Folders");
      return;
    }
    if (pendingLaunchesByRequester.get(String(requestingPlayer)) !== pending) return;
    const player = globalApi.createPlayerInstance({
      url: paths[0],
      label: QUEUE_PLAYER_LABEL,
      // IINA still loads the owning plugin when false, preserving this queue
      // bridge while isolating the managed player from unrelated plugins.
      enablePlugins: false,
    });
    attachPendingPlayer(pending, player);
  } catch (err) {
    if (pendingLaunchesByRequester.get(String(requestingPlayer)) !== pending) return;
    cancelPendingLaunch(pending);
    sendFailure(requestingPlayer, err && err.message ? err.message : "Unable to start queue");
  }
});

globalApi.onMessage("quick-folders-queue-player-ready", (_data, player) => {
  const pending = pendingQueues.get(String(player));
  if (!pending || pending.ready) return;
  pending.ready = true;
  globalApi.postMessage(player, "quick-folders-queue-items", { paths: pending.paths });
});

globalApi.onMessage("quick-folders-queue-player-result", (result, player) => {
  const pending = cancelPendingLaunch(pendingQueues.get(String(player)));
  if (!pending) return;
  if (pending.requestingPlayer === undefined || pending.requestingPlayer === null) return;
  globalApi.postMessage(pending.requestingPlayer, "quick-folders-queue-result", result);
});
