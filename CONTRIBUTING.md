# Contributing

Video Flow Keys uses plain JavaScript, Node's built-in test runner, and a macOS
Safari wrapper. No dependency installation is needed for the standard checks.

## Local Checks

```sh
npm run verify
```

Edit `web-extension/`, then synchronize the committed Xcode resource mirror
before running verification. `verify` and `build:macos` only check parity;
they do not repair it. On macOS with Xcode, also run native checks:

```sh
npm run sync:macos
npm run verify
npm run test:native
VIDEO_FLOW_KEYS_UNSIGNED=1 npm run build:macos
```

Build output is isolated under `.build/` per checkout. Use the
[release checklist](docs/RELEASE_CHECKLIST.md) for signed installation and
distribution. For shared playback changes, exercise editable inputs, YouTube ad
transitions, and Red Bull's shadow-root/iframe player in addition to Node tests.

## Changes and delivery

- Keep the extension local-first and privacy-preserving.
- Sponsor analysis is opt-in and limited to TypeSafe. Keep keys in the native
  Keychain boundary and validate sender identity and request limits there.
- Do not add analytics, remote configuration, or new external services as
  incidental changes.
- Keep keyboard shortcuts predictable and avoid stealing focus from text inputs.
- Include manual Safari verification notes for user-facing changes.

For maintainer-directed agent work, the approved plan authorizes its
implementation, normal PR, validation, merge, and named deployments; it does not
need another maintainer PR approval. Each plan must specify acceptance checks,
deployment targets, and evidence of completion. A failed check, external blocker,
or material scope change must be resolved or reported before claiming completion.
