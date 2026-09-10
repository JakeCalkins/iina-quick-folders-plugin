# Contributing to Quick Folders

Thanks for improving Quick Folders. Small, focused changes with clear test evidence are the easiest to review and ship.

## Before you start

- Automated coding agents should follow the root [AGENTS.md](AGENTS.md) plus the nearest scoped `AGENTS.md` for files they change. Matching `CLAUDE.md` files reference those instructions without duplicating them.
- Search [existing issues](https://github.com/JakeCalkins/iina-quick-folders-plugin/issues) before filing a new one.
- Use the bug or feature issue form so environment and reproduction details are captured consistently.
- For security-sensitive reports, follow [SECURITY.md](SECURITY.md) instead of opening a public issue.
- Be respectful and constructive in issues, reviews, and discussions.

## Development setup

Requirements:

- macOS with IINA 1.4.0 or later for integration testing
- Node.js 20 or later for validation and unit tests
- `zip` and `unzip` for local packaging

Clone and verify the repository:

```sh
git clone https://github.com/JakeCalkins/iina-quick-folders-plugin.git
cd iina-quick-folders-plugin
npm run verify
```

No `npm install` step is required because the project has no npm dependencies.

For live development, link the checkout with IINA's bundled plugin CLI:

```sh
npm run dev:link
```

The helper finds `iina-plugin` on `PATH` or inside `/Applications/IINA.app`; no global symlink is required. Restart IINA after backend changes. Run `npm run dev:unlink` when you no longer want the development plugin loaded.

## Development commands

| Command | Purpose |
| --- | --- |
| `npm test` | Run the Node test suite |
| `npm run check` | Check JavaScript syntax, the plugin manifest, browser references, documentation links, agent references, and high-confidence privacy patterns |
| `npm run package` | Build a tested `.iinaplgz` and SHA-256 checksum in `dist/` |
| `npm run verify` | Run all static checks, tests, and packaging |
| `npm run dev:link` / `npm run dev:unlink` | Add or remove the development plugin in IINA |
| `npm run release:prepare -- 2.3.0` | Update the manifest and promote Unreleased changelog notes for a release |

CI runs the checks on Node 20 and Node 24 for every pull request and push to `main`. Successful CI runs also expose a short-lived installable package under **Actions → run → Artifacts**.

## Code organization

```text
Info.json                    # Root manifest required by GitHub installation
main.js                     # IINA integration and backend orchestration
file-types.js               # Shared media classification
async-resource-loader.js    # Bounded backend worker queues
browse-state.js             # Pure shared browse/selection state
ui/                         # Standalone-window modules and styles
```

See [ARCHITECTURE.md](ARCHITECTURE.md) for runtime boundaries, module responsibilities, and invariants.

## Making a change

1. Branch from `main` and keep the branch focused on one feature or fix.
2. Prefer small functions and pure modules for behavior that can be tested outside IINA.
3. Add comments where they explain intent, constraints, or a non-obvious tradeoff.
4. Add or update tests for behavior changes.
5. Add user-visible changes to the appropriate `CHANGELOG.md` section.
6. Run `npm run verify`.
7. Exercise relevant behavior in IINA, including light/dark mode and the 500×600 default window when UI changes are involved.
8. Open a pull request and complete its test checklist.

## Manual regression checklist

Choose the relevant scenarios for your change:

- Add and remove folder roots; restart IINA and confirm persistence
- Navigate nested folders and return with both the back button and breadcrumbs
- Combine fuzzy search with file-extension filters
- Refresh a large index and confirm the UI remains responsive
- Verify single, toggle, range, and select-all behavior
- Mark watched/unwatched items and exercise the Watched view
- Open media and verify thumbnail and metadata loading
- Confirm delete behavior with both success and failure cases
- Test keyboard shortcuts, dialogs, focus restoration, and reduced motion
- Confirm the browser console and IINA logs contain no new errors

## Pull request expectations

- Explain the user problem and the resulting behavior.
- Include exact automated commands and manual scenarios tested.
- Link the issue with `Closes #123` when applicable.
- Call out migrations, permanent filesystem effects, or follow-up work.
- Keep commits readable; use present-tense summaries such as `Fix stale filter state`.

Maintainers may squash merge a pull request. GitHub release notes are grouped from pull-request labels, so accurate labels and titles matter.

## Releases

Maintainers should follow [docs/RELEASING.md](docs/RELEASING.md). Release tags are validated against both `Info.json` and `CHANGELOG.md`; a mismatch prevents publication.

## License

By contributing, you agree that your contributions will be licensed under the [GNU General Public License v3.0](LICENSE).
