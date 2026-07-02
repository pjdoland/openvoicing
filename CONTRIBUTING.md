# Contributing to OpenVoicing

Thanks for your interest. OpenVoicing is an open, self-hostable "living sheet
music" platform built around an open file format. Contributions of all sizes
are welcome.

## Your first PR in 15 minutes

```sh
git clone <your-fork-url> && cd openvoicing
pnpm install
pnpm dev            # the app at http://localhost:5173
```

In another terminal, the checks that CI runs:

```sh
pnpm test           # unit tests (vitest) across packages
pnpm typecheck      # strict TypeScript
pnpm build          # production build
```

A good first change: pick a small item, make it, and add or update a test.
The packages are small and independent:

- `packages/score-model` — the document format, importers/exporters, sync math.
  Pure functions, easy to test. Start here.
- `packages/audio-engine` — time-stretch, onset detection, waveform peaks.
- `packages/player` — the alphaTab wrapper (rendering + playback).
- `packages/bundle` — the `.ovb` format and the `ovb` CLI.
- `apps/web` — the app and the embeddable player.

## Conventions

- TypeScript, strict mode. Prefer pure, tested functions in the packages and
  keep UI glue in `apps/web`.
- Every behavior change to a package should come with a test.
- Use the DCO: sign off commits with `git commit -s`. No CLA.
- Match the surrounding style; there is no separate formatter step to run.

## Verifying UI changes

The app is desktop-web-first but responsive. For anything touching playback,
sync, or editing, verify in a browser: import a score, play, loop, and (for
editor work) toggle Edit and exercise the keyboard shortcuts (press `?`).

## Reporting issues

Include the browser, what you did, and what you expected. For score problems,
attaching the `.ovb` bundle or MusicXML makes it reproducible.
