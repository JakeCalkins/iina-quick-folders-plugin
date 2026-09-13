// Pure playback-state normalization and derivation. IINA event wiring and
// persistence stay in main.js so this module can be exercised in Node tests.
const QuickFoldersPlaybackState = (() => {
  const SCHEMA_VERSION = 1;
  const DEFAULT_COMPLETION_THRESHOLD = 0.9;
  const DEFAULT_AUTOMATIC_RECORD_LIMIT = 5000;
  const DEFAULT_DURATION_TOLERANCE_SECONDS = 30;
  const DEFAULT_DURATION_TOLERANCE_RATIO = 0.1;
  const DEFAULT_RESUME_MIN_POSITION = 5;
  const DEFAULT_NATIVE_RESUME_TOLERANCE = 5;
  const MANUAL_STATES = new Set(["watched", "unwatched"]);

  function isSafeAbsolutePath(path) {
    return typeof path === "string"
      && path.startsWith("/")
      && !path.includes("\0")
      && !path.split("/").includes("..");
  }

  function finiteNonNegative(value) {
    if (value === null || value === "" || typeof value === "boolean") return null;
    const number = Number(value);
    return Number.isFinite(number) && number >= 0 ? number : null;
  }

  function positiveNumber(value) {
    if (value === null || value === "" || typeof value === "boolean") return null;
    const number = Number(value);
    return Number.isFinite(number) && number > 0 ? number : null;
  }

  function normalizeThreshold(value) {
    const number = Number(value);
    return Number.isFinite(number) && number > 0 && number <= 1
      ? number
      : DEFAULT_COMPLETION_THRESHOLD;
  }

  function normalizeRecord(record) {
    const source = record && typeof record === "object" ? record : {};
    const duration = positiveNumber(source.duration);
    const rawPosition = finiteNonNegative(source.position) || 0;
    return {
      position: duration ? Math.min(rawPosition, duration) : rawPosition,
      duration,
      lastPlayedAt: finiteNonNegative(source.lastPlayedAt),
      manualState: MANUAL_STATES.has(source.manualState) ? source.manualState : null,
    };
  }

  function normalizeRecords(records) {
    const normalized = {};
    if (!records || typeof records !== "object" || Array.isArray(records)) return normalized;
    Object.keys(records).forEach((path) => {
      if (isSafeAbsolutePath(path)) normalized[path] = normalizeRecord(records[path]);
    });
    return normalized;
  }

  function normalizeSnapshot(snapshot) {
    const source = snapshot && typeof snapshot === "object" ? snapshot : {};
    return {
      version: SCHEMA_VERSION,
      records: normalizeRecords(source.records),
    };
  }

  function migrateSnapshot(snapshot, options = {}) {
    const migrated = normalizeSnapshot(snapshot);
    const source = snapshot && typeof snapshot === "object" ? snapshot : {};
    const legacyPaths = Array.isArray(options.watchedPaths)
      ? options.watchedPaths
      : (Array.isArray(source.watchedPaths) ? source.watchedPaths : []);
    const migratedAt = finiteNonNegative(options.now);

    legacyPaths.forEach((path) => {
      if (!isSafeAbsolutePath(path)) return;
      const record = normalizeRecord(migrated.records[path]);
      migrated.records[path] = {
        ...record,
        lastPlayedAt: record.lastPlayedAt == null ? migratedAt : record.lastPlayedAt,
        manualState: "watched",
      };
    });
    return migrated;
  }

  function hasMaterialDurationChange(previousDuration, nextDuration, options = {}) {
    const previous = positiveNumber(previousDuration);
    const next = positiveNumber(nextDuration);
    if (!previous || !next) return false;
    const seconds = positiveNumber(options.durationToleranceSeconds)
      || DEFAULT_DURATION_TOLERANCE_SECONDS;
    const ratio = positiveNumber(options.durationToleranceRatio)
      || DEFAULT_DURATION_TOLERANCE_RATIO;
    return Math.abs(previous - next) > Math.max(seconds, previous * ratio);
  }

  function updateRecord(record, sample, options = {}) {
    const previous = normalizeRecord(record);
    const input = sample && typeof sample === "object" ? sample : {};
    const sampledDuration = positiveNumber(input.duration);
    const durationChanged = hasMaterialDurationChange(
      previous.duration,
      sampledDuration,
      options,
    );
    const duration = sampledDuration || previous.duration;
    const sampledPosition = finiteNonNegative(input.position);
    let position = sampledPosition == null
      ? (durationChanged ? 0 : previous.position)
      : sampledPosition;
    if (duration) position = Math.min(position, duration);

    const sampledAt = finiteNonNegative(input.lastPlayedAt);
    return {
      position,
      duration,
      lastPlayedAt: sampledAt == null ? previous.lastPlayedAt : sampledAt,
      manualState: previous.manualState,
    };
  }

  function setManualState(record, manualState) {
    const normalized = normalizeRecord(record);
    return {
      ...normalized,
      manualState: MANUAL_STATES.has(manualState) ? manualState : null,
    };
  }

  function getProgressRatio(record) {
    const normalized = normalizeRecord(record);
    return normalized.duration
      ? Math.min(1, normalized.position / normalized.duration)
      : 0;
  }

  function classifyRecord(record, options = {}) {
    const normalized = normalizeRecord(record);
    if (normalized.manualState === "watched") return "watched";
    if (
      normalized.manualState !== "unwatched"
      && getProgressRatio(normalized) >= normalizeThreshold(options.completionThreshold)
    ) {
      return "watched";
    }
    return normalized.position > 0 ? "in-progress" : "new";
  }

  function getResumePosition(record, options = {}) {
    const normalized = normalizeRecord(record);
    const minimum = positiveNumber(options.minimumPosition) || DEFAULT_RESUME_MIN_POSITION;
    const tolerance = finiteNonNegative(options.currentPositionTolerance);
    const nativeResumeTolerance = tolerance == null ? DEFAULT_NATIVE_RESUME_TOLERANCE : tolerance;
    const currentPosition = finiteNonNegative(options.currentPosition) || 0;
    if (currentPosition > nativeResumeTolerance || normalized.position < minimum) return null;
    if (normalized.duration && normalized.position >= normalized.duration) return null;
    if (
      !normalized.manualState
      && classifyRecord(normalized, { completionThreshold: options.completionThreshold }) === "watched"
    ) return null;
    return normalized.position;
  }

  function updateProgress(snapshot, path, sample, options = {}) {
    const normalized = normalizeSnapshot(snapshot);
    if (!isSafeAbsolutePath(path)) return normalized;
    normalized.records[path] = updateRecord(normalized.records[path], sample, options);
    return normalized;
  }

  function updateManualState(snapshot, paths, manualState) {
    const normalized = normalizeSnapshot(snapshot);
    const seen = new Set();
    (Array.isArray(paths) ? paths : []).forEach((path) => {
      if (!isSafeAbsolutePath(path) || seen.has(path)) return;
      seen.add(path);
      normalized.records[path] = setManualState(normalized.records[path], manualState);
    });
    return normalized;
  }

  function pruneSnapshot(snapshot, options = {}) {
    const normalized = normalizeSnapshot(snapshot);
    const isValidPath = typeof options.isValidPath === "function" ? options.isValidPath : null;
    const limitValue = Number(options.maxAutomaticRecords);
    const automaticLimit = Number.isInteger(limitValue) && limitValue >= 0
      ? limitValue
      : DEFAULT_AUTOMATIC_RECORD_LIMIT;
    const manual = [];
    const automatic = [];

    Object.keys(normalized.records).forEach((path) => {
      if (isValidPath && !isValidPath(path)) return;
      const entry = [path, normalized.records[path]];
      if (entry[1].manualState) manual.push(entry);
      else automatic.push(entry);
    });
    automatic.sort((left, right) => {
      const timeDifference = (right[1].lastPlayedAt || 0) - (left[1].lastPlayedAt || 0);
      return timeDifference || left[0].localeCompare(right[0]);
    });

    const records = {};
    manual.concat(automatic.slice(0, automaticLimit)).forEach(([path, record]) => {
      records[path] = record;
    });
    return { version: SCHEMA_VERSION, records };
  }

  function getContinueWatching(snapshot, options = {}) {
    const normalized = normalizeSnapshot(snapshot);
    const limitValue = Number(options.limit);
    const limit = Number.isInteger(limitValue) && limitValue >= 0 ? limitValue : 100;
    return Object.keys(normalized.records)
      .map((path) => {
        const record = normalized.records[path];
        return {
          path,
          ...record,
          state: classifyRecord(record, options),
          progressRatio: getProgressRatio(record),
        };
      })
      .filter((entry) => entry.state === "in-progress")
      .sort((left, right) => {
        const timeDifference = (right.lastPlayedAt || 0) - (left.lastPlayedAt || 0);
        return timeDifference || left.path.localeCompare(right.path);
      })
      .slice(0, limit);
  }

  function getWatchedPaths(snapshot, options = {}) {
    const normalized = normalizeSnapshot(snapshot);
    return Object.keys(normalized.records).filter(
      (path) => classifyRecord(normalized.records[path], options) === "watched",
    );
  }

  return {
    DEFAULT_AUTOMATIC_RECORD_LIMIT,
    DEFAULT_COMPLETION_THRESHOLD,
    DEFAULT_NATIVE_RESUME_TOLERANCE,
    DEFAULT_RESUME_MIN_POSITION,
    SCHEMA_VERSION,
    classifyRecord,
    getContinueWatching,
    getProgressRatio,
    getResumePosition,
    getWatchedPaths,
    hasMaterialDurationChange,
    isSafeAbsolutePath,
    migrateSnapshot,
    normalizeRecord,
    normalizeSnapshot,
    pruneSnapshot,
    setManualState,
    updateManualState,
    updateProgress,
    updateRecord,
  };
})();

if (typeof module !== "undefined") {
  module.exports = QuickFoldersPlaybackState;
}
