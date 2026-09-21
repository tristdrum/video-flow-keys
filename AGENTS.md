# Video Flow Keys

Small Safari Web Extension: plain JavaScript, Node's test runner, and a native
macOS wrapper. Prefer this architecture; add dependencies or a backend only when
the approved plan demonstrates a need.

## Ownership and checks

- Edit extension assets in `web-extension/`. The Xcode extension's `Resources/`
  directory is a committed mirror: run `npm run sync:macos` after source edits
  and commit both copies. Do not edit the mirror directly.
- New builds target macOS 12+. Sponsor analysis separately requires Safari 18+.
- `npm run verify` checks source syntax, Node tests, manifest/Xcode resources, and
  resource parity without rewriting source. `npm run test:native` exercises
  the Swift boundary. `npm run build:macos` builds the wrapper; set
  `VIDEO_FLOW_KEYS_UNSIGNED=1` for a build without signing or provisioning.
- Builds use worktree-local `.build/deriveddata`; avoid a shared temporary
  DerivedData path. Release steps and signing are in
  [docs/RELEASE_CHECKLIST.md](docs/RELEASE_CHECKLIST.md).
- Native credentials and TypeSafe requests belong in the Safari extension
  handler. A key may enter through the popup but must never be returned to
  JavaScript, stored in extension storage, logged, or bundled. Use synthetic
  test credentials in fixtures and the native request seam for offline tests.

## Playback invariants

- Preserve editable-input handling, user playback speed and mute state across
  YouTube ads, and keyboard behavior when no actionable video exists.
- Red Bull can place its video in an open shadow root while focus sits in an
  iframe. Keep shadow-root discovery and origin-checked shortcut relaying;
  ordinary top-document selectors do not cover that player.
- Sponsor skipping is opt-in, standard YouTube watch pages only, and requires
  Safari 18+. Failure, unavailable captions, and uncertain classifications must
  leave normal playback working. Recheck video identity and ad state before
  a seek; cancellation must prevent stale work affecting a new video.
- Preserve upstream attribution when adapting code. Keep settings defaults
  and normalization shared instead of duplicating them between UI and playback.

## Delivery

An approved plan authorizes implementation, validation, a normal PR, merge, and
the deployment targets specified in that plan. A separate user PR approval is
not required. Stop for a failed acceptance condition, external blocker, or
material scope change; report what remains.

Each plan must state its acceptance checks, deployment targets, and evidence of
completion. Done means merged and deployed to those targets, with the relevant
checks passing. Distinguish an uploaded build from one available in TestFlight.
Use [.agents/skills/safari-release/SKILL.md](.agents/skills/safari-release/SKILL.md)
for Safari installation and release work. Update affected guidance in the same
change when commands, ownership, or durable workflow rules change.
