// Conservative, filename-based episode recognition and recommendation. The
// parser intentionally declines ambiguous numbers instead of inventing series.
const QuickFoldersSeriesState = (() => {
  function pathParts(path) {
    return typeof path === "string" ? path.split("/").filter(Boolean) : [];
  }

  function parentPath(path) {
    if (typeof path !== "string") return "";
    const slashIndex = path.lastIndexOf("/");
    return slashIndex <= 0 ? "/" : path.substring(0, slashIndex);
  }

  function basename(path) {
    const parts = pathParts(path);
    return parts.length > 0 ? parts[parts.length - 1] : "";
  }

  function withoutExtension(name) {
    const dotIndex = name.lastIndexOf(".");
    return dotIndex > 0 ? name.substring(0, dotIndex) : name;
  }

  function humanize(value) {
    return String(value || "")
      .replace(/[._]+/g, " ")
      .replace(/\s*-\s*/g, " ")
      .replace(/\s+/g, " ")
      .trim();
  }

  function normalizedKey(value) {
    const lowered = String(value || "").toLowerCase();
    const normalized = typeof lowered.normalize === "function"
      ? lowered.normalize("NFD").replace(/[\u0300-\u036f]/g, "")
      : lowered;
    return normalized.replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
  }

  function seasonFromFolder(name) {
    const match = /^(?:season[\s._-]*|s)(\d{1,3})$/i.exec(name || "");
    return match ? Number(match[1]) : null;
  }

  function leadingEpisodeNumber(stem) {
    const labeled = /^(?:episode|ep|e)[\s._-]*(\d{1,3})(?=$|[\s._-])/i.exec(stem);
    if (labeled) return Number(labeled[1]);
    const numeric = /^(\d{1,3})(?=$|[\s._-])/.exec(stem);
    return numeric ? Number(numeric[1]) : null;
  }

  function partNumber(stem) {
    const match = /(?:^|[\s._-])(?:part|pt)[\s._-]*(\d{1,2})(?=$|[\s._-])/i.exec(stem);
    return match ? Number(match[1]) : null;
  }

  function makeSeriesKey(rootPath, seriesPath, title) {
    return `${rootPath || ""}\u0000${seriesPath || ""}\u0000${normalizedKey(title)}`;
  }

  function parseEpisode(item, options = {}) {
    const source = typeof item === "string" ? { path: item } : (item || {});
    const path = source.path;
    if (
      typeof path !== "string"
      || !path.startsWith("/")
      || path.includes("\0")
      || path.split("/").includes("..")
    ) return null;
    const name = typeof source.name === "string" && source.name ? source.name : basename(path);
    const stem = withoutExtension(name);
    const containingPath = parentPath(path);
    const containingName = basename(containingPath);
    const rootPath = options.rootPath || source.rootPath || "";

    const explicitPatterns = [
      /(^|[\s._\-\[])s(\d{1,3})e(\d{1,3})(?:e(\d{1,3}))?(?=$|[\s._\-\]])/i,
      /(^|[\s._\-\[])(\d{1,3})x(\d{1,3})(?=$|[\s._\-\]])/i,
    ];

    let match = explicitPatterns[0].exec(stem);
    let seasonNumber;
    let episodeNumber;
    let endEpisodeNumber = null;
    let markerIndex;
    if (match) {
      seasonNumber = Number(match[2]);
      episodeNumber = Number(match[3]);
      endEpisodeNumber = match[4] == null ? null : Number(match[4]);
      markerIndex = match.index;
    } else {
      match = explicitPatterns[1].exec(stem);
      if (match) {
        seasonNumber = Number(match[2]);
        episodeNumber = Number(match[3]);
        markerIndex = match.index;
      }
    }

    let seriesPath = containingPath;
    let seriesTitle;
    if (match) {
      const filenameTitle = humanize(stem.substring(0, markerIndex));
      const folderSeason = seasonFromFolder(containingName);
      if (folderSeason != null) seriesPath = parentPath(containingPath);
      seriesTitle = filenameTitle || humanize(basename(seriesPath));
    } else {
      const folderSeason = seasonFromFolder(containingName);
      if (folderSeason == null) return null;
      episodeNumber = leadingEpisodeNumber(stem);
      if (episodeNumber == null) return null;
      seasonNumber = folderSeason;
      seriesPath = parentPath(containingPath);
      seriesTitle = humanize(basename(seriesPath));
    }

    if (!seriesTitle || !Number.isInteger(seasonNumber) || !Number.isInteger(episodeNumber)) return null;
    const parsed = {
      seriesKey: makeSeriesKey(rootPath, seriesPath, seriesTitle),
      seriesTitle,
      seriesPath,
      seasonNumber,
      episodeNumber,
    };
    if (endEpisodeNumber != null) parsed.endEpisodeNumber = endEpisodeNumber;
    const episodePart = partNumber(stem);
    if (episodePart != null) parsed.episodePart = episodePart;
    return parsed;
  }

  function compareEpisodes(left, right) {
    const fields = ["seasonNumber", "episodeNumber", "endEpisodeNumber", "episodePart"];
    for (const field of fields) {
      const leftValue = Number.isInteger(left && left[field]) ? left[field] : -1;
      const rightValue = Number.isInteger(right && right[field]) ? right[field] : -1;
      if (leftValue !== rightValue) return leftValue - rightValue;
    }
    return String(left && left.path || "").localeCompare(String(right && right.path || ""));
  }

  function enrichEpisode(item, options = {}) {
    const parsed = parseEpisode(item, options);
    return parsed ? { ...item, ...parsed } : null;
  }

  function groupEpisodes(items, options = {}) {
    const groups = new Map();
    (Array.isArray(items) ? items : []).forEach((item) => {
      const episode = item && item.seriesKey && Number.isInteger(item.seasonNumber)
        && Number.isInteger(item.episodeNumber)
        ? { ...item }
        : enrichEpisode(item, options);
      if (!episode) return;
      if (!groups.has(episode.seriesKey)) groups.set(episode.seriesKey, []);
      groups.get(episode.seriesKey).push(episode);
    });
    groups.forEach((episodes) => episodes.sort(compareEpisodes));
    return groups;
  }

  function defaultPlaybackState(item) {
    if (item && item.playbackState) return item.playbackState;
    if (item && item.state) return item.state;
    return item && item.watched ? "watched" : "new";
  }

  function recommendNextEpisode(episodes, options = {}) {
    const getPlaybackState = typeof options.getPlaybackState === "function"
      ? options.getPlaybackState
      : defaultPlaybackState;
    const ordered = (Array.isArray(episodes) ? episodes : []).slice().sort(compareEpisodes);
    const inProgress = ordered.find((episode) => getPlaybackState(episode) === "in-progress");
    if (inProgress) return inProgress;
    return ordered.find((episode) => getPlaybackState(episode) !== "watched") || null;
  }

  function recommendSeries(items, options = {}) {
    const groups = groupEpisodes(items, options);
    return Array.from(groups.entries())
      .map(([seriesKey, episodes]) => ({
        seriesKey,
        seriesTitle: episodes[0].seriesTitle,
        nextEpisode: recommendNextEpisode(episodes, options),
        episodeCount: episodes.length,
      }))
      .filter((recommendation) => Boolean(recommendation.nextEpisode))
      .sort((left, right) => left.seriesTitle.localeCompare(right.seriesTitle)
        || left.seriesKey.localeCompare(right.seriesKey));
  }

  return {
    compareEpisodes,
    enrichEpisode,
    groupEpisodes,
    parseEpisode,
    recommendNextEpisode,
    recommendSeries,
    seasonFromFolder,
  };
})();

if (typeof module !== "undefined") {
  module.exports = QuickFoldersSeriesState;
}
