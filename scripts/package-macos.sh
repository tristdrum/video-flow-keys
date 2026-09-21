#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
DERIVED_DATA="${VIDEO_FLOW_KEYS_DERIVED_DATA:-$ROOT_DIR/.build/deriveddata}"
CONFIGURATION="${VIDEO_FLOW_KEYS_CONFIGURATION:-Release}"
APP_SOURCE="$DERIVED_DATA/Build/Products/$CONFIGURATION/Video Flow Keys.app"
DIST_DIR="$ROOT_DIR/dist"
mkdir -p "$ROOT_DIR/.build"
STAGE_DIR="$(mktemp -d "$ROOT_DIR/.build/package.XXXXXX")"
trap 'rm -rf "$STAGE_DIR"' EXIT

VIDEO_FLOW_KEYS_DERIVED_DATA="$DERIVED_DATA" \
VIDEO_FLOW_KEYS_CONFIGURATION="$CONFIGURATION" \
  "$ROOT_DIR/scripts/build-macos.sh"

mkdir -p "$DIST_DIR"
ditto --norsrc --noextattr "$APP_SOURCE" "$STAGE_DIR/Video Flow Keys.app"
xattr -cr "$STAGE_DIR/Video Flow Keys.app"
codesign --verify --deep --strict --verbose=2 "$STAGE_DIR/Video Flow Keys.app"
ditto -c -k --keepParent --norsrc --noextattr "$STAGE_DIR/Video Flow Keys.app" "$DIST_DIR/Video-Flow-Keys.app.zip"

echo "Packaged $DIST_DIR/Video-Flow-Keys.app.zip"
