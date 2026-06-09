# Privacy

Video Flow Keys is local-first.

## What It Stores

The extension stores only its own settings through Safari extension storage:

- Shortcut keys.
- Speed step.
- YouTube start speed.
- Whether to auto-apply YouTube start speed.
- Whether to click visible YouTube skip buttons.
- Whether to show the HUD.

## What It Does Not Do

- No analytics.
- No tracking.
- No telemetry.
- No external network calls.
- No remote code loading.
- No browsing-history collection.
- No page-content upload.

## Why It Requests Website Access

Safari extensions need website access to inspect and control page videos. Video
Flow Keys uses that access to find `<video>` elements, adjust playback rate, and
click YouTube skip buttons when they are visibly exposed by the page.
