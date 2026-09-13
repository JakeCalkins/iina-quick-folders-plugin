// Creates an ordered native IINA playlist from validated media paths. Kept
// separate from main.js so the asynchronous native handoff stays testable
// without an IINA runtime.
const QuickFoldersQueuePlayback = (() => {
  const REQUIRED_INPUT_STABLE_SAMPLES = 20;
  const REQUIRED_STABLE_SAMPLES = 30;
  const MAX_ATTEMPTS = 180;
  function fileUrlForPath(path) {
    // IINA's playlist API accepts URLs. Encoding every segment preserves spaces,
    // Unicode, URL punctuation, and even embedded newlines in local filenames.
    return `file://${path.split("/").map((segment) => encodeURIComponent(segment)).join("/")}`;
  }

  function create(options) {
    const { core, playlist } = options;
    const wait = options.wait || ((milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds)));
    const authorize = typeof options.authorize === "function" ? options.authorize : async () => true;
    const authorizeAll = typeof options.authorizeAll === "function" ? options.authorizeAll : null;

    async function authorizePaths(paths) {
      if (authorizeAll) {
        if (!await authorizeAll(paths)) throw new Error("A queue item is no longer safely accessible");
        return;
      }
      for (const path of paths) {
        if (!await authorize(path)) throw new Error("A queue item is no longer safely accessible");
      }
    }

    function playlistMatches(items, paths) {
      if (!Array.isArray(items) || items.length !== paths.length) return false;
      return items.every((item, index) => item && item.filename === paths[index]);
    }

    async function rebuildQueueFromFirstItem(items, firstIndex, paths) {
      await authorizePaths(paths);
      const needsRemoval = items.length > 1;
      if (needsRemoval && typeof playlist.remove !== "function") {
        throw new Error("This IINA version cannot isolate the queue playlist");
      }
      if (paths.length > 1 && typeof playlist.add !== "function") {
        throw new Error("This IINA version cannot build the queue playlist");
      }
      for (let index = items.length - 1; index >= 0; index--) {
        if (index !== firstIndex) playlist.remove(index);
      }
      // Omitting `at` is IINA's supported append operation; passing the current
      // count is rejected even though it looks like a conventional insert index.
      paths.slice(1).forEach((path) => playlist.add(fileUrlForPath(path)));
    }

    function hasQueueMembership(items, paths) {
      if (!Array.isArray(items) || items.length !== paths.length) return false;
      const remaining = new Set(items.map((item) => item && item.filename));
      return paths.every((path) => remaining.delete(path)) && remaining.size === 0;
    }

    function reorderQueueItems(items, paths) {
      if (typeof playlist.move !== "function") {
        throw new Error("This IINA version cannot order the queue playlist");
      }
      const currentOrder = items.map((item) => item && item.filename);
      paths.forEach((path, targetIndex) => {
        const currentIndex = currentOrder.indexOf(path);
        if (currentIndex === targetIndex) return;
        playlist.move(currentIndex, targetIndex);
        const [moved] = currentOrder.splice(currentIndex, 1);
        currentOrder.splice(targetIndex, 0, moved);
      });
    }

    function playlistSignature(items) {
      if (!Array.isArray(items)) return "";
      return items.map((item) => item && item.filename || "").join("\u0000");
    }

    async function start(paths, { openFirst = true } = {}) {
      if (openFirst) {
        await authorizePaths([paths[0]]);
        core.open(paths[0]);
      }
      if (!playlist || typeof playlist.list !== "function" || typeof playlist.play !== "function") return;

      // IINA's folder matcher updates the playlist asynchronously after a local
      // file opens. Let each native state settle before reconciling it so we do
      // not fight that process, restart playback, or briefly expose neighbors.
      let previousSignature = null;
      let inputStableSamples = 0;
      let stableSamples = 0;
      for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
        await wait(50);
        const items = playlist.list();
        const firstIndex = Array.isArray(items)
          ? items.findIndex((item) => item && item.filename === paths[0])
          : -1;
        if (firstIndex === -1) {
          previousSignature = null;
          inputStableSamples = 0;
          stableSamples = 0;
          continue;
        }

        if (playlistMatches(items, paths)) {
          stableSamples++;
          if (stableSamples < REQUIRED_STABLE_SAMPLES) continue;
          await authorizePaths(paths);
          playlist.play(0);
          return;
        }

        stableSamples = 0;
        const signature = playlistSignature(items);
        inputStableSamples = signature === previousSignature ? inputStableSamples + 1 : 1;
        previousSignature = signature;
        if (inputStableSamples < REQUIRED_INPUT_STABLE_SAMPLES) continue;

        // Some IINA versions insert an item before the current entry even when
        // add() is called without an index. Verify the native result and use
        // move() to enforce queue order instead of trusting insertion position.
        if (hasQueueMembership(items, paths)) {
          await authorizePaths(paths);
          reorderQueueItems(items, paths);
        } else {
          await rebuildQueueFromFirstItem(items, firstIndex, paths);
        }
        // The retained first item becomes index zero after backwards removal.
        // Reassert it immediately in case the native player changed position.
        playlist.play(0);
        previousSignature = null;
        inputStableSamples = 0;
      }
      throw new Error("IINA did not finish loading the queue playlist");
    }

    return { start };
  }

  return { create, fileUrlForPath };
})();

if (typeof module !== "undefined") {
  module.exports = QuickFoldersQueuePlayback;
}
