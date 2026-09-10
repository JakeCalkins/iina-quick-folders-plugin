# GitHub automation guide

Files here define public contribution forms, ownership, dependency updates, release-note grouping, and CI/release workflows.

## Workflow rules

- Grant the default `GITHUB_TOKEN` read-only access and elevate permissions only on the job that needs them.
- Pin third-party and GitHub-maintained actions to immutable full commit SHAs with a major-version comment; Dependabot maintains these references.
- Set explicit timeouts and concurrency behavior for every workflow.
- CI must run on pull requests and `main`, exercise the oldest supported Node release and the current project baseline, and publish one installable artifact.
- Do not run untrusted pull-request code with write credentials. Treat `pull_request_target`, `workflow_run`, and script interpolation from event data as security-sensitive.
- Keep release publication tag-triggered. Validate the tag, `Info.json` version, and dated changelog section before granting publication steps.
- Release packages must include a checksum and provenance attestation before `gh release create` publishes them.
- Prefer the preinstalled GitHub CLI and official actions over an unnecessary third-party release action.

## Community files

- Keep issue forms short, actionable, and privacy-aware. Ask for versions, reproduction steps, and installation method.
- Use labels that exist in the repository and match `.github/release.yml` categories.
- Keep the pull-request template focused on behavior, evidence, tests, docs, and issue linkage.
- CODEOWNERS should identify maintainers by public GitHub identity only.

## Verification

- Run `actionlint` when available.
- Parse all YAML after structural edits and confirm Dependabot validation on the pull request.
- After pushing CI changes, inspect the live checks and download/verify the produced package rather than relying only on local validation.
