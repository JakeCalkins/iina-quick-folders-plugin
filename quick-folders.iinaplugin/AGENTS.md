# Plugin backend guide

This directory is the plugin source root. Its runtime assets are shipped to users; contributor-only `AGENTS.md` and `CLAUDE.md` files are excluded by the packager.

## Runtime boundaries

- `main.js` runs inside IINA, not Node or a general browser. Use the APIs exposed through the global `iina` object.
- Backend modules use CommonJS. Do not introduce Node-only filesystem, process, or network APIs into shipped code.
- The browser UI has a separate JavaScript context and communicates only through the message names defined by the backend and `ui/messaging.js`.
- Keep `Info.json` permissions and domains minimal. A new permission requires a concrete feature need and accompanying documentation.

## State and filesystem rules

- Normalize and validate all UI-supplied paths before opening, reading metadata, marking watched, or deleting.
- A configured root matches itself or descendants on a path-segment boundary; reject traversal and lookalike prefixes.
- Verify a target is a real playable file immediately before any mutation.
- Keep persisted state backward-compatible or add an explicit migration and tests.
- Build indexes into local state and publish atomically. Concurrent refreshes must share work, while root changes must schedule a follow-up build.
- Snapshot preferences once per scan/list operation rather than repeatedly crossing the IINA preference API boundary.
- Bound caches, queues, scans, and bulk operations. Async results for removed files must not be delivered later.

## IINA compatibility

- Account for IINA file entries exposing either `filename`/`name` and `isDir`/`is_dir`.
- Treat file size, thumbnails, Spotlight metadata, and directory access as optional; failures should degrade gracefully.
- Message handlers must be registered once even if the standalone window is reopened.
- Keep menu shortcut defaults consistent with `Info.json`, preferences UI, README, help UI, and tests.

## Verification

- Add pure behavior to a focused module and test it with Node when possible.
- Extend `tests/main-actions.test.js` for IINA orchestration, persistence, validation, or message changes.
- Run `npm run verify`; if `Info.json` changes, also confirm the packaged archive contains the intended entry and preference files.
