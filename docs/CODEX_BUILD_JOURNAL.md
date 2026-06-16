# Codex Build Journal

Video Flow Keys was built end to end with Codex.

This is a sanitized public archive. The raw working thread included local
machine context, browser tabs, account UI, and private workflow details, so the
public record is intentionally a narrative rather than a transcript dump.

## Origin

The goal was to recreate the old Dynamo Safari extension workflow:

- `S` for slower.
- `D` for default.
- `F` for faster.
- `E` for skipping ads.
- Fast YouTube playback by default.
- A visible speed overlay so YouTube's native menu does not need to be the source
  of truth.

## Build Notes

- Codex researched the old workflow and Safari Web Extension constraints.
- Codex scaffolded a local Safari Web Extension and generated the macOS wrapper.
- Codex implemented video detection, keyboard shortcuts, YouTube-specific start
  speed, visible skip-button handling, and a glass speed HUD.
- Codex fixed the important `D` behavior so it resets playback to `1x`, while
  YouTube start speed remains separately configurable.
- Codex installed the app locally, enabled it in Safari, and verified it live on
  YouTube.

## Verification Snapshot

The verified local behavior before publication:

- YouTube auto-start HUD displayed `2x`.
- `D` displayed `1x`.
- `F` displayed `1.1x`.
- `S` displayed `1x`.
- The HUD appeared in the lower-left of the video above the control bar.
- `npm run check` passed.
- `npm test` passed with 5 tests.
- The installed app bundle passed deep code-sign verification.

## Why Not Publish The Raw Transcript?

The raw thread is not included because it may contain:

- Personal browser tabs.
- Local machine paths outside this repository.
- Account and authentication context.
- Screenshots that include private UI.
- Operational details unrelated to the extension.

The repo keeps the useful technical history while protecting everything else.
