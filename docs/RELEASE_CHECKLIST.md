# Release Checklist

Use this before publishing a release.

```sh
npm run check
npm test
npm run sync:macos
npm run build:macos
npm run package:macos
codesign --verify --deep --strict --verbose=2 "${TMPDIR:-/tmp}/video-flow-keys-package/Video Flow Keys.app"
```

Then:

- Inspect `dist/Video Flow Keys.app.zip`.
- Confirm `web-extension/` and macOS extension resources match.
- Confirm Safari live smoke on YouTube.
- Create a GitHub Release.
- Upload `dist/Video Flow Keys.app.zip`.
