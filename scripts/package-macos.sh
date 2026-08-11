#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
DERIVED_DATA="${VIDEO_FLOW_KEYS_DERIVED_DATA:-${TMPDIR:-/tmp}/video-flow-keys-deriveddata}"
CONFIGURATION="${VIDEO_FLOW_KEYS_CONFIGURATION:-Release}"
APP_SOURCE="$DERIVED_DATA/Build/Products/$CONFIGURATION/Video Flow Keys.app"
DIST_DIR="$ROOT_DIR/dist"
STAGE_DIR="${TMPDIR:-/tmp}/video-flow-keys-package"

VIDEO_FLOW_KEYS_DERIVED_DATA="$DERIVED_DATA" \
VIDEO_FLOW_KEYS_CONFIGURATION="$CONFIGURATION" \
  "$ROOT_DIR/scripts/build-macos.sh"

mkdir -p "$DIST_DIR"
rm -rf "$STAGE_DIR"
mkdir -p "$STAGE_DIR"
ditto --norsrc --noextattr "$APP_SOURCE" "$STAGE_DIR/Video Flow Keys.app"
xattr -cr "$STAGE_DIR/Video Flow Keys.app"
codesign --verify --deep --strict --verbose=2 "$STAGE_DIR/Video Flow Keys.app"
ditto -c -k --keepParent --norsrc --noextattr "$STAGE_DIR/Video Flow Keys.app" "$DIST_DIR/Video-Flow-Keys.app.zip"

# xcodebuild registers its product for local development. A packaged install must
# be the only registered copy or Safari can show duplicate extension entries.
pluginkit -r "$APP_SOURCE/Contents/PlugIns/Video Flow Keys Extension.appex" 2>/dev/null || true

echo "Packaged $DIST_DIR/Video-Flow-Keys.app.zip"
