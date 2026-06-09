# Contributing

Thanks for looking at Video Flow Keys.

## Local Checks

```sh
npm run check
npm test
```

For Safari wrapper changes, also run:

```sh
npm run sync:macos
npm run build:macos
```

## Pull Requests

- Keep the extension local-first and privacy-preserving.
- Do not add analytics, remote configuration, or network calls without a clear
  discussion first.
- Keep keyboard shortcuts predictable and avoid stealing focus from text inputs.
- Include manual Safari verification notes for user-facing changes.
