# Video Flow Keys

Video Flow Keys is a small Safari Web Extension for fast video playback control
and optional YouTube sponsor skipping.
It was built end to end with Codex after I missed the old Dynamo Safari workflow.

![Video Flow Keys HUD demo](docs/assets/demo-hud.svg)

## Shortcuts

| Key | Action |
| --- | --- |
| `S` | Slow the active video by the configured step. |
| `D` | Reset the active video to `1x`. |
| `F` | Speed the active video up by the configured step. |
| `E` | Bypass the current YouTube ad. |

On YouTube, videos start at `2x` by default. The popup lets you change the
start speed, step size, YouTube auto-start behavior, ad bypass behavior, and the
speed HUD.

## Sponsor skipping

On Safari 18 or newer, enable **Skip sponsors** in the popup and save your own
[TypeSafe](https://typesafe.ai/) API key. This opt-in feature sends the current
YouTube video's title and captions to TypeSafe for analysis. Your key is kept in
macOS Keychain by the native extension; it is not bundled or kept in browser storage.

The seek bar shows sponsor probabilities. High-probability sponsor segments are
skipped automatically, with **Undo** to return to the skipped point. Replaying a
skipped segment does not immediately skip it again. Missing captions, live
streams, and failed or uncertain analysis leave normal playback working.
Automatic skips leave the first and last caption cue of each detected sponsor
run playing to reduce boundary mistakes; very short runs stay unskipped. The
heatmap still shows the model's original probabilities. Detection can miss
sponsors or be wrong, so Undo remains available.

Sponsor analysis supports standard YouTube watch pages. Existing video controls
continue to work independently. See [privacy details](docs/PRIVACY.md) before
enabling analysis.

## Install

Private beta testers install the signed app through TestFlight. Signed local
builds can also be installed in `/Applications`, opened, and enabled in
**Safari → Settings → Extensions**. Grant website access when Safari asks.

The historical GitHub `v0.1.0` app zip is unsigned and additionally needs Safari's
**Allow unsigned extensions** developer setting. It does not contain sponsor
skipping. A signed local build or TestFlight installation follows the current
instructions below.

See [docs/INSTALL.md](docs/INSTALL.md) for the longer version.

## Build From Source

Requirements:

- macOS 12 or newer with Safari (Safari 18+ for sponsor skipping)
- Xcode
- Node.js 20 or newer

```sh
npm run sync:macos
npm run verify
npm run test:native
VIDEO_FLOW_KEYS_UNSIGNED=1 npm run build:macos
```

The Xcode project lives in `macos/Video Flow Keys/`. Build output stays in this
checkout's `.build/deriveddata`. This unsigned build is a compilation check;
see [the release checklist](docs/RELEASE_CHECKLIST.md) for signed installation
and TestFlight delivery.

## Privacy

Video Flow Keys stores settings locally through Safari extension storage and has
no analytics or tracking pixels. Optional sponsor analysis sends the current
video title and captions directly to TypeSafe using your own API key. Broad
website access supports playback controls on generic `<video>` elements.

Read the full privacy note in [docs/PRIVACY.md](docs/PRIVACY.md).

## Codex Build Archive

This project was vibe-coded with Codex from idea to working Safari extension:
research, implementation, testing, install, live Safari verification, and repo
prep. The public archive is sanitized so personal tabs, local machine details,
account context, and secrets stay private.

Read it in [docs/CODEX_BUILD_JOURNAL.md](docs/CODEX_BUILD_JOURNAL.md).

Development and delivery expectations are in [CONTRIBUTING.md](CONTRIBUTING.md).
