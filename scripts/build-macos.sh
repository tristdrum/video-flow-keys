#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
DERIVED_DATA="${VIDEO_FLOW_KEYS_DERIVED_DATA:-${TMPDIR:-/tmp}/video-flow-keys-deriveddata}"
CONFIGURATION="${VIDEO_FLOW_KEYS_CONFIGURATION:-Debug}"
SIGNING_ARGS=()
PROVISIONING_ARGS=()

if [[ -n "${VIDEO_FLOW_KEYS_DEVELOPMENT_TEAM:-}" ]]; then
  PROVISIONING_ARGS+=("-allowProvisioningUpdates")
  SIGNING_ARGS+=(
    DEVELOPMENT_TEAM="$VIDEO_FLOW_KEYS_DEVELOPMENT_TEAM"
    CODE_SIGN_STYLE=Automatic
  )
fi

"$ROOT_DIR/scripts/sync-macos-extension.sh"
xcodebuild -project "$ROOT_DIR/macos/Video Flow Keys/Video Flow Keys.xcodeproj" \
  -scheme "Video Flow Keys" \
  -configuration "$CONFIGURATION" \
  -derivedDataPath "$DERIVED_DATA" \
  "${PROVISIONING_ARGS[@]}" \
  ENABLE_DEBUG_DYLIB=NO \
  "${SIGNING_ARGS[@]}" \
  build
