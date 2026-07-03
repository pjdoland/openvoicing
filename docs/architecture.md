# Architecture

A map of how OpenVoicing fits together, for contributors. If you just want to
use or self-host it, see the [user guide](user-guide.md) or
[deployment guide](deploy-app.md) instead.

## The big idea

OpenVoicing is built around an **open file format, not a hosted service**. The
canonical artifact is an `.ovb` bundle: a self-contained ZIP holding a score, its
recordings, and the sync map that aligns them. Everything else is code that
creates, reads, renders, or plays that bundle. This is why the packages are
independent and the app is "just" a client.

## The packages

```
                    ┌──────────────────────────────┐
  MusicXML / GP  ─▶ │  @openvoicing/score-model    │  the document format:
                    │  parse ▸ ScoreV1 ▸ export     │  versioned JSON, stable IDs,
                    └───────────────┬──────────────┘  sync maps, edit + undo
                                    │ ScoreV1 doc
                    ┌───────────────▼──────────────┐
                    │  @openvoicing/player          │  render notation/tab and
                    │  (alphaTab adapter)           │  play the synth; renderer-
                    └───────────────┬──────────────┘  agnostic surface
                                    │
  audio file  ─────▶┌──────────────▼──────────────┐
                    │  @openvoicing/audio-engine    │  time-stretch playback
                    │  (Signalsmith worklet)        │  (speed ≠ pitch), waveforms
                    └───────────────┬──────────────┘
                                    │
                    ┌───────────────▼──────────────┐
  .ovb  ◀──create──▶│  @openvoicing/bundle          │  read/write/validate .ovb,
                    │  (+ the `ovb` CLI)            │  the `ovb` command
                    └──────────────────────────────┘

                    apps/web  ── wires them into the authoring app +
                                 the embeddable player page
```

| Package | Responsibility | Notes |
| --- | --- | --- |
| `score-model` | The `ScoreV1` document format, importers (MusicXML, Guitar Pro), MusicXML export, sync-map math, and the editor (`ScoreEditorV1` with snapshot undo). | Pure, well-tested functions. The best place to start. |
| `player` | Wraps [alphaTab](https://alphatab.net) behind a renderer-agnostic API: render a `ScoreV1`, highlight beats/notes, synth playback, loop markers. | alphaTab is a *rebuildable render target*, not the source of truth. |
| `audio-engine` | `RecordingPlayer`: plays a real recording through the [Signalsmith Stretch](https://signalsmith-audio.co.uk/code/stretch/) AudioWorklet so speed changes preserve pitch; region looping; waveform peaks. | Owns the audio clock. |
| `bundle` | The `.ovb` format (a ZIP with a `manifest.json`), plus create/read/validate and the `ovb` CLI. | Bundles carry a `formatVersion`; readers reject unknown majors. |
| `apps/web` | The React authoring app and the embeddable player page (`embed.html`). Glue only: state, UI, and the sync-point editor live here. | AGPL-3.0; the packages are MPL-2.0. |

## The two clocks

The trickiest concept is that playback has **two time bases**:

- **Score time** (ticks) — alphaTab's playback position, driving the synth and the
  moving cursor.
- **Recording time** (seconds) — the `RecordingPlayer`'s position in the audio.

The **sync map** (a list of `SyncPoint`s in the score model) maps between them.
`mediaTimeAtTick` / `tickAtMediaTime` interpolate, so "jump to bar 20" can move
both the cursor and the recording playhead, and "follow" can scroll the score to
the audio position. Sync-confidence flags (blue/amber/red bar markers) are a
heuristic over the evenness of sync-point spacing; see `apps/web/src/sync-utils.ts`.

## Data flow, end to end

1. A file is imported → `score-model` produces a `ScoreV1` document.
2. `apps/web` hands the document to `player` (render) and, if present, a recording
   to `audio-engine` (decode + waveform).
3. Editing goes through `ScoreEditorV1` (snapshot undo); each edit re-renders via
   `player.renderV1(...)` and autosaves to IndexedDB.
4. Export serializes back to MusicXML and packs a bundle via `bundle`.
5. The embeddable player loads a bundle and reuses `player` + `audio-engine` in a
   read-only configuration.

## Tech and conventions

- pnpm monorepo, TypeScript strict, React 19 + Vite for the app.
- Unit tests with vitest (per package); end-to-end with Playwright (`apps/web/e2e`).
- See [CONTRIBUTING.md](../CONTRIBUTING.md) for the workflow and
  [testing.md](testing.md) for how to run and debug the suites.
