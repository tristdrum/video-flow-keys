# Install Video Flow Keys

## Signed app and private TestFlight beta

Version 1.1.0 and newer require macOS 12 or newer. Sponsor skipping additionally
requires Safari 18 or newer; ordinary playback controls remain independent.

Existing private beta testers can install the available build in TestFlight.
For a signed local app, replace `Video Flow Keys.app` in `/Applications` and open it.
Then open **Safari → Settings → Extensions**, enable **Video Flow Keys**, and
grant website access. Signed installations do not need Safari's unsigned
extensions setting.

When updating a local build, preserve the known-good app first and replace the
whole bundle. Do not copy a new bundle over the existing directory: leftover
frameworks can invalidate its signature. Verify the replacement using the
[release checklist](RELEASE_CHECKLIST.md) and restore the backup if verification
fails.

If the extension is missing, open the installed app and restart Safari. If Safari
shows duplicate entries after development builds, use the targeted registration
steps in [the release checklist](RELEASE_CHECKLIST.md); preserve the installed
app and other active worktrees.

## Historical unsigned GitHub release

The GitHub `v0.1.0` `Video-Flow-Keys.app.zip` is the original unsigned release.
Unzip it, move the app to `/Applications`, and open it. Enable **Allow unsigned
extensions** in Safari's Developer settings before enabling the extension. This
release contains the original playback controls, not sponsor analysis.

## Use

Click a video once so its page has focus, then use:

- `S` to slow down.
- `D` to reset to `1x`.
- `F` to speed up.
- `E` to bypass a supported YouTube ad.

The popup controls speed defaults, shortcut keys, ad bypass, and the playback
HUD. Text inputs keep normal typing behavior.

## Optional sponsor skipping

Requires Safari 18 or newer and a standard YouTube watch page with usable
captions. Open the extension popup, enter your own TypeSafe API key, save it, and
enable **Skip sponsors**. Read the [privacy note](PRIVACY.md): this sends the
current video's title and captions to TypeSafe and can use your API quota.

The timeline heatmap shows estimated sponsor probability. Segments meeting the
automatic-skip threshold are skipped with an **Undo** action. Undo returns to
the skipped point and permits that segment to play in the current viewing
session. Manually replaying a skipped segment also avoids an immediate skip loop.

Unavailable captions, live streams, unsupported Safari versions, or analysis
errors leave playback controls working. Disable **Skip sponsors** to stop
analysis, or use **Remove key** to delete the native Keychain entry.
