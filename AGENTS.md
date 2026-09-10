# Quick Folders repository guide

This repository contains an IINA plugin with two JavaScript runtimes: the IINA backend and a standalone-window browser UI. Read [ARCHITECTURE.md](ARCHITECTURE.md) before changing runtime boundaries or data flow.

## Start here

- Preserve unrelated user changes and inspect the working tree before editing.
- Use the nearest `AGENTS.md`; nested guidance supplements this file for that directory.
- Keep the plugin dependency-free unless a dependency solves a demonstrated problem that cannot be handled clearly with platform APIs.
- Prefer small, testable modules over adding more orchestration to `main.js` or `ui/app.js`.

## Commands

- `npm run check` — validate JavaScript syntax, the plugin manifest, browser assets, local Markdown links, agent references, and high-confidence privacy patterns.
- `npm test` — run the complete Node test suite.
- `npm run package` — create an installable package and checksum in `dist/`.
- `npm run verify` — run all checks, tests, and packaging; use this before handing off a change.
- `npm run dev:link` / `npm run dev:unlink` — add or remove the development plugin in IINA.

## Architecture and style

- `quick-folders.iinaplugin/main.js` owns IINA APIs, persistence, indexing, navigation, and backend messages.
- Shared pure behavior belongs in modules such as `file-types.js`, `browse-state.js`, or a new focused module with Node coverage.
- `quick-folders.iinaplugin/ui/app.js` coordinates state and commands; DOM factories, dialogs, search, and async previews live in separate UI modules.
- Use `const` by default, descriptive camelCase names, guard clauses, and focused functions.
- Comments should explain intent, invariants, platform constraints, or tradeoffs—not restate the code.
- Keep user-facing copy concise and use consistent Quick Folders, IINA, file-type, and watched/unwatched terminology.

## Safety and privacy

- Treat filesystem operations as security-sensitive. Validate file-open and mutation targets against configured folder roots and actual file entries.
- Permanent deletion must remain explicit, confirmed, bounded, and accurately reported to the UI.
- Never commit credentials, tokens, private keys, cookies, logs, real media filenames, absolute home-directory paths, hostnames, or editor/OS state.
- Use obviously fictional, portable fixture paths such as `/media/example.mp4`; do not copy paths from a contributor's machine into code or docs.
- Do not add telemetry or network calls. If network access is ever required, document the purpose and narrow `allowedDomains` in `Info.json`.
- Generated `.iinaplgz`, checksum, `dist/`, plugin state, and debug output must remain untracked.

## Testing expectations

- Add a regression test for behavior changes whenever the logic can run outside IINA.
- For backend changes, cover both accepted and rejected paths and clean up mocked globals after each test.
- For UI changes, test the 500×600 default window, keyboard access, focus behavior, light/dark appearance, reduced motion, search/filter composition, and an error-free console as relevant.
- For workflow or script changes, run `actionlint` or `shellcheck` when available in addition to `npm run verify`.
- Compare package contents with IINA's native packer when changing packaging behavior.

## Documentation and releases

- Update README or focused docs when installation, shortcuts, settings, security, or contributor workflows change.
- Add user-visible changes to `CHANGELOG.md` under Unreleased during development.
- Release preparation must update `Info.json` and promote changelog notes together. Tags use `vMAJOR.MINOR.PATCH` and must match both files.
- Do not commit generated release assets or create/move release tags unless the task explicitly requests a release.

## Completion checklist

- The implementation is scoped, readable, and preserves the architecture invariants.
- Relevant automated and manual regressions have been exercised.
- `npm run verify` passes and `git diff --check` is clean.
- Documentation and changelog entries match the resulting behavior.
- The final handoff states what changed, what was tested, and any remaining limitation.
