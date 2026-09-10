# Architecture

Quick Folders has two JavaScript runtimes: the IINA plugin backend and the standalone-window browser UI. Shared modules use a small global-plus-CommonJS pattern so the same behavior can run in WebKit and in Node tests.

## Backend

- `main.js` owns IINA APIs, persisted state, folder navigation, indexing, and message handlers.
- `file-types.js` is the single source of truth for supported media, skipped directories, and visibility preferences.
- `browse-state.js` contains pure path, watched-item, filter, and selection operations shared with the UI.
- `async-resource-loader.js` provides bounded, deduplicated worker queues for thumbnails and Spotlight metadata.
- `media-metadata.js` parses and formats Spotlight values.

Index builds use a local result and publish it atomically when complete. Concurrent refresh requests share one build; folder-root mutations request a follow-up build so a changing root list cannot leave a stale index.

## UI

- `ui/app.js` coordinates state, backend messages, rendering, and user commands.
- `ui/browse-model.js` owns indexed search records, result ranking, filtering, and its result cache.
- `ui/item-view.js` is the stateless DOM factory for folder and file rows.
- `ui/media-preview.js` owns lazy loading, bounded caches, and direct path-to-element lookup for media responses.
- `ui/dialog-controller.js` provides modal focus management and keyboard containment.
- `ui/view-helpers.js`, `ui/search.js`, and `ui/keyboard-shortcuts.js` contain testable presentation and input logic.

Scripts in `ui/index.html` are ordered by dependency. Keep shared/pure modules before DOM controllers and load `app.js` last.

## Important invariants

- Filesystem mutations and file-open requests must validate paths against configured roots.
- Directories remain visible under file-type filters so navigation cannot strand the user.
- A rendered selection may contain only currently visible file paths.
- Async thumbnail and metadata requests are deduplicated, bounded, and must not deliver invalidated results after deletion.
- Backend state handlers are registered once even when the standalone window is reopened.

## Verification

Run `node --test tests/*.test.js` plus syntax checks for every JavaScript entry point. UI changes should also be exercised in a 500×600 browser viewport, including search/filter composition, selection actions, modal focus behavior, watched views, and media metadata updates. Finally, build with `iina-plugin pack quick-folders.iinaplugin` and validate the archive with `unzip -t`.
