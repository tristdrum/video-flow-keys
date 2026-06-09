#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
DERIVED_DATA="${TMPDIR:-/tmp}/video-flow-keys-deriveddata"
APP_SOURCE="$DERIVED_DATA/Build/Products/Debug/Video Flow Keys.app"
DIST_DIR="$ROOT_DIR/dist"
STAGE_DIR="${TMPDIR:-/tmp}/video-flow-keys-package"

"$ROOT_DIR/scripts/sync-macos-extension.sh"
xcodebuild -project "$ROOT_DIR/macos/Video Flow Keys/Video Flow Keys.xcodeproj" \
  -scheme "Video Flow Keys" \
  -configuration Debug \
  -derivedDataPath "$DERIVED_DATA" \
  ENABLE_DEBUG_DYLIB=NO \
  build

mkdir -p "$DIST_DIR"
rm -rf "$STAGE_DIR"
mkdir -p "$STAGE_DIR"
ditto --norsrc --noextattr "$APP_SOURCE" "$STAGE_DIR/Video Flow Keys.app"
xattr -cr "$STAGE_DIR/Video Flow Keys.app"
codesign --verify --deep --strict --verbose=2 "$STAGE_DIR/Video Flow Keys.app"
ditto -c -k --keepParent --norsrc --noextattr "$STAGE_DIR/Video Flow Keys.app" "$DIST_DIR/Video-Flow-Keys.app.zip"

echo "Packaged $DIST_DIR/Video-Flow-Keys.app.zip"
