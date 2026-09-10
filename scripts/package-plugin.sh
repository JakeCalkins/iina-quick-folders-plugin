#!/usr/bin/env bash
set -euo pipefail

script_dir="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
repository_root="$(cd -- "$script_dir/.." && pwd)"
plugin_dir="$repository_root/quick-folders.iinaplugin"
output_dir="${1:-$repository_root/dist}"

for command in node zip unzip; do
  if ! command -v "$command" >/dev/null 2>&1; then
    echo "Required command not found: $command" >&2
    exit 1
  fi
done

version="$(node -p "JSON.parse(require('fs').readFileSync('$plugin_dir/Info.json', 'utf8')).version")"
mkdir -p "$output_dir"
output_dir="$(cd -- "$output_dir" && pwd)"
archive="$output_dir/quick-folders-v${version}.iinaplgz"
checksum="$archive.sha256"

rm -f -- "$archive" "$checksum"
(
  cd -- "$plugin_dir"
  find . -type f ! -name '.DS_Store' -print \
    | LC_ALL=C sort \
    | sed 's#^\./##' \
    | zip -q -X "$archive" -@
)
unzip -tq "$archive"

if command -v shasum >/dev/null 2>&1; then
  (cd -- "$output_dir" && shasum -a 256 "$(basename -- "$archive")" > "$(basename -- "$checksum")")
else
  (cd -- "$output_dir" && sha256sum "$(basename -- "$archive")" > "$(basename -- "$checksum")")
fi

echo "Created $archive"
echo "Created $checksum"
