// Searchable command metadata shared by the command palette and shortcut help.
// The registry knows when a command applies, while app.js remains responsible
// for binding command ids to browser/backend actions.
const QuickFoldersCommands = (() => {
  function hasAvailableView(context, viewId) {
    const values = context && context.availableViews;
    if (!values) return true;
    if (values instanceof Set) return values.has(viewId);
    return Array.isArray(values) && values.includes(viewId);
  }

  function hasMediaType(context, type) {
    const values = context && context.availableMediaTypes;
    if (!values) return true;
    if (values instanceof Set) return values.has(type);
    return Array.isArray(values) && values.includes(type);
  }

  function getRecentLocation(context, index) {
    const values = context && context.recentLocations;
    return Array.isArray(values) ? values[index] : null;
  }

  function getRecentLocationLabel(context, index) {
    const location = getRecentLocation(context, index);
    if (!location) return "Open Recent Location";
    if (location.kind === "folder") {
      const name = String(location.path || "").split("/").filter(Boolean).pop() || "Folder";
      return `Open Recent: ${name}`;
    }
    const labels = {
      continue: "Continue Watching",
      recent: "Recently Added",
      series: "Continue Series",
      unwatched: "Unwatched",
      watched: "Watched",
    };
    return `Open Recent: ${labels[location.viewId] || "Smart View"}`;
  }

  function createDefaultCommands() {
    const commands = [
      { id: "navigation.root", label: "Go to Quick Folders", group: "Navigation", keywords: ["home", "root"] },
      { id: "navigation.back", label: "Go Back", group: "Navigation", shortcut: "←", when: (context) => Boolean(context.canGoBack) },
      { id: "navigation.continue-watching", label: "Open Continue Watching", group: "Navigation", keywords: ["resume", "progress"], when: (context) => hasAvailableView(context, "continue") },
      { id: "navigation.recently-added", label: "Open Recently Added", group: "Navigation", keywords: ["new", "latest"], when: (context) => hasAvailableView(context, "recent") },
      { id: "navigation.continue-series", label: "Open Continue Series", group: "Navigation", keywords: ["next episode", "shows"], when: (context) => hasAvailableView(context, "series") },
      { id: "navigation.unwatched", label: "Open Unwatched", group: "Navigation", keywords: ["new", "remaining"], when: (context) => hasAvailableView(context, "unwatched") },
      { id: "navigation.watched", label: "Open Watched", group: "Navigation", when: (context) => hasAvailableView(context, "watched") },
      { id: "browse.focus-search", label: "Focus Search", group: "Browse", shortcut: "⌘/Ctrl F", keywords: ["find", "query"] },
      { id: "browse.clear-search", label: "Clear Search", group: "Browse", when: (context) => Boolean(context.hasQuery) },
      { id: "browse.refresh", label: "Refresh Library", group: "Browse", keywords: ["index", "rescan"], when: (context) => !context.isIndexing },
      { id: "folder.add", label: "Add Folder", group: "Browse", shortcut: "N" },
      { id: "filter.all", label: "Show All File Types", group: "Filter", when: (context) => context.filter !== "all" },
      { id: "filter.video", label: "Show Videos Only", group: "Filter", when: (context) => context.filter !== "video" && hasMediaType(context, "video") },
      { id: "filter.audio", label: "Show Audio Only", group: "Filter", when: (context) => context.filter !== "audio" && hasMediaType(context, "audio") },
      { id: "filter.image", label: "Show Images Only", group: "Filter", when: (context) => context.filter !== "image" && hasMediaType(context, "image") },
      { id: "layout.list", label: "Use List Layout", group: "View", keywords: ["dense", "rows"], when: (context) => context.layout !== "list" },
      { id: "layout.grid", label: "Use Poster Grid Layout", group: "View", keywords: ["cards", "thumbnails"], when: (context) => context.layout !== "grid" },
      { id: "selection.queue", label: "Add Selection to Queue", group: "Selection", shortcut: "Q", when: (context) => Number(context.selectionCount) > 0 },
      {
        id: "selection.toggle-watched",
        label: (context) => context.selectionAllWatched ? "Mark Selection Unwatched" : "Mark Selection Watched",
        group: "Selection",
        shortcut: "W",
        when: (context) => Number(context.selectionCount) > 0,
      },
      { id: "selection.delete", label: "Move Selection to Trash", group: "Selection", shortcut: "⌫", keywords: ["delete", "remove"], when: (context) => Number(context.selectionCount) > 0 },
      { id: "selection.clear", label: "Clear Selection", group: "Selection", shortcut: "Esc", when: (context) => Number(context.selectionCount) > 0 },
      { id: "queue.open", label: "Show Queue", group: "Queue", when: (context) => !context.queueOpen },
      { id: "queue.close", label: "Hide Queue", group: "Queue", when: (context) => Boolean(context.queueOpen) },
      { id: "queue.play", label: "Watch Queue", group: "Queue", when: (context) => Number(context.queueCount) > 0 },
      { id: "help.open", label: "Show Keyboard Shortcuts", group: "Help", shortcut: "?", keywords: ["reference"] },
      { id: "diagnostics.open", label: "Show Diagnostics", group: "Help", keywords: ["errors", "index", "cache", "debug"] },
    ];
    for (let index = 0; index < 5; index++) {
      commands.splice(2 + index, 0, {
        id: `navigation.recent-location-${index + 1}`,
        label: (context) => getRecentLocationLabel(context, index),
        group: "Recent",
        keywords: ["history", "location"],
        when: (context) => Boolean(getRecentLocation(context, index)),
      });
    }
    return commands;
  }

  function normalizeText(value) {
    return String(value || "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
  }

  function subsequenceScore(text, query) {
    let queryIndex = 0;
    let first = -1;
    let last = -1;
    for (let index = 0; index < text.length && queryIndex < query.length; index++) {
      if (text[index] !== query[queryIndex]) continue;
      if (first === -1) first = index;
      last = index;
      queryIndex++;
    }
    if (queryIndex !== query.length) return null;
    return 200 - (last - first + 1 - query.length) - first;
  }

  function commandScore(command, query) {
    if (!query) return 0;
    const label = normalizeText(command.label);
    const searchText = normalizeText([
      command.label,
      command.group,
      ...(Array.isArray(command.keywords) ? command.keywords : []),
    ].join(" "));
    if (label === query) return 1000;
    if (label.startsWith(query)) return 800 - label.length;
    const index = searchText.indexOf(query);
    if (index !== -1) return 600 - index;
    return subsequenceScore(searchText, query);
  }

  function resolveCommand(command, context) {
    const currentContext = context && typeof context === "object" ? context : {};
    return {
      id: command.id,
      label: typeof command.label === "function" ? command.label(currentContext) : command.label,
      group: command.group || "Commands",
      keywords: Array.isArray(command.keywords) ? command.keywords.slice() : [],
      shortcut: typeof command.shortcut === "function"
        ? command.shortcut(currentContext)
        : command.shortcut || "",
    };
  }

  function create(options = {}) {
    const commands = (Array.isArray(options.commands) ? options.commands : createDefaultCommands())
      .filter((command) => command && typeof command.id === "string" && command.id.length > 0);
    const commandsById = new Map(commands.map((command) => [command.id, command]));
    const handlers = options.handlers && typeof options.handlers === "object" ? options.handlers : {};

    function isAvailable(command, context) {
      if (typeof command.when !== "function") return true;
      try {
        return Boolean(command.when(context && typeof context === "object" ? context : {}));
      } catch (error) {
        return false;
      }
    }

    function list(context = {}) {
      return commands
        .filter((command) => isAvailable(command, context))
        .map((command) => resolveCommand(command, context));
    }

    function search(query, context = {}, options = {}) {
      const normalizedQuery = normalizeText(query);
      const limit = Math.max(1, Math.min(100, Number(options.limit) || 30));
      return list(context)
        .map((command, index) => ({ command, index, score: commandScore(command, normalizedQuery) }))
        .filter((entry) => entry.score !== null)
        .sort((left, right) => right.score - left.score || left.index - right.index)
        .slice(0, limit)
        .map((entry) => entry.command);
    }

    function execute(id, context = {}) {
      const command = commandsById.get(id);
      if (!command || !isAvailable(command, context)) {
        return { executed: false, command: null, result: undefined };
      }
      const resolved = resolveCommand(command, context);
      const handler = handlers[id] || options.onExecute;
      if (typeof handler !== "function") {
        return { executed: false, command: resolved, result: undefined };
      }
      return { executed: true, command: resolved, result: handler(resolved, context) };
    }

    return { execute, list, search };
  }

  return { create, createDefaultCommands };
})();

if (typeof module !== "undefined") {
  module.exports = QuickFoldersCommands;
}
