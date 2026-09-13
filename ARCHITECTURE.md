# Architecture

Quick Folders has three isolated JavaScript contexts: the IINA player backend, the plugin-global entry, and the standalone-window browser UI. Shared modules use a small global-plus-CommonJS pattern so the same behavior can run in WebKit and in Node tests.

The repository root is deliberately also the plugin root. IINA's **Install from GitHub** fallback unpacks the default branch and reads `Info.json` from that root, so moving the manifest or runtime behind a wrapper directory breaks source installation.

## Backend

- `main.js` owns IINA APIs, persisted state, folder navigation, indexing, and message handlers.
- `file-types.js` is the single source of truth for supported media, skipped directories, and visibility preferences.
- `browse-state.js` contains pure path, watched-item, filter, and selection operations shared with the UI.
- `playback-state.js` normalizes, migrates, classifies, prunes, and derives resume state without depending on IINA.
- `index-state.js` owns versioned per-root index snapshots and diff-based reconciliation; a failed root scan retains its last useful files as unavailable.
- `incremental-index-state.js` applies authoritative changed-directory listings while preserving untouched subtrees and their record identity.
- `series-state.js` conservatively recognizes explicit episode patterns and recommends the first in-progress or unwatched episode.
- `diagnostics.js` retains a bounded in-memory ring of allowlisted categories and numeric metrics without accepting paths or raw error text.
- `async-resource-loader.js` provides bounded, deduplicated worker queues for thumbnails and media metadata.
- `thumbnail-service.js` selects bounded native, optional `ffmpeg`, image-resize, or generated-preview strategies and owns temporary output cleanup.
- `media-metadata.js` parses, merges, and formats Spotlight and optional `ffprobe` values.
- `path-security.js` rejects configured-root paths containing symbolic-link components before privileged native operations.
- `shared-state-lock.js` serializes shared plugin-data mutations across IINA player instances through the global entry.
- `global.js` coordinates shared-state leases, creates an isolated managed IINA player for **Watch Queue**, and relays queue data and results between player instances.
- `queue-playback.js` waits for IINA's asynchronous folder matcher, removes unrelated native playlist entries, verifies explicit queue order, and synchronizes first-item playback.
- `queue-state.js` contains bounded, deterministic queue add, remove, drag, and reorder operations shared by both runtimes.

General settings, the versioned index, playback records, and browser context use separate plugin-data files so each can migrate and flush independently. State schema v5 carries a durable library revision that fences scan and playback work begun before a root or file removal. The global entry grants renewable, exclusive leases around shared read-merge-write sections; abandoned leases expire so a stopped player cannot block later saves. JSON state writes retain a validated backup copy so a damaged primary file can recover on the next load, while explicit removals scrub both primary and backup data. Startup first publishes a compact navigation state, then prepares and publishes the potentially large cached search index on a zero-delay task after the new WebView's first state handshake; only filesystem reconciliation stays deferred. Reconciliation uses alternating, ownership-tokened per-root timestamp markers and the system `find` tool to list only directories changed since the last successful snapshot while pruning the same ignored directory classes as the recursive indexer. Marker times overlap by ten seconds for coarse-timestamp media volumes, and a lost marker race forces a full scan. The same full recursive fallback applies when native acceleration is unavailable or scan-affecting preferences change. Each root is built in local state, merged path-by-path, and published as one snapshot, while a failed root retains its last useful files as unavailable for read-only navigation. Concurrent refresh requests share one build; folder-root mutations request a follow-up build so a changing root list cannot leave a stale index. Backend updates include the complete indexed-file payload only when its revision changes, while the UI retains the last published index. Media duration and dimensions discovered lazily are overlaid on an in-flight reconciliation through a bounded buffer and merged into the durable index with a trailing write that is flushed on window close.

Playback events record bounded, debounced progress for validated local media only. File-started transitions flush and detach the preceding path; the later file-loaded event binds the new path before attempting resume so transition samples cannot cross-contaminate records. Explicit watched/unwatched state takes precedence over the configurable completion threshold. Resume occurs only for an in-progress item with a meaningful saved position, unchanged duration, and no existing native IINA resume position.

## UI

- `ui/app.js` coordinates state, backend messages, rendering, and user commands.
- `ui/browse-model.js` owns indexed search records, result ranking, filtering, and its result cache.
- `ui/interaction-controller.js` owns testable navigation and filter commands at the browser/backend boundary.
- `ui/item-view.js` is the stateless DOM factory for folder and file rows.
- `ui/item-collection.js` provides fixed-geometry list/grid virtualization, path-keyed scroll anchors, and layout-aware keyboard navigation.
- `ui/media-preview.js` owns lazy loading, bounded caches, and direct path-to-element lookup for media responses.
- `ui/browser-context.js` validates and migrates persisted location, query, file filter, layout, scroll anchor, and bounded recent locations.
- `ui/commands.js` and `ui/command-palette.js` define and render context-sensitive, keyboard-searchable commands.
- `ui/dialog-controller.js` provides modal focus management and keyboard containment.
- `ui/queue-controller.js` owns queue-panel rendering, selection, keyboard access, and browser drag/drop behavior.
- `ui/responsive-layout.js` owns the wide-window breakpoint and automatic queue visibility.
- `ui/column-view.js` renders lightweight ancestor columns while the active folder stays in the full item view.
- `ui/view-helpers.js`, `ui/search.js`, and `ui/keyboard-shortcuts.js` contain testable presentation and input logic. Structured search supports playback state, duration, resolution, first-seen date, extension, and folder clauses.

Scripts in `ui/index.html` are ordered by dependency. Keep shared/pure modules before DOM controllers and load `app.js` last.

## Important invariants

- Filesystem mutations and file-open requests must validate paths against configured roots and reject symbolic-link components immediately before use.
- Persisted queue entries and native-playlist launches must revalidate every path against configured roots, symbolic-link components, and real playable files.
- Managed queue players adopt the first item opened by `global.js`; reopening it from `main.js` would start a second folder-matcher pass and race playlist reconciliation.
- Directories remain visible under file-type filters so navigation cannot strand the user.
- A rendered selection may contain only currently visible file paths.
- Selection-only changes update existing rows in place so thumbnail, metadata, focus, and drag state survive.
- Async thumbnail and metadata requests are lazy, deduplicated, bounded, and must not deliver invalidated results after deletion.
- Large result sets remain windowed; DOM size must be proportional to the viewport rather than library size.
- Browser context restores only paths still contained by configured roots, and transient selection is never persisted.
- Diagnostics must remain bounded, local to the running backend, and incapable of accepting raw paths or messages.
- Backend state handlers are registered once even when the standalone window is reopened.
- The shipped plugin uses filesystem access only; adding network access requires documenting the purpose and narrowly listing allowed domains.

## Verification

Run `npm run verify` to check JavaScript syntax, manifest integrity, browser script references, documentation links, Node unit and integration tests, Playwright WebKit UI tests, and the installable archive. UI changes should also be exercised from the 500×600 default through the narrow viewport cases in [CONTRIBUTING.md](CONTRIBUTING.md), including search/filter composition, selection actions, modal focus behavior, watched views, queue editing, and media metadata updates.
