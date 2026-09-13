# Test guide

Unit and integration tests use the built-in `node:test` runner and strict assertions. Browser UI tests use the pinned, development-only Playwright dependency. Keep every suite deterministic and keep dependencies out of the shipped plugin.

## Test design

- Name tests after observable behavior, not internal implementation details.
- Prefer small fixtures that contain only the fields relevant to the assertion.
- Use portable fictional paths such as `/media/movie.mp4`; never paste real user paths or filenames into fixtures.
- Cover happy paths, boundaries, malformed input, and failure recovery for filesystem or async behavior.
- For selection/search helpers, assert ordering and full result values where that is part of the contract.
- For queues and caches, cover deduplication, limits, invalidation, rejection, and late completion.

## IINA orchestration tests

- Build the smallest complete `global.iina` mock required by the entry point.
- Capture registered callbacks and emitted messages instead of reaching into module internals.
- Restore timers and delete mocked globals in `finally` so tests cannot contaminate one another.
- Use fresh `require.cache` entries when loading `main.js` more than once.
- Assert that unsafe or out-of-root inputs do not reach `core.open`, `file.delete`, or external tools.

## Verification

- Run one file while iterating with `node --test tests/<name>.test.js`.
- Run integration tests with `npm run test:integration`.
- Run the functional WebKit suite with `npm run test:ui`; use its injected IINA boundary rather than production test hooks.
- Run `npm test` before handoff; run `npm run verify` when changes affect packaging, docs, or the manifest.
