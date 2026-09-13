// Owns index-derived search work so app.js can render a single prepared list.
const QuickFoldersBrowseModel = (() => {
  const Search = typeof module !== "undefined"
    ? require("./search.js")
    : QuickFoldersSearch;
  const BrowseState = typeof module !== "undefined"
    ? require("../browse-state.js")
    : QuickFoldersBrowseState;

  function create({ maxSearchResults = 100000 } = {}) {
    let indexRevision = null;
    let indexedRecords = [];
    let indexedRecordsByPath = new Map();
    let indexedRecordPositions = new Map();
    let searchCache = { key: null, matches: [], total: 0 };

    function updateIndex(files, revision) {
      if (revision === indexRevision) return false;
      indexedRecords = (Array.isArray(files) ? files : []).map(Search.createRecord);
      indexedRecordsByPath = new Map(indexedRecords.map((record) => [record.item.path, record]));
      indexedRecordPositions = new Map(indexedRecords.map((record, index) => [record.item.path, index]));
      indexRevision = revision;
      searchCache = { key: null, matches: [], total: 0 };
      return true;
    }

    function updateMetadata(path, metadata) {
      if (typeof path !== "string" || !metadata || typeof metadata !== "object") return false;
      const recordIndex = indexedRecordPositions.get(path);
      if (recordIndex == null) return false;
      const item = indexedRecords[recordIndex].item;
      const next = { ...item };
      let changed = false;
      ["duration", "width", "height"].forEach((field) => {
        const value = Number(metadata[field]);
        if (Number.isFinite(value) && value > 0 && next[field] !== value) {
          next[field] = value;
          changed = true;
        }
      });
      if (!changed) return false;
      indexedRecords[recordIndex] = Search.createRecord(next);
      indexedRecordsByPath.set(path, indexedRecords[recordIndex]);
      searchCache = { key: null, matches: [], total: 0 };
      return true;
    }

    function matchesFilter(item, filter) {
      return BrowseState.matchesFileFilter(item, filter);
    }

    function findIndexedFiles(query, compiledQuery, filter) {
      const cacheKey = `${indexRevision}\u0000${filter}\u0000${query}`;
      if (searchCache.key === cacheKey) return searchCache;

      const matches = [];
      indexedRecords.forEach((record) => {
        const result = Search.match(record, compiledQuery);
        if (result.matches && matchesFilter(record.item, filter)) {
          matches.push({ file: record.item, score: result.score });
        }
      });
      matches.sort((left, right) => right.score - left.score);
      searchCache = {
        key: cacheKey,
        matches: matches.slice(0, maxSearchResults),
        total: matches.length,
      };
      return searchCache;
    }

    function getItems({ state, query, compiledQuery, filter, preferences }) {
      const currentState = state || {};
      const currentItems = (Array.isArray(currentState.items) ? currentState.items : []).map((item) => {
        if (!item || item.isDir) return item;
        const indexed = indexedRecordsByPath.get(item.path);
        return indexed ? { ...indexed.item, ...item } : item;
      });
      const hasQuery = Boolean(query);
      const matchesSearch = (item) => {
        if (!hasQuery) return true;
        const record = Search.createRecord(item);
        return item && item.isDir
          ? Search.matchNavigation(record, compiledQuery).matches
          : Search.match(record, compiledQuery).matches;
      };
      let items;
      let totalIndexedMatches = 0;

      if (hasQuery && currentState.atRoot) {
        const indexed = findIndexedFiles(query, compiledQuery, filter);
        totalIndexedMatches = indexed.total;
        const indexedItems = indexed.matches.map(({ file }) => ({
          ...file,
          isDir: false,
          fromSearch: true,
        }));
        items = currentItems.filter(matchesSearch).concat(indexedItems);
      } else {
        items = currentItems.filter(matchesSearch);
      }

      const filtered = items.filter((item) => {
        if (!matchesFilter(item, filter)) return false;
        return !(
          preferences && preferences.hideWatched
          && currentState.currentView !== "watched"
          && !currentState.viewingWatched
          && item.watched
        );
      });
      return { items: filtered, totalIndexedMatches };
    }

    return { getItems, updateIndex, updateMetadata };
  }

  return { create };
})();

if (typeof module !== "undefined") {
  module.exports = QuickFoldersBrowseModel;
}
