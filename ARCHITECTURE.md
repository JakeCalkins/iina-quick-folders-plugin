# Architecture

Quick Folders has two JavaScript runtimes: the IINA plugin backend and the standalone-window browser UI. Shared modules use a small global-plus-CommonJS pattern so the same behavior can run in WebKit and in Node tests.

The repository root is deliberately also the plugin root. IINA's **Install from GitHub** fallback unpacks the default branch and reads `Info.json` from that root, so moving the manifest or runtime behind a wrapper directory breaks source installation.

## Backend

- `main.js` owns IINA APIs, persisted state, folder navigation, indexing, and message handlers.
- `file-types.js` is the single source of truth for supported media, skipped directories, and visibility preferences.
- `browse-state.js` contains pure path, watched-item, filter, and selection operations shared with the UI.
- `async-resource-loader.js` provides bounded, deduplicated worker queues for thumbnails and media metadata.
- `thumbnail-service.js` selects bounded native, optional `ffmpeg`, image-resize, or generated-preview strategies and owns temporary output cleanup.
- `media-metadata.js` parses, merges, and formats Spotlight and optional `ffprobe` values.

Index builds use a local result and publish it atomically when complete. Concurrent refresh requests share one build; folder-root mutations request a follow-up build so a changing root list cannot leave a stale index.

## UI

- `ui/app.js` coordinates state, backend messages, rendering, and user commands.
- `ui/browse-model.js` owns indexed search records, result ranking, filtering, and its result cache.
- `ui/interaction-controller.js` owns testable navigation and filter commands at the browser/backend boundary.
- `ui/item-view.js` is the stateless DOM factory for folder and file rows.
- `ui/media-preview.js` owns lazy loading, bounded caches, and direct path-to-element lookup for media responses.
- `ui/dialog-controller.js` provides modal focus management and keyboard containment.
- `ui/view-helpers.js`, `ui/search.js`, and `ui/keyboard-shortcuts.js` contain testable presentation and input logic.

Scripts in `ui/index.html` are ordered by dependency. Keep shared/pure modules before DOM controllers and load `app.js` last.

## Important invariants

- Filesystem mutations and file-open requests must validate paths against configured roots.
- Directories remain visible under file-type filters so navigation cannot strand the user.
- A rendered selection may contain only currently visible file paths.
- Async thumbnail and metadata requests are lazy, deduplicated, bounded, and must not deliver invalidated results after deletion.
- Backend state handlers are registered once even when the standalone window is reopened.

## Verification

Run `npm run verify` to check JavaScript syntax, manifest integrity, browser script references, documentation links, unit tests, and the installable archive. UI changes should also be exercised in a 500×600 browser viewport, including search/filter composition, selection actions, modal focus behavior, watched views, and media metadata updates. See [CONTRIBUTING.md](CONTRIBUTING.md) for the manual regression checklist.
