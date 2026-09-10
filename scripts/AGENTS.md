# Repository tooling guide

These scripts provide the dependency-free local and CI workflow. Keep them portable across macOS development machines and GitHub's Ubuntu runners.

## Script rules

- Bash scripts use `#!/usr/bin/env bash` and `set -euo pipefail`; quote paths and resolve the repository relative to the script.
- Do not assume a contributor username, home path, Homebrew prefix, shell profile, or globally linked IINA CLI.
- Check required commands and return concise actionable errors.
- Destructive cleanup may target only an exact generated file inside `dist/`; never delete broad or unresolved paths.
- Keep packaging offline and reproducible in file selection/order. The archive contains only runtime files from `quick-folders.iinaplugin/`; exclude contributor-only `AGENTS.md` and `CLAUDE.md` files.
- Generate and verify the SHA-256 checksum alongside the package.
- Release preparation validates every precondition before writing either `Info.json` or `CHANGELOG.md`; reject invalid, duplicate, or non-increasing versions.
- Use `RELEASE_DATE=YYYY-MM-DD` only when a maintainer needs an explicit release date.

## Validation

- `check.mjs` must remain dependency-free, cross-platform, and read-only.
- Add a validation when it prevents a plausible broken package, missing browser dependency, invalid manifest, or dead local documentation link.
- Keep the privacy checks high-confidence and allow only explicitly fictional home paths; avoid patterns that flag ordinary code or GitHub expressions.
- Avoid regex checks that produce false positives on ordinary prose or platform-generated syntax.
- Run `shellcheck scripts/*.sh`, `node --check scripts/*.mjs`, and `npm run verify` after tooling changes.
- Test release preparation in a temporary fixture; do not alter real release files merely to exercise failure cases.
