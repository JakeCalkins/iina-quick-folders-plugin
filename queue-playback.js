// Creates an ordered native IINA playlist from validated media paths. Kept
// separate from main.js so playlist serialization and async handoff stay
// testable without an IINA runtime.
const QuickFoldersQueuePlayback = (() => {
  const PLAYLIST_PREFIX = "@tmp/quick-folders-queue";

  function fileUrlForPath(path) {
    // M3U is line-oriented, so encode every segment. Spaces, Unicode, #, ?,
    // and even embedded newlines then remain unambiguous.
    return `file://${path.split("/").map((segment) => encodeURIComponent(segment)).join("/")}`;
  }

  function create(options) {
    const { core, file, playlist, utils } = options;
    const now = options.now || Date.now;
    const wait = options.wait || ((milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds)));

    function writePlaylist(paths) {
      if (!utils || typeof utils.resolvePath !== "function") {
        throw new Error("This IINA version cannot create a native queue playlist");
      }
      // IINA remembers positions for recently opened playlists. A unique name
      // ensures every Watch Queue action begins with its first entry.
      const playlistFile = `${PLAYLIST_PREFIX}-${now()}.m3u8`;
      file.write(playlistFile, ["#EXTM3U", ...paths.map(fileUrlForPath), ""].join("\n"));
      const resolvedPath = utils.resolvePath(playlistFile);
      if (typeof resolvedPath !== "string" || !resolvedPath) {
        throw new Error("IINA could not resolve the queue playlist path");
      }
      return resolvedPath;
    }

    function playlistMatches(paths) {
      if (!playlist || typeof playlist.list !== "function") return false;
      const items = playlist.list();
      if (!Array.isArray(items) || items.length !== paths.length) return false;
      return items.every((item, index) => item && item.filename === paths[index]);
    }

    async function start(paths) {
      core.open(writePlaylist(paths));
      if (!playlist || typeof playlist.play !== "function") return;

      // Playlist loading is asynchronous. Wait for the exact list before
      // selecting index zero so an already-playing later item cannot win.
      for (let attempt = 0; attempt < 20; attempt++) {
        if (playlistMatches(paths)) {
          playlist.play(0);
          return;
        }
        await wait(50);
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
