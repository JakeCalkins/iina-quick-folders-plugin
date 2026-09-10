# Documentation guide

Documentation should help users install and operate the plugin before explaining implementation details.

## Writing rules

- Use concise task-oriented headings, numbered procedures for ordered work, and tables only when they improve scanning.
- Keep the recommended GitHub installation path first and the local package/development methods clearly separated.
- Use current public project URLs and portable example paths. Never include local usernames, absolute contributor paths, hostnames, logs, tokens, or private media names.
- Distinguish behavior available today from behavior that will begin with a future release.
- State permanent deletion and filesystem-permission implications plainly without alarmist language.
- Keep shortcuts, versions, settings names, commands, filenames, and release artifact names synchronized with code and workflows.
- Prefer focused documents over repeating the same detailed procedure in README, CONTRIBUTING, and support files; link to the canonical guide.
- Use relative links for repository files and verify every new local link with `npm run check`.

## Release documentation

- During development, add user-visible changes under `## [Unreleased]` using Added, Changed, Fixed, Deprecated, Removed, or Security categories as appropriate.
- Release notes should describe user impact, not commit mechanics.
- Do not claim a package, checksum, attestation, compatibility level, or release exists until the corresponding process supports it.
- Keep release examples obviously illustrative and ensure the tag format matches `vMAJOR.MINOR.PATCH`.
