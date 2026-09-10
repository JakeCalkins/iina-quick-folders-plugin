const QueueState = require("./queue-state.js");

// The global entry owns only cross-player queue startup. Browsing and playback
// logic stay in main.js, inside the player instance that can use IINA's APIs.
const { global: globalApi } = iina;
const QUEUE_PLAYER_LABEL = "quick-folders-queue";
const pendingQueues = new Map();

function sendFailure(player, reason) {
  if (player === undefined || player === null) return;
  globalApi.postMessage(player, "quick-folders-queue-result", {
    action: "played",
    succeeded: [],
    failed: [{ reason }],
  });
}

globalApi.onMessage("quick-folders-play-queue", (data, requestingPlayer) => {
  const paths = QueueState.normalizePaths(data && data.paths);
  if (paths.length === 0) {
    sendFailure(requestingPlayer, "Queue is empty");
    return;
  }

  try {
    const player = globalApi.createPlayerInstance({
      url: paths[0],
      label: QUEUE_PLAYER_LABEL,
      // IINA still loads the owning plugin when false, preserving this queue
      // bridge while isolating the managed player from unrelated plugins.
      enablePlugins: false,
    });
    pendingQueues.set(String(player), { paths, requestingPlayer });
  } catch (err) {
    sendFailure(requestingPlayer, err && err.message ? err.message : "Unable to start queue");
  }
});

globalApi.onMessage("quick-folders-queue-player-ready", (_data, player) => {
  const pending = pendingQueues.get(String(player));
  if (!pending) return;
  globalApi.postMessage(player, "quick-folders-queue-items", { paths: pending.paths });
});

globalApi.onMessage("quick-folders-queue-player-result", (result, player) => {
  const pending = pendingQueues.get(String(player));
  if (!pending) return;
  pendingQueues.delete(String(player));
  if (pending.requestingPlayer === undefined || pending.requestingPlayer === null) return;
  globalApi.postMessage(pending.requestingPlayer, "quick-folders-queue-result", result);
});
