#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
TEST_DIR="$(mktemp -d "${TMPDIR:-/tmp}/video-flow-keys-native-tests.XXXXXX")"
trap 'rm -rf "$TEST_DIR"' EXIT
NATIVE_DIR="$ROOT_DIR/macos/Video Flow Keys/Video Flow Keys Extension"
TEST_FRAMEWORKS="$(xcrun --show-sdk-platform-path)/Developer/Library/Frameworks"
# Xcode 26's XCTest support dylib needs this explicit path for XCTestCore.
TEST_PRIVATE_FRAMEWORKS="$(xcrun --show-sdk-platform-path)/Developer/Library/PrivateFrameworks"
TEST_LIBRARIES="$(xcrun --show-sdk-platform-path)/Developer/usr/lib"

xcrun swiftc -swift-version 5 \
  -F "$TEST_FRAMEWORKS" -Xlinker -rpath -Xlinker "$TEST_FRAMEWORKS" \
  -I "$TEST_LIBRARIES" -L "$TEST_LIBRARIES" -lXCTestSwiftSupport \
  -Xlinker -rpath -Xlinker "$TEST_LIBRARIES" \
  -Xlinker -rpath -Xlinker "$TEST_PRIVATE_FRAMEWORKS" \
  "$NATIVE_DIR/TypeSafeService.swift" \
  "$NATIVE_DIR/TypeSafeKeychain.swift" \
  "$ROOT_DIR/test/native/main.swift" \
  -o "$TEST_DIR/native-tests"

if [[ -n "${VIDEO_FLOW_KEYS_SIGNED_EXTENSION:-}" ]]; then
  # Optional local smoke. Use the existing extension's own development profile;
  # the test creates and removes a synthetic item under a unique service name.
  EXTENSION="$VIDEO_FLOW_KEYS_SIGNED_EXTENSION"
  codesign --verify --strict "$EXTENSION"
  test -f "$EXTENSION/Contents/embedded.provisionprofile"
  TEST_APP="$TEST_DIR/NativeTests.app"
  mkdir -p "$TEST_APP/Contents/MacOS"
  mv "$TEST_DIR/native-tests" "$TEST_APP/Contents/MacOS/native-tests"
  cp "$EXTENSION/Contents/embedded.provisionprofile" "$TEST_APP/Contents/embedded.provisionprofile"
  codesign -d --entitlements :- "$EXTENSION" > "$TEST_DIR/entitlements.plist" 2>/dev/null
  SIGNING_IDENTITY="$(codesign -dvv "$EXTENSION" 2>&1 | sed -n 's/^Authority=//p' | head -1)"
  test -n "$SIGNING_IDENTITY"
  cat > "$TEST_APP/Contents/Info.plist" <<'PLIST'
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
<key>CFBundleIdentifier</key><string>com.tristdrum.VideoFlowKeys.Extension</string>
<key>CFBundleExecutable</key><string>native-tests</string>
<key>CFBundlePackageType</key><string>APPL</string>
</dict></plist>
PLIST
  codesign --force --sign "$SIGNING_IDENTITY" --entitlements "$TEST_DIR/entitlements.plist" "$TEST_APP"
  VIDEO_FLOW_KEYS_KEYCHAIN_SMOKE=1 "$TEST_APP/Contents/MacOS/native-tests"
else
  "$TEST_DIR/native-tests"
fi
