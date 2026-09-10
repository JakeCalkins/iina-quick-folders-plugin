#!/usr/bin/env bash
set -euo pipefail

script_dir="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
repository_root="$(cd -- "$script_dir/.." && pwd)"
output_dir="${1:-$repository_root/dist}"

for command in node zip unzip; do
  if ! command -v "$command" >/dev/null 2>&1; then
    echo "Required command not found: $command" >&2
    exit 1
  fi
done

version="$(node -p "JSON.parse(require('fs').readFileSync('$repository_root/Info.json', 'utf8')).version")"
mkdir -p "$output_dir"
output_dir="$(cd -- "$output_dir" && pwd)"
archive="$output_dir/quick-folders-v${version}.iinaplgz"
checksum="$archive.sha256"

rm -f -- "$archive" "$checksum"
(
  cd -- "$repository_root"
  {
    find . -maxdepth 1 -type f \
      \( -name 'Info.json' -o -name '*.js' -o -name '*.html' -o -name '*.css' \) \
      -print
    find ./ui -type f \
      ! -name 'AGENTS.md' \
      ! -name 'CLAUDE.md' \
      -print
  } \
    | LC_ALL=C sort \
    | sed 's#^\./##' \
    | zip -q -X "$archive" -@
)
unzip -tq "$archive"
node "$script_dir/verify-plugin-package.mjs" "$archive"

while IFS= read -r entry; do
  case "$entry" in
    AGENTS.md|CLAUDE.md|*/AGENTS.md|*/CLAUDE.md)
      echo "Contributor instruction file was included in the package: $entry" >&2
      exit 1
      ;;
  esac
done < <(unzip -Z1 "$archive")

if command -v shasum >/dev/null 2>&1; then
  (cd -- "$output_dir" && shasum -a 256 "$(basename -- "$archive")" > "$(basename -- "$checksum")")
else
  (cd -- "$output_dir" && sha256sum "$(basename -- "$archive")" > "$(basename -- "$checksum")")
fi

echo "Created $archive"
echo "Created $checksum"
