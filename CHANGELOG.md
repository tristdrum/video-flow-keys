# Changelog

## v1.1.0 - Unreleased

- Added opt-in YouTube sponsor analysis with a probability heatmap, automatic
  skipping, and undo, inspired by `jev-skip`.
- Added bring-your-own TypeSafe key storage in macOS Keychain and bounded native
  requests using `jev-1.13.0`. Sponsor analysis requires Safari 18 or newer.
- Added shared settings normalization, sponsor regression coverage, native
  tests, read-only resource verification, and an unsigned macOS CI build.
- Documented signed local and private TestFlight delivery, with isolated build
  and packaging output for parallel checkouts.

## v0.1.0 - 2026-06-09

- Added Safari Web Extension for Dynamo-style video speed shortcuts.
- Added `S`, `D`, `F`, and `E` keyboard controls.
- Added YouTube start-speed behavior with `2x` default.
- Added visible lower-left glass HUD for playback speed feedback.
- Added visible YouTube skip-button handling.
- Added popup controls for start speed, step, YouTube behavior, and HUD.
- Verified live in Safari on YouTube.
