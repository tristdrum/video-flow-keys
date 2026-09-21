# Release checklist

The approved plan defines acceptance checks and deployment targets. For the
sponsor-skipping release these are merged source, a verified signed local Safari
installation, and availability to the existing **Tech Local Core** TestFlight
group. Keep its tester roster unchanged. Public App Store submission is separate.

## Validate source

```sh
npm run sync:macos
npm run verify
npm run test:native
VIDEO_FLOW_KEYS_UNSIGNED=1 npm run build:macos
```

The first command deliberately updates the committed resource mirror; subsequent
checks are read-only against source. Commit source and mirror together. CI runs
the same verification plus native tests and an unsigned macOS build without
provisioning. Output is under this checkout's `.build/deriveddata`.

Before release, complete the approved plan's real Safari checks: ordinary
shortcuts, editable inputs, YouTube ad transitions with speed/mute restoration,
navigation, captions on/off/unavailable, heatmap, sponsor skip and undo. Exercise
Red Bull's shadow-root video and iframe focus when shared playback code changes.
Sponsor accuracy requires reviewed real sponsored videos and non-sponsored
controls; synthetic fixtures alone do not prove it.

## Version, sign, and merge

- Align package, manifest, app, and extension marketing versions. Inspect the
  existing App Store Connect app before choosing the next unused build number;
  keep app and extension build numbers identical.
- Preserve `com.tristdrum.VideoFlowKeys` and
  `com.tristdrum.VideoFlowKeys.Extension`, with the existing Tech Local signing
  team. Provide its team identifier through `VIDEO_FLOW_KEYS_DEVELOPMENT_TEAM`
  for signed local builds. Do not substitute an ad-hoc or personal identity.
- Publish a normal PR, complete its applicable checks and focused review, and
  merge when the plan's acceptance conditions pass. Another user approval is not
  required for the approved delivery. Build deliverables from the merged source.

## Install and verify locally

With the approved signing team configured:

```sh
npm run package:macos
```

This builds Release, stages in a unique temporary directory, verifies the staged
signature, and creates `dist/Video-Flow-Keys.app.zip`. It unregisters its own Xcode
build product and removes its staging directory on exit. The historical GitHub
`v0.1.0` asset is unsigned; do not apply that installation guidance to new signed
builds. An unsigned CI build is not an installable release receipt.

Preserve a known-good backup of the installed app, move the old bundle aside, and
copy the signed app to the now-absent `/Applications/Video Flow Keys.app` path.
Do not overlay-copy with `ditto` into an existing bundle: stale frameworks can
remain and invalidate its signature. Open the replacement and verify:

```sh
codesign --verify --deep --strict --verbose=2 "/Applications/Video Flow Keys.app"
codesign -dv --verbose=2 "/Applications/Video Flow Keys.app"
pluginkit -m -A -D -i com.tristdrum.VideoFlowKeys.Extension
```

Confirm the intended signing team and one intended Safari extension registration.
If signature verification fails, restore the known-good backup before continuing.
Xcode can register products in DerivedData; remove a duplicate with
`pluginkit -r` only after matching its exact task-owned path. Do not remove another
active worktree's registration or the user's working installation. Verify the
installed app in real Safari, including native key save/status/remove behavior;
do not capture the key in logs or screenshots.

## TestFlight and completion

Archive the merged build in Xcode using the existing App Store Connect signing
configuration, validate it, and upload it. Preserve the existing app record,
bundle identifiers, signing team, and **Tech Local Core** group. Update beta
notes and privacy information for optional title/caption analysis and BYOK;
submit for beta review when App Store Connect requires it.

Inspect processing, review, and group availability. An accepted upload is not
proof testers can install it. If Apple is still processing or reviewing, report
the pending state and use one temporary same-task follow-up to complete the
authorized distribution. Remove the follow-up when distribution is confirmed or
the blocker is handed off. Record the merged commit, checks, installed
version/build/signature, Safari evidence, and TestFlight availability in the
release receipt; do not claim completion while a required target is pending.
