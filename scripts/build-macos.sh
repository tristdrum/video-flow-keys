#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
DERIVED_DATA="${VIDEO_FLOW_KEYS_DERIVED_DATA:-$ROOT_DIR/.build/deriveddata}"
CONFIGURATION="${VIDEO_FLOW_KEYS_CONFIGURATION:-Debug}"
BUILD_ARGS=(
  -project "$ROOT_DIR/macos/Video Flow Keys/Video Flow Keys.xcodeproj"
  -scheme "Video Flow Keys"
  -configuration "$CONFIGURATION"
  -derivedDataPath "$DERIVED_DATA"
  ENABLE_DEBUG_DYLIB=NO
)

if [[ "${VIDEO_FLOW_KEYS_UNSIGNED:-0}" == "1" ]]; then
  BUILD_ARGS+=(CODE_SIGNING_ALLOWED=NO CODE_SIGNING_REQUIRED=NO CODE_SIGN_IDENTITY=)
elif [[ -n "${VIDEO_FLOW_KEYS_DEVELOPMENT_TEAM:-}" ]]; then
  BUILD_ARGS+=(
    -allowProvisioningUpdates
    DEVELOPMENT_TEAM="$VIDEO_FLOW_KEYS_DEVELOPMENT_TEAM"
    CODE_SIGN_STYLE=Automatic
  )
fi

"$ROOT_DIR/scripts/sync-macos-extension.sh" --check
xcodebuild "${BUILD_ARGS[@]}" build

# Compiling should not replace the user's active Safari extension with this
# checkout's build product. Opening/installing the app registers it explicitly.
BUILT_EXTENSION="$DERIVED_DATA/Build/Products/$CONFIGURATION/Video Flow Keys.app/Contents/PlugIns/Video Flow Keys Extension.appex"
pluginkit -r "$BUILT_EXTENSION" 2>/dev/null || true
