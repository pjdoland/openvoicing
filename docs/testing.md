# Testing

OpenVoicing is tested at three levels of the pyramid. Run everything with:

```sh
pnpm test           # unit + component (vitest, all packages)
pnpm test:coverage  # the same, with coverage summaries
pnpm --filter @openvoicing/web e2e   # end-to-end (Playwright)
```

## Level 1: unit tests (the base)

Pure functions and isolated modules, run under vitest.

- **`packages/score-model`** (~98% lines): MusicXML import, alphaTex and
  MusicXML export, MIDI export, sync-point interpolation, the `ScoreEditor`
  operations, `createEmptyScore`, id generation, and a MusicXML round-trip
  corpus that re-imports every fixture and asserts structural equality.
- **`packages/audio-engine`** (~81%): onset detection and bar alignment,
  waveform peaks (sync and async), and the `RecordingPlayer` scheduling logic
  against a mocked Web Audio graph and Signalsmith worklet.
- **`packages/bundle`** (~92%): `.ovb` create/read/validate round-trips,
  rejection of malformed input, and metadata (attribution, loops, assignment).
- **`packages/player`** (~85%): the alphaTab wrapper, with alphaTab mocked, so
  event forwarding, unit conversions, and control delegation are verified.
- **`apps/web`** pure modules: `deep-link` parsing, `sync-utils`
  (clamp/confidence), `storage` (against fake-indexeddb), `mic` (mocked
  MediaRecorder), and `SpeedControl` math.

## Level 2: component tests (the middle)

React components under vitest + jsdom + Testing Library: `SpeedControl`,
`Settings`/`useAppSettings`, the `CheatSheet` dialog, and `RecordingPanel`
(with a fake `RecordingPlayer`). These assert rendered output, ARIA names, and
user interactions (clicks, selects, keyboard).

## Level 3: end-to-end (the top)

Playwright specs in `apps/web/e2e` drive a real browser against the dev server
and cover the flows a unit test can't: synth playback and state, speed
stepping and clamping, bar-range looping, note entry and transpose with
undo, edited-score persistence across reload, opening the demo bundle and
auto-syncing, MusicXML/bundle export downloads, the embed player with
deep-link presets and error states, theme switching, the shortcut cheat sheet,
and locked student mode.

`App.tsx` and `embed.tsx` are the integration shells; they are covered here
rather than by unit tests, so they are excluded from the unit-coverage report.

## CI

Three workflows run on every push and PR: `ci` (typecheck, unit/component
tests, coverage, build), `e2e` (Playwright on Chromium), and `a11y`
(axe scan of the app and embed).
