#!/usr/bin/env bash
set -euo pipefail

release_tag="${RELEASE_TAG:?RELEASE_TAG is required}"
version="${VERSION:?VERSION is required}"
repository="${GITHUB_REPOSITORY:?GITHUB_REPOSITORY is required}"
archive="dist/quick-folders-v${version}.iinaplgz"
checksum="${archive}.sha256"

for file in "$archive" "$checksum"; do
  if [[ ! -f "$file" ]]; then
    echo "Release asset not found: $file" >&2
    exit 1
  fi
done

assets=(
  "$archive#Quick Folders ${version}"
  "$checksum#SHA-256 checksum"
)

if gh release view "$release_tag" --repo "$repository" >/dev/null 2>&1; then
  echo "Release $release_tag already exists; replacing its verified assets."
  gh release upload "$release_tag" "${assets[@]}" \
    --repo "$repository" \
    --clobber
else
  gh release create "$release_tag" "${assets[@]}" \
    --repo "$repository" \
    --verify-tag \
    --fail-on-no-commits \
    --title "Quick Folders v${version}" \
    --notes $'## Installation\n\nDownload the `.iinaplgz` file below and open it with IINA. You can also install from the GitHub repository URL to receive updates.\n' \
    --generate-notes
fi
