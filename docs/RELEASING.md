# Release process

Releases are built and published by GitHub Actions. The release workflow tests the tagged source, validates version metadata, builds the package without downloading IINA, publishes a checksum, creates a provenance attestation, and generates categorized GitHub release notes.

## Prepare a release

1. Start from an up-to-date `main` branch with a clean working tree.
2. Choose the next [semantic version](https://semver.org/).
3. Promote the Unreleased changelog and update `Info.json`:

   ```sh
   npm run release:prepare -- 2.3.0
   ```

4. Review `CHANGELOG.md`. Replace `_No unreleased changes yet._` as new work accumulates; make sure the promoted release notes are accurate and user-focused.
5. Run the same verification used by CI:

   ```sh
   npm run verify
   ```

6. Commit the release preparation through a pull request and merge it.

Do not create a tag until the release-preparation commit is on `main`.
Do not create a GitHub release manually: the tag-triggered workflow creates it only after the package and checksum pass validation. `release:prepare` also increments IINA's integer `ghVersion` update counter.

If a release is created manually while the tag workflow is still running, the workflow detects it and safely replaces its package and checksum instead of leaving an empty release.

## Publish

Create and push an annotated tag that exactly matches the manifest version:

```sh
git switch main
git pull --ff-only
git tag -a v2.3.0 -m "Quick Folders v2.3.0"
git push origin v2.3.0
```

The **Release** workflow then:

1. Verifies that the tag, `Info.json`, and a dated changelog section agree.
2. Runs validation and the complete automated test suite.
3. Builds `dist/quick-folders-v<version>.iinaplgz` and its SHA-256 checksum.
4. Creates a signed GitHub build-provenance attestation for the package.
5. Publishes a GitHub release with categorized, automatically generated notes.
6. Downloads the published assets again, verifies their checksum, and validates the package using IINA's root-layout requirements.

If validation fails, fix the source on `main` and create a new version. Do not move a published release tag.

## Verify the published release

- Confirm the workflow is green and the release is marked **Latest**.
- Download the package and open it with IINA.
- Confirm the version shown by IINA matches the release.
- Verify the checksum:

  ```sh
  shasum -a 256 -c quick-folders-v*.iinaplgz.sha256
  ```

- Verify build provenance:

  ```sh
  gh attestation verify quick-folders-v*.iinaplgz --repo JakeCalkins/iina-quick-folders-plugin
  ```

## Pull-request labels

GitHub groups generated release notes using `.github/release.yml`:

- `feature` or `enhancement` → New features
- `bug` or `fix` → Fixes
- `documentation`, `maintenance`, `dependencies`, or `github-actions` → Documentation and maintenance
- `skip-changelog` → Excluded from generated notes

Apply at least one accurate category label before merging.
