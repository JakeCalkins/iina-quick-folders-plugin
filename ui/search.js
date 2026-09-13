const QuickFoldersSearch = (() => {
  const WORD_SEPARATOR = /[^a-z0-9]+/;
  const STRUCTURED_FIELDS = new Set([
    "added",
    "duration",
    "ext",
    "folder",
    "is",
    "resolution",
  ]);
  const PLAYBACK_STATES = new Set(["new", "progress", "watched", "unwatched"]);
  const RESOLUTION_HEIGHTS = Object.freeze({
    "480p": 480,
    "720p": 720,
    "1080p": 1080,
    "1440p": 1440,
    "2160p": 2160,
    "4k": 2160,
    "4320p": 4320,
    "8k": 4320,
  });

  function normalize(value) {
    const lowered = String(value || "").toLowerCase();
    // Keep search accent-insensitive where the embedded WebKit runtime supports it.
    return typeof lowered.normalize === "function"
      ? lowered.normalize("NFD").replace(/[\u0300-\u036f]/g, "")
      : lowered;
  }

  function getExtension(name, isDir) {
    if (isDir) return "";
    const lastDot = name.lastIndexOf(".");
    return lastDot > 0 && lastDot < name.length - 1
      ? name.substring(lastDot + 1)
      : "";
  }

  function positiveNumber(value) {
    const number = Number(value);
    return Number.isFinite(number) && number > 0 ? number : null;
  }

  function getAddedTime(item) {
    const value = item.addedAt ?? item.firstSeenAt ?? item.addedTime ?? item.createdAt ?? item.creationTime;
    if (Number.isFinite(value)) return Number(value) > 0 ? Number(value) : null;
    if (typeof value !== "string" || value.trim().length === 0) return null;
    const parsed = Date.parse(value);
    return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
  }

  function getPlaybackState(item) {
    const explicit = normalize(item.playbackState || item.state || (item.progress && item.progress.state));
    if (explicit === "in-progress") return "progress";
    if (PLAYBACK_STATES.has(explicit)) return explicit;
    if (item.watched) return "watched";
    if (item.isNew) return "new";
    const progress = item.progress && typeof item.progress === "object"
      ? item.progress.position ?? item.progress.fraction
      : item.progress ?? item.position;
    return positiveNumber(progress) !== null ? "progress" : "new";
  }

  function createRecord(item) {
    const source = item && typeof item === "object" ? item : {};
    const name = normalize(source.name);
    const path = normalize(source.path);
    const lastSlash = path.lastIndexOf("/");
    const metadata = source.metadata && typeof source.metadata === "object"
      ? source.metadata
      : source.mediaMetadata && typeof source.mediaMetadata === "object" ? source.mediaMetadata : {};
    const progress = source.progress && typeof source.progress === "object" ? source.progress : {};
    const playbackState = getPlaybackState(source);
    return {
      item: source,
      name,
      path,
      folder: lastSlash >= 0 ? path.substring(0, lastSlash) : "",
      extension: normalize(source.ext || getExtension(name, source.isDir)),
      words: name.split(WORD_SEPARATOR).filter(Boolean),
      duration: positiveNumber(source.duration ?? metadata.duration ?? progress.duration),
      width: positiveNumber(source.width ?? metadata.width),
      height: positiveNumber(source.height ?? metadata.height),
      addedAt: getAddedTime(source),
      playbackState,
      watched: Boolean(source.watched) || playbackState === "watched",
    };
  }

  function escapeRegex(value) {
    return value.replace(/[|\\{}()[\]^$+\.]/g, "\\$&");
  }

  function makeWildcardRegex(value) {
    const source = escapeRegex(value)
      .replace(/\*/g, ".*")
      .replace(/\?/g, ".");
    return new RegExp(source);
  }

  function readQuoted(query, start) {
    let value = "";
    let index = start + 1;
    while (index < query.length) {
      const character = query[index];
      if (character === "\\" && index + 1 < query.length) {
        value += query[index + 1];
        index += 2;
      } else if (character === '"') {
        return { value, nextIndex: index + 1, closed: true };
      } else {
        value += character;
        index++;
      }
    }
    return { value, nextIndex: index, closed: false };
  }

  function readValue(query, start) {
    if (query[start] === '"') {
      const quoted = readQuoted(query, start);
      return { ...quoted, literal: true };
    }
    let index = start;
    while (index < query.length && !/\s/.test(query[index])) index++;
    return {
      value: query.substring(start, index),
      nextIndex: index,
      literal: false,
      closed: true,
    };
  }

  function parseComparatorValue(value) {
    const match = String(value || "").match(/^(<=|>=|<|>|=)?(.+)$/);
    return match ? { comparator: match[1] || "=", value: match[2] } : null;
  }

  function parseDuration(value) {
    const parsed = parseComparatorValue(normalize(value));
    if (!parsed) return null;
    const match = parsed.value.match(/^(\d+(?:\.\d+)?)(s|m|h)$/);
    if (!match) return null;
    const multiplier = match[2] === "h" ? 3600 : match[2] === "m" ? 60 : 1;
    const seconds = Number(match[1]) * multiplier;
    return Number.isFinite(seconds) && seconds >= 0
      ? { comparator: parsed.comparator, target: seconds }
      : null;
  }

  function parseResolution(value) {
    const parsed = parseComparatorValue(normalize(value).replace(/×/g, "x"));
    if (!parsed) return null;
    let target = RESOLUTION_HEIGHTS[parsed.value];
    if (!target) {
      const pixels = parsed.value.match(/^(\d+)x(\d+)$/);
      const vertical = parsed.value.match(/^(\d+)p$/);
      if (pixels) target = Number(pixels[2]);
      else if (vertical) target = Number(vertical[1]);
    }
    return Number.isFinite(target) && target > 0
      ? { comparator: parsed.comparator, target }
      : null;
  }

  function parseDate(value) {
    const parsed = parseComparatorValue(value);
    if (!parsed || !/^\d{4}-\d{2}-\d{2}$/.test(parsed.value)) return null;
    const timestamp = Date.parse(`${parsed.value}T00:00:00.000Z`);
    if (!Number.isFinite(timestamp)) return null;
    // Date.parse normalizes impossible dates, so compare the normalized result
    // to the source before accepting a query such as 2026-02-31.
    if (new Date(timestamp).toISOString().substring(0, 10) !== parsed.value) return null;
    return { comparator: parsed.comparator, target: timestamp };
  }

  function makeTextTerm({ excluded, field, literal, raw, start, end, value }) {
    const normalizedValue = normalize(value.replace(/^\./, field === "extension" ? "" : "."));
    if (!normalizedValue) return null;
    const wildcard = !literal && /[*?]/.test(normalizedValue);
    return {
      excluded,
      field,
      kind: literal ? "literal" : wildcard ? "wildcard" : "fuzzy",
      value: normalizedValue,
      regex: wildcard ? makeWildcardRegex(normalizedValue) : null,
      raw,
      start,
      end,
    };
  }

  function makeStructuredTerm(field, value, details) {
    if (field === "ext" || field === "folder") {
      return makeTextTerm({
        ...details,
        field: field === "ext" ? "extension" : "folder",
        value,
      });
    }
    if (field === "is") {
      const state = normalize(value);
      return PLAYBACK_STATES.has(state)
        ? { ...details, field: "state", kind: "predicate", value: state }
        : null;
    }
    const comparison = field === "duration"
      ? parseDuration(value)
      : field === "resolution" ? parseResolution(value) : parseDate(value);
    return comparison
      ? { ...details, field, kind: "comparison", ...comparison }
      : null;
  }

  function compileQuery(input) {
    const source = String(input || "");
    const query = source.trim();
    const terms = [];
    const invalidTerms = [];
    const errors = [];
    let index = 0;

    while (index < source.length) {
      while (/\s/.test(source[index] || "")) index++;
      if (index >= source.length) break;

      const termStart = index;
      let excluded = false;
      if (source[index] === "-" && index + 1 < source.length && !/\s/.test(source[index + 1])) {
        excluded = true;
        index++;
      }
      const bodyStart = index;
      const fieldMatch = source.substring(index).match(/^([a-z]+):/i);
      const namedField = fieldMatch ? normalize(fieldMatch[1]) : null;
      const isStructured = namedField && STRUCTURED_FIELDS.has(namedField);
      if (isStructured) index += fieldMatch[0].length;

      const valueResult = readValue(source, index);
      index = valueResult.nextIndex;
      const termEnd = index;
      const raw = source.substring(termStart, termEnd);
      const details = { excluded, raw, start: termStart, end: termEnd };

      if (isStructured) {
        const term = valueResult.closed
          ? makeStructuredTerm(namedField, valueResult.value, { ...details, literal: valueResult.literal })
          : null;
        if (term) {
          terms.push(term);
        } else {
          const invalid = { ...details, field: namedField, value: valueResult.value };
          invalidTerms.push(invalid);
          errors.push({
            field: namedField,
            start: termStart,
            end: termEnd,
            message: valueResult.closed
              ? `Invalid ${namedField} clause`
              : `Unclosed quote in ${namedField} clause`,
          });
        }
        continue;
      }

      // Unknown field-like tokens remain ordinary filename text, preserving the
      // forgiving behavior of simple search rather than silently discarding it.
      const value = fieldMatch
        ? source.substring(bodyStart, termEnd)
        : valueResult.value;
      const term = makeTextTerm({
        ...details,
        field: "name",
        literal: !fieldMatch && valueResult.literal,
        value,
      });
      if (term) terms.push(term);
    }

    return {
      raw: query,
      source,
      terms,
      invalidTerms,
      errors,
      positiveExtensionTerms: terms.filter((term) => term.field === "extension" && !term.excluded),
      positiveStateTerms: terms.filter((term) => term.field === "state" && !term.excluded),
    };
  }

  // Bounded optimal-string-alignment distance. The early length check and row
  // minimum keep typo matching cheap for large indexes.
  function editDistanceWithin(left, right, limit) {
    if (Math.abs(left.length - right.length) > limit) return null;
    if (left === right) return 0;

    let previousPrevious = null;
    let previous = new Array(right.length + 1);
    for (let column = 0; column <= right.length; column++) previous[column] = column;

    for (let row = 1; row <= left.length; row++) {
      const current = new Array(right.length + 1);
      current[0] = row;
      let rowMinimum = current[0];

      for (let column = 1; column <= right.length; column++) {
        const substitutionCost = left[row - 1] === right[column - 1] ? 0 : 1;
        let distance = Math.min(
          previous[column] + 1,
          current[column - 1] + 1,
          previous[column - 1] + substitutionCost
        );

        if (
          previousPrevious && row > 1 && column > 1 &&
          left[row - 1] === right[column - 2] &&
          left[row - 2] === right[column - 1]
        ) {
          distance = Math.min(distance, previousPrevious[column - 2] + 1);
        }

        current[column] = distance;
        if (distance < rowMinimum) rowMinimum = current[column];
      }

      if (rowMinimum > limit) return null;
      previousPrevious = previous;
      previous = current;
    }

    return previous[right.length] <= limit ? previous[right.length] : null;
  }

  function subsequenceScore(text, query) {
    if (query.length < 2) return null;
    let queryIndex = 0;
    let first = -1;
    let last = -1;

    for (let textIndex = 0; textIndex < text.length && queryIndex < query.length; textIndex++) {
      if (text[textIndex] === query[queryIndex]) {
        if (first === -1) first = textIndex;
        last = textIndex;
        queryIndex++;
      }
    }

    if (queryIndex !== query.length) return null;
    const span = last - first + 1;
    if (span > Math.max(query.length * 3, query.length + 4)) return null;
    return 500 - (span - query.length) * 12 - first;
  }

  function fuzzyScore(text, words, value, exactOnly = false) {
    if (!text) return null;
    if (exactOnly) return text === value ? 1000 : null;
    const exactIndex = text.indexOf(value);
    if (exactIndex !== -1) {
      const boundaryBonus = exactIndex === 0 || WORD_SEPARATOR.test(text[exactIndex - 1]) ? 80 : 0;
      return 1000 + boundaryBonus - exactIndex;
    }
    const subsequence = subsequenceScore(text, value);
    let best = subsequence;
    if (value.length >= 3) {
      const limit = value.length >= 6 ? 2 : 1;
      for (const word of words) {
        if (Math.abs(word.length - value.length) > limit) continue;
        const distance = editDistanceWithin(value, word, limit);
        if (distance !== null) {
          const score = 700 - distance * 100 - Math.abs(word.length - value.length) * 10;
          if (best === null || score > best) best = score;
        }
      }
    }
    return best;
  }

  function textTermScore(record, term) {
    const text = term.field === "extension"
      ? record.extension
      : term.field === "folder" ? record.folder : record.name;
    if (!text) return null;
    if (term.kind === "literal") {
      const index = text.indexOf(term.value);
      return index === -1 ? null : 1200 - index;
    }
    if (term.kind === "wildcard") {
      const match = term.regex.exec(text);
      return match ? 1100 - match.index : null;
    }
    const words = text.split(WORD_SEPARATOR).filter(Boolean);
    return fuzzyScore(text, words, term.value, term.field === "extension");
  }

  function compare(actual, comparator, target) {
    if (!Number.isFinite(actual)) return false;
    if (comparator === "<") return actual < target;
    if (comparator === "<=") return actual <= target;
    if (comparator === ">") return actual > target;
    if (comparator === ">=") return actual >= target;
    return actual === target;
  }

  function termScore(record, term) {
    if (["name", "extension", "folder"].includes(term.field)) return textTermScore(record, term);
    if (term.field === "state") {
      const matches = term.value === "unwatched"
        ? !record.watched
        : record.playbackState === term.value;
      return matches ? 1000 : null;
    }
    if (term.field === "duration") return compare(record.duration, term.comparator, term.target) ? 900 : null;
    if (term.field === "resolution") return compare(record.height, term.comparator, term.target) ? 900 : null;
    if (term.field === "added") {
      if (!Number.isFinite(record.addedAt)) return null;
      if (term.comparator === "=") {
        return record.addedAt >= term.target && record.addedAt < term.target + 86400000 ? 900 : null;
      }
      if (term.comparator === "<=") return record.addedAt < term.target + 86400000 ? 900 : null;
      if (term.comparator === ">") return record.addedAt >= term.target + 86400000 ? 900 : null;
      return compare(record.addedAt, term.comparator, term.target) ? 900 : null;
    }
    return null;
  }

  function matchesAlternativeGroup(record, terms) {
    return terms.length === 0 || terms.some((term) => termScore(record, term) !== null);
  }

  function match(record, compiledQuery) {
    if (!compiledQuery || compiledQuery.terms.length === 0) return { matches: true, score: 0 };
    if (!matchesAlternativeGroup(record, compiledQuery.positiveExtensionTerms || [])) {
      return { matches: false, score: 0 };
    }
    if (!matchesAlternativeGroup(record, compiledQuery.positiveStateTerms || [])) {
      return { matches: false, score: 0 };
    }

    let score = 0;
    for (const term of compiledQuery.terms) {
      if (!term.excluded && (term.field === "extension" || term.field === "state")) continue;
      const termMatchScore = termScore(record, term);
      if (term.excluded) {
        if (termMatchScore !== null) return { matches: false, score: 0 };
      } else if (termMatchScore === null) {
        return { matches: false, score: 0 };
      } else {
        score += termMatchScore;
      }
    }
    // Alternative terms still contribute a stable score for ranking.
    score += (compiledQuery.positiveExtensionTerms || []).length > 0 ? 1000 : 0;
    score += (compiledQuery.positiveStateTerms || []).length > 0 ? 1000 : 0;
    return { matches: true, score };
  }

  // Browsers should keep directories reachable when a query contains clauses
  // that only make sense for files. Text and folder clauses still narrow the
  // directory list, while ext/state/media/date clauses are ignored for it.
  function matchNavigation(record, compiledQuery) {
    if (!record || !record.item || !record.item.isDir) return match(record, compiledQuery);
    const terms = (compiledQuery && compiledQuery.terms || []).filter((term) => (
      term.field === "name" || term.field === "folder"
    ));
    return match(record, {
      terms,
      positiveExtensionTerms: [],
      positiveStateTerms: [],
    });
  }

  const BASE_SUGGESTIONS = Object.freeze([
    { id: "field-is", insertion: "is:", label: "Playback state", description: "New, in progress, watched, or unwatched" },
    { id: "field-duration", insertion: "duration:", label: "Duration", description: "Compare seconds, minutes, or hours" },
    { id: "field-resolution", insertion: "resolution:", label: "Resolution", description: "Compare 720p, 1080p, 4K, or 8K" },
    { id: "field-added", insertion: "added:", label: "Date added", description: "Compare an ISO date" },
    { id: "field-folder", insertion: "folder:", label: "Folder", description: "Match a containing folder" },
    { id: "field-ext", insertion: "ext:", label: "File extension", description: "Match a file extension" },
  ]);

  function quoteSuggestionValue(value) {
    const text = String(value || "");
    return /\s/.test(text) ? `"${text.replace(/(["\\])/g, "\\$1")}"` : text;
  }

  function getSuggestionFragment(input, cursor) {
    const source = String(input || "");
    const end = Math.max(0, Math.min(source.length, Number.isFinite(cursor) ? cursor : source.length));
    let start = end;
    while (start > 0 && !/\s/.test(source[start - 1])) start--;
    const excluded = source[start] === "-";
    return {
      start,
      end,
      prefix: excluded ? "-" : "",
      value: normalize(source.substring(start + (excluded ? 1 : 0), end)),
    };
  }

  function getSuggestions(input, options = {}) {
    const fragment = getSuggestionFragment(input, options.cursor);
    const candidates = [];
    const add = (suggestion) => candidates.push({
      ...suggestion,
      insertion: fragment.prefix + suggestion.insertion,
      replaceStart: fragment.start,
      replaceEnd: fragment.end,
    });

    if (fragment.value.startsWith("is:")) {
      ["new", "progress", "watched", "unwatched"].forEach((state) => add({
        id: `state-${state}`,
        insertion: `is:${state}`,
        label: `is:${state}`,
        description: "Playback state",
      }));
    } else if (fragment.value.startsWith("duration:")) {
      ["duration:<20m", "duration:>=1h", "duration:<90s"].forEach((insertion) => add({
        id: insertion,
        insertion,
        label: insertion,
        description: "Duration comparison",
      }));
    } else if (fragment.value.startsWith("resolution:")) {
      ["resolution:>=1080p", "resolution:4k", "resolution:>=2160p"].forEach((insertion) => add({
        id: insertion,
        insertion,
        label: insertion,
        description: "Vertical resolution comparison",
      }));
    } else if (fragment.value.startsWith("added:")) {
      add({
        id: "added-date",
        insertion: "added:>=2026-01-01",
        label: "added:>=2026-01-01",
        description: "Date-added comparison",
      });
    } else if (fragment.value.startsWith("folder:")) {
      (Array.isArray(options.folders) ? options.folders : []).forEach((folder, index) => {
        const value = typeof folder === "string" ? folder : folder && (folder.name || folder.path);
        if (!value) return;
        const insertion = `folder:${quoteSuggestionValue(value)}`;
        add({ id: `folder-${index}`, insertion, label: insertion, description: "Containing folder" });
      });
    } else {
      BASE_SUGGESTIONS.forEach(add);
    }

    const needle = fragment.value;
    const filtered = candidates.filter((candidate) => (
      !needle || normalize(`${candidate.insertion} ${candidate.label}`).includes(needle)
    ));
    const limit = Math.max(1, Math.min(20, Number(options.limit) || 8));
    return filtered.slice(0, limit);
  }

  function applySuggestion(input, suggestion) {
    const source = String(input || "");
    const start = Math.max(0, Math.min(source.length, Number(suggestion && suggestion.replaceStart) || 0));
    const rawEnd = Number(suggestion && suggestion.replaceEnd);
    const end = Math.max(start, Math.min(source.length, Number.isFinite(rawEnd) ? rawEnd : start));
    const insertion = String(suggestion && suggestion.insertion || "");
    const value = source.substring(0, start) + insertion + source.substring(end);
    return { value, cursor: start + insertion.length };
  }

  function removeTerm(input, term) {
    const source = String(input || "");
    let start = Math.max(0, Math.min(source.length, Number(term && term.start) || 0));
    let end = Math.max(start, Math.min(source.length, Number(term && term.end) || start));
    if (start > 0 && /\s/.test(source[start - 1])) {
      while (start > 0 && /\s/.test(source[start - 1])) start--;
    } else {
      while (end < source.length && /\s/.test(source[end])) end++;
    }
    return source.substring(0, start) + source.substring(end);
  }

  return {
    applySuggestion,
    compileQuery,
    createRecord,
    getSuggestions,
    match,
    matchNavigation,
    removeTerm,
  };
})();

if (typeof module !== "undefined") {
  module.exports = QuickFoldersSearch;
}
