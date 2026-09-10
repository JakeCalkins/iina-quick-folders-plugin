#!/usr/bin/env bash
set -euo pipefail

action="${1:-}"
if [[ "$action" != "link" && "$action" != "unlink" ]]; then
  echo "Usage: scripts/iina-plugin.sh <link|unlink>" >&2
  exit 1
fi

script_dir="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
repository_root="$(cd -- "$script_dir/.." && pwd)"
bundled_cli="/Applications/IINA.app/Contents/MacOS/iina-plugin"

if command -v iina-plugin >/dev/null 2>&1; then
  cli="$(command -v iina-plugin)"
elif [[ -x "$bundled_cli" ]]; then
  cli="$bundled_cli"
else
  echo "Could not find iina-plugin. Install IINA 1.4.0 or later in /Applications, or add iina-plugin to PATH." >&2
  exit 1
fi

cd -- "$repository_root"
exec "$cli" "$action" .
