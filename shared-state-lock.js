// Cross-player serialization for the plugin-data files shared by every IINA
// player instance. The global entry coordinates leases; each main entry keeps
// its own writes ordered while it waits for the shared lease.
const QuickFoldersSharedStateLock = (() => {
  const REQUEST_MESSAGE = "quick-folders-state-lock-request";
  const GRANTED_MESSAGE = "quick-folders-state-lock-granted";
  const RELEASE_MESSAGE = "quick-folders-state-lock-release";
  const DEFAULT_LEASE_MS = 30_000;
  const DEFAULT_RETRY_MS = 2_000;

  function normalizeRequestId(value) {
    return typeof value === "string" && value.length > 0 && value.length <= 200
      ? value
      : null;
  }

  function createCoordinator(globalApi, options = {}) {
    const leaseMs = Math.max(1_000, Number(options.leaseMs) || DEFAULT_LEASE_MS);
    const scheduleTimeout = options.setTimeout || setTimeout;
    const cancelTimeout = options.clearTimeout || clearTimeout;
    const queue = [];
    let active = null;

    function sameRequest(entry, player, requestId) {
      return entry && String(entry.player) === String(player) && entry.requestId === requestId;
    }

    function scheduleLease(entry) {
      if (entry.timer) cancelTimeout(entry.timer);
      entry.timer = scheduleTimeout(() => {
        if (!sameRequest(active, entry.player, entry.requestId)) return;
        active = null;
        grantNext();
      }, leaseMs);
    }

    function sendGrant(entry) {
      scheduleLease(entry);
      globalApi.postMessage(entry.player, GRANTED_MESSAGE, { requestId: entry.requestId });
    }

    function grantNext() {
      if (active || queue.length === 0) return;
      active = queue.shift();
      sendGrant(active);
    }

    globalApi.onMessage(REQUEST_MESSAGE, (data, player) => {
      const requestId = normalizeRequestId(data && data.requestId);
      if (requestId === null || player === undefined || player === null) return;
      if (sameRequest(active, player, requestId)) {
        sendGrant(active);
        return;
      }
      if (queue.some((entry) => sameRequest(entry, player, requestId))) return;
      queue.push({ player, requestId, timer: null });
      grantNext();
    });

    globalApi.onMessage(RELEASE_MESSAGE, (data, player) => {
      const requestId = normalizeRequestId(data && data.requestId);
      if (!sameRequest(active, player, requestId)) return;
      if (active.timer) cancelTimeout(active.timer);
      active = null;
      grantNext();
    });

    return {
      getState() {
        return {
          active: active ? { player: active.player, requestId: active.requestId } : null,
          queued: queue.map(({ player, requestId }) => ({ player, requestId })),
        };
      },
    };
  }

  function createClient(globalApi, options = {}) {
    const retryMs = Math.max(250, Number(options.retryMs) || DEFAULT_RETRY_MS);
    const scheduleInterval = options.setInterval
      || (typeof setInterval === "function" ? setInterval : () => null);
    const cancelInterval = options.clearInterval
      || (typeof clearInterval === "function" ? clearInterval : () => {});
    const now = options.now || Date.now;
    const random = options.random || Math.random;
    const pending = new Map();
    let sequence = 0;
    let localChain = Promise.resolve();

    const available = Boolean(
      globalApi
      && typeof globalApi.onMessage === "function"
      && typeof globalApi.postMessage === "function"
    );

    if (available) {
      globalApi.onMessage(GRANTED_MESSAGE, (data) => {
        const requestId = normalizeRequestId(data && data.requestId);
        const resolve = requestId && pending.get(requestId);
        if (!resolve) return;
        pending.delete(requestId);
        resolve();
      });
    }

    function createRequestId() {
      sequence++;
      return `${now().toString(36)}-${sequence.toString(36)}-${Math.floor(random() * 0x100000000).toString(36)}`;
    }

    function withLock(callback) {
      const run = async () => {
        if (!available) return callback();
        const requestId = createRequestId();
        const request = () => globalApi.postMessage(REQUEST_MESSAGE, { requestId });
        const granted = new Promise((resolve) => {
          pending.set(requestId, resolve);
        });
        request();
        const acquisitionRetry = scheduleInterval(request, retryMs);
        await granted;
        cancelInterval(acquisitionRetry);
        const renewal = scheduleInterval(request, retryMs);
        try {
          return await callback();
        } finally {
          cancelInterval(renewal);
          globalApi.postMessage(RELEASE_MESSAGE, { requestId });
        }
      };
      const result = localChain.catch(() => {}).then(run);
      localChain = result;
      return result;
    }

    return { available, withLock };
  }

  return {
    DEFAULT_LEASE_MS,
    GRANTED_MESSAGE,
    RELEASE_MESSAGE,
    REQUEST_MESSAGE,
    createClient,
    createCoordinator,
  };
})();

module.exports = QuickFoldersSharedStateLock;
