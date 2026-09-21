# Security Policy

Video Flow Keys is a Safari extension with local playback controls and optional
TypeSafe sponsor analysis. When enabled, analysis transmits only the current
supported YouTube video's title and captions, using the user's own API key.

Please report security issues through GitHub private vulnerability reporting if
available on the repository. If not, open a minimal public issue that describes
the impact without posting sensitive proof-of-concept data.

Security-sensitive changes should preserve these defaults:

- No analytics.
- No remote code loading.
- Sponsor analysis is off by default; native HTTPS requests use the fixed
  TypeSafe endpoint with bounded input and validated responses.
- Keys remain in macOS Keychain after entry and are never returned to JavaScript,
  logged, committed, or bundled. Native operations validate their callers.
- No browsing-history collection or unrelated page-content upload.
