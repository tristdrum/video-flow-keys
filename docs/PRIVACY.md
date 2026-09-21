# Privacy

Video Flow Keys keeps playback settings locally. Sponsor analysis is optional
and off by default.

## Local storage

Safari extension storage holds shortcut keys, speed settings, YouTube start/ad
behavior, HUD preferences, and whether sponsor skipping is enabled. The native
extension stores a user-supplied TypeSafe API key in macOS Keychain. It returns
only key-presence status to the popup, never the saved key.

Use **Remove key** in the popup to delete that Keychain entry; uninstalling the
app does not necessarily remove Keychain data. Disabling sponsor skipping stops
analysis without deleting the key or changing ordinary controls.

## Optional TypeSafe analysis

When sponsor skipping is enabled on a supported YouTube watch page, the native
extension sends that video's title and caption segments over HTTPS directly to
`https://api.typesafe.ai/v1/systemone`, authenticated with your API key. It uses
the pinned `jev-1.13.0` model to estimate sponsor probabilities. Your browser also
obtains captions from YouTube using the player's authorized caption request.

There is no Video Flow Keys server or shared API key. TypeSafe receives the
request data and normal connection metadata such as your IP address; its service
terms and privacy practices apply. Analysis can consume your TypeSafe account's
quota. No audio, video files, cookies, general browsing history, or unrelated page
contents are sent for classification.

## What the extension does not do

- No analytics, tracking pixels, or telemetry.
- No remote code loading or remote configuration.
- No classification requests when sponsor skipping is disabled.
- No key values in extension storage, content-script messages, or app logs.

## Permissions

Broad website access allows generic `<video>` discovery, playback-rate changes,
and supported player controls. Sponsor analysis is limited to standard YouTube
watch pages. Native messaging connects the popup and background coordinator to
the installed macOS extension for Keychain operations and TypeSafe requests.
