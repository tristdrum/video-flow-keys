#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
SOURCE_DIR="$ROOT_DIR/web-extension"
TARGET_DIR="$ROOT_DIR/macos/Video Flow Keys/Video Flow Keys Extension/Resources"

mkdir -p "$TARGET_DIR"
rsync -a --delete "$SOURCE_DIR/" "$TARGET_DIR/"
xattr -cr "$TARGET_DIR"

echo "Synced web-extension resources into macOS wrapper."
