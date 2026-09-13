// Privacy-safe, in-memory diagnostics. The API accepts only enumerated labels
// and numeric metrics so paths, filenames, and raw error messages cannot leak.
const QuickFoldersDiagnostics = (() => {
  const DEFAULT_MAX_EVENTS = 50;
  const CATEGORIES = new Set([
    "cache", "index", "metadata", "playback", "queue", "runtime", "state", "thumbnail",
  ]);
  const CODES = new Set([
    "cancelled", "completed", "decode-failed", "invalid-path", "invalid-state", "marker-conflict", "read-failed",
    "scan-failed", "timeout", "tool-failed", "tool-unavailable", "unavailable",
    "unknown", "write-failed",
  ]);
  const COUNTERS = new Set([
    "cache.hits", "cache.misses", "index.files-added", "index.files-removed",
    "index.scans", "index.scan-failures", "metadata.completed", "metadata.failures",
    "playback.flushes", "playback.updates", "queue.failures", "thumbnail.completed",
    "thumbnail.failures",
  ]);
  const GAUGES = new Set([
    "index.file-count", "index.root-count", "metadata.active", "metadata.cache-size",
    "metadata.queued", "playback.record-count", "queue.depth", "thumbnail.active",
    "thumbnail.cache-size", "thumbnail.queued",
  ]);
  const ROOT_STATUSES = new Set(["ready", "reconciling", "stale", "unavailable"]);

  function finiteNonNegative(value) {
    if (value === null || value === "" || typeof value === "boolean") return null;
    const number = Number(value);
    return Number.isFinite(number) && number >= 0 ? number : null;
  }

  function boundedInteger(value, fallback, minimum, maximum) {
    const number = Number(value);
    if (!Number.isInteger(number)) return fallback;
    return Math.min(maximum, Math.max(minimum, number));
  }

  function allowed(value, choices, fallback = "unknown") {
    return choices.has(value) ? value : fallback;
  }

  function numericMetrics(metrics) {
    const source = metrics && typeof metrics === "object" ? metrics : {};
    const normalized = {};
    ["count", "durationMs", "files", "directories"].forEach((key) => {
      const value = finiteNonNegative(source[key]);
      if (value != null) normalized[key] = Math.round(value);
    });
    return normalized;
  }

  function create(options = {}) {
    const maxEvents = boundedInteger(options.maxEvents, DEFAULT_MAX_EVENTS, 0, 500);
    const now = typeof options.now === "function" ? options.now : Date.now;
    const events = [];
    const counters = new Map();
    const gauges = new Map();
    const roots = new Map();

    function record(category, code, metrics) {
      if (maxEvents === 0) return;
      const event = {
        timestamp: finiteNonNegative(now()),
        category: allowed(category, CATEGORIES, "runtime"),
        code: allowed(code, CODES),
        ...numericMetrics(metrics),
      };
      events.push(event);
      if (events.length > maxEvents) events.splice(0, events.length - maxEvents);
    }

    function increment(name, amount = 1) {
      if (!COUNTERS.has(name)) return false;
      const value = finiteNonNegative(amount);
      if (value == null) return false;
      counters.set(name, (counters.get(name) || 0) + value);
      return true;
    }

    function setGauge(name, value) {
      if (!GAUGES.has(name)) return false;
      const normalized = finiteNonNegative(value);
      if (normalized == null) return false;
      gauges.set(name, normalized);
      return true;
    }

    function setRootStatus(rootOrdinal, status, metrics) {
      const ordinal = boundedInteger(rootOrdinal, null, 1, 10000);
      if (ordinal == null) return false;
      roots.set(ordinal, {
        id: `root-${ordinal}`,
        status: allowed(status, ROOT_STATUSES, "stale"),
        ...numericMetrics(metrics),
      });
      return true;
    }

    function removeRootStatus(rootOrdinal) {
      const ordinal = boundedInteger(rootOrdinal, null, 1, 10000);
      return ordinal == null ? false : roots.delete(ordinal);
    }

    function reset() {
      events.length = 0;
      counters.clear();
      gauges.clear();
      roots.clear();
    }

    function getSnapshot() {
      return {
        generatedAt: finiteNonNegative(now()),
        events: events.map((event) => ({ ...event })),
        counters: Object.fromEntries(Array.from(counters.entries()).sort()),
        gauges: Object.fromEntries(Array.from(gauges.entries()).sort()),
        roots: Array.from(roots.values())
          .map((root) => ({ ...root }))
          .sort((left, right) => left.id.localeCompare(right.id)),
      };
    }

    return {
      getSnapshot,
      increment,
      record,
      removeRootStatus,
      reset,
      setGauge,
      setRootStatus,
    };
  }

  return {
    DEFAULT_MAX_EVENTS,
    create,
  };
})();

if (typeof module !== "undefined") {
  module.exports = QuickFoldersDiagnostics;
}
