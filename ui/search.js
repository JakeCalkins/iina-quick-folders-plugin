const QuickFoldersSearch = (() => {
  const WORD_SEPARATOR = /[^a-z0-9]+/;

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

  function createRecord(item) {
    const name = normalize(item.name);
    return {
      item,
      name,
      extension: normalize(item.ext || getExtension(name, item.isDir)),
      words: name.split(WORD_SEPARATOR).filter(Boolean),
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
        return { value, nextIndex: index + 1 };
      } else {
        value += character;
        index++;
      }
    }
    return { value, nextIndex: index };
  }

  function compileQuery(input) {
    const query = String(input || "").trim();
    const terms = [];
    let index = 0;

    while (index < query.length) {
      while (/\s/.test(query[index] || "")) index++;
      if (index >= query.length) break;

      let excluded = false;
      if (query[index] === "-" && index + 1 < query.length && !/\s/.test(query[index + 1])) {
        excluded = true;
        index++;
      }

      let field = "name";
      if (query.substring(index, index + 4).toLowerCase() === "ext:") {
        field = "extension";
        index += 4;
      }

      let value = "";
      let literal = false;
      if (query[index] === '"') {
        const quoted = readQuoted(query, index);
        value = quoted.value;
        index = quoted.nextIndex;
        literal = true;
      } else {
        const start = index;
        while (index < query.length && !/\s/.test(query[index])) index++;
        value = query.substring(start, index);
      }

      value = normalize(value.replace(/^\./, field === "extension" ? "" : "."));
      if (!value) continue;

      const wildcard = !literal && /[*?]/.test(value);
      terms.push({
        excluded,
        field,
        kind: literal ? "literal" : wildcard ? "wildcard" : "fuzzy",
        value,
        regex: wildcard ? makeWildcardRegex(value) : null,
      });
    }

    return {
      raw: query,
      terms,
      positiveExtensionTerms: terms.filter(term => term.field === "extension" && !term.excluded),
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
        if (distance < rowMinimum) rowMinimum = distance;
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

  function fuzzyScore(record, value, field) {
    const text = field === "extension" ? record.extension : record.name;
    if (!text) return null;

    // Extensions are short identifiers: exact matching is both less surprising
    // and substantially cheaper. Wildcard extension clauses remain available.
    if (field === "extension") return text === value ? 1000 : null;

    const exactIndex = text.indexOf(value);
    if (exactIndex !== -1) {
      const boundaryBonus = exactIndex === 0 || WORD_SEPARATOR.test(text[exactIndex - 1]) ? 80 : 0;
      return 1000 + boundaryBonus - exactIndex;
    }

    const subsequence = subsequenceScore(text, value);
    let best = subsequence;

    if (field === "name" && value.length >= 3) {
      const limit = value.length >= 6 ? 2 : 1;
      for (const word of record.words) {
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

  function termScore(record, term) {
    const text = term.field === "extension" ? record.extension : record.name;
    if (!text) return null;

    if (term.kind === "literal") {
      const index = text.indexOf(term.value);
      return index === -1 ? null : 1200 - index;
    }
    if (term.kind === "wildcard") {
      const match = term.regex.exec(text);
      return match ? 1100 - match.index : null;
    }
    return fuzzyScore(record, term.value, term.field);
  }

  function match(record, compiledQuery) {
    if (!compiledQuery || compiledQuery.terms.length === 0) return { matches: true, score: 0 };

    // Multiple positive extension clauses are alternatives (ext:mp4 ext:mkv),
    // while ordinary positive clauses all have to match.
    if (compiledQuery.positiveExtensionTerms.length > 0) {
      let extensionMatched = false;
      for (const term of compiledQuery.positiveExtensionTerms) {
        if (termScore(record, term) !== null) {
          extensionMatched = true;
          break;
        }
      }
      if (!extensionMatched) return { matches: false, score: 0 };
    }

    let score = 0;
    for (const term of compiledQuery.terms) {
      if (term.field === "extension" && !term.excluded) continue;
      const termMatchScore = termScore(record, term);
      if (term.excluded) {
        if (termMatchScore !== null) return { matches: false, score: 0 };
      } else if (termMatchScore === null) {
        return { matches: false, score: 0 };
      } else {
        score += termMatchScore;
      }
    }

    return { matches: true, score };
  }

  return { compileQuery, createRecord, match };
})();

if (typeof module !== "undefined") {
  module.exports = QuickFoldersSearch;
}
