// Owns index-derived search work so app.js can render a single prepared list.
const QuickFoldersBrowseModel = (() => {
  const Search = typeof module !== "undefined"
    ? require("./search.js")
    : QuickFoldersSearch;
  const BrowseState = typeof module !== "undefined"
    ? require("../browse-state.js")
    : QuickFoldersBrowseState;

  function create({ maxSearchResults = 500 } = {}) {
    let indexRevision = null;
    let indexedRecords = [];
    let searchCache = { key: null, matches: [], total: 0 };

    function updateIndex(files, revision) {
      if (revision === indexRevision) return false;
      indexedRecords = (Array.isArray(files) ? files : []).map(Search.createRecord);
      indexRevision = revision;
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
      const currentItems = Array.isArray(currentState.items) ? currentState.items : [];
      const hasQuery = Boolean(query);
      const matchesSearch = (item) => !hasQuery || Search.match(Search.createRecord(item), compiledQuery).matches;
      let items;
      let totalIndexedMatches = 0;

      if (hasQuery && currentState.atRoot) {
        const indexed = findIndexedFiles(query, compiledQuery, filter);
        totalIndexedMatches = indexed.total;
        const indexedItems = indexed.matches.map(({ file }) => ({
          path: file.path,
          name: file.name,
          isDir: false,
          size: file.size || null,
          fromSearch: true,
          watched: Boolean(file.watched),
        }));
        items = currentItems.filter(matchesSearch).concat(indexedItems);
      } else {
        items = currentItems.filter(matchesSearch);
      }

      const filtered = items.filter((item) => {
        if (!matchesFilter(item, filter)) return false;
        return !(preferences && preferences.hideWatched && !currentState.viewingWatched && item.watched);
      });
      return { items: filtered, totalIndexedMatches };
    }

    return { getItems, updateIndex };
  }

  return { create };
})();

if (typeof module !== "undefined") {
  module.exports = QuickFoldersBrowseModel;
}
