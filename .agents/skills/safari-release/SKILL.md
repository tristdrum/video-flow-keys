---
name: safari-release
description: Build, verify, install, and distribute this repository's macOS Safari extension, including signed local installs and its existing private TestFlight group.
---

# Safari release

Use [the release checklist](../../../docs/RELEASE_CHECKLIST.md) for commands and
delivery proof, and [installation guidance](../../../docs/INSTALL.md) for Safari
enablement. Apply the current approved plan's acceptance checks and targets;
it already authorizes its PR, merge, and deployment without another approval.

- `web-extension/` is canonical. Sync before verification; builds deliberately
  fail on a stale committed resource mirror instead of silently changing it.
- Use the configured Tech Local signing identity and preserve the existing
  app and extension bundle identifiers. An unsigned CI build proves compilation,
  not Safari installation or TestFlight eligibility.
- Native Keychain access needs the extension's own provisioned access group;
  use the signed Keychain smoke in the release checklist to verify persistence.
- Replace the installed app bundle as a whole, preserving a known-good backup.
  Overlay-copying leaves stale frameworks that can invalidate its signature;
  restore the backup if verification fails.
- Xcode may register its build product with Safari. Inspect registrations with
  `pluginkit -m -A -D -i com.tristdrum.VideoFlowKeys.Extension`. After installing
  the intended copy, unregister only task-owned build/staging copies by their
  exact path. Do not remove another checkout or the user's working app blindly.
- Use real Safari for playback proof. Red Bull's video can live inside an open
  shadow root with keyboard focus in a child frame; exercise both paths when
  changing shared playback logic. YouTube checks must cover ad transitions,
  navigation, captions on/off, sponsor undo, and ordinary controls.
- A TestFlight upload is not distribution proof. Inspect the existing app,
  choose an unused build number, retain the existing beta-group roster, and
  verify the approved build is available to that group. Report Apple processing
  or review as pending, and use one temporary task follow-up when authorized.

Keep credentials out of commands, logs, screenshots, repository files, and app
assets. A developer `TYPESAFE_API_KEY` is for an explicitly authorized live check;
the shipped app accepts each user's own key through its popup and native Keychain.
