#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
SOURCE_DIR="$ROOT_DIR/web-extension"
TARGET_DIR="$ROOT_DIR/macos/Video Flow Keys/Video Flow Keys Extension/Resources"

if [[ "${1:-}" == "--check" ]]; then
  if ! diff -qr "$SOURCE_DIR" "$TARGET_DIR"; then
    echo "macOS resources are stale. Run npm run sync:macos and commit both copies." >&2
    exit 1
  fi
  echo "macOS extension resources match their source."
  exit 0
fi

if [[ $# -ne 0 ]]; then
  echo "Usage: $0 [--check]" >&2
  exit 2
fi

mkdir -p "$TARGET_DIR"
rsync -a --delete "$SOURCE_DIR/" "$TARGET_DIR/"
if command -v xattr >/dev/null 2>&1; then
  xattr -cr "$TARGET_DIR"
fi

echo "Synced web-extension resources into macOS wrapper."
