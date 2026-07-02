# OpenVoicing

Open source living sheet music: interactive notation that plays, syncs to real
recordings, and comes with serious practice tools. An open alternative to
Soundslice built around an **open file format instead of a hosted service**:
the editor exports self-contained bundles (`.ovb`) holding a score, recordings,
and sync maps, and the embeddable player plays bundles from any static URL.
See the [bundle format spec](docs/bundle-format.md).

**Status: early development.** See the [plan](PLAN.md) for where this is going.

## What works today

- Monorepo scaffold with CI
- `@openvoicing/score-model`: the canonical score document format (versioned
  JSON, stable entity IDs, first-class sync maps) with a starter MusicXML importer
- `@openvoicing/player`: notation and tablature rendering with synth playback,
  built on [alphaTab](https://alphatab.net), behind a renderer-agnostic API
- `@openvoicing/audio-engine`: time-stretched playback of real recordings
  (speed changes preserve pitch) via the
  [Signalsmith Stretch](https://signalsmith-audio.co.uk/code/stretch/)
  AudioWorklet, with region looping and waveform peak computation
- A demo web app with practice tools: play/pause, loop, tempo control without
  pitch change, metronome, count-in, and opening MusicXML or Guitar Pro files,
  plus a recording panel: open an audio file, see its waveform, click to seek,
  drag to loop a passage, and slow it down without changing pitch
- The beginnings of the editor: plain MusicXML imports become editable
  documents. Toggle Edit, click a note, then: a-g set pitch, left/right arrows
  move the selection, up/down transpose (shift for octave), 1/2/4/8/6/3 set
  duration, r rests, i inserts, x deletes, j respells enharmonics, and
  Cmd+Z / Shift+Cmd+Z undo and redo. Edited scores export as MusicXML and are
  carried in bundles

## Quickstart

Requires Node 22+ and pnpm.

```sh
pnpm install
pnpm dev        # demo app at http://localhost:5173
pnpm test       # unit tests
pnpm typecheck
pnpm build
```

## Embedding

Host a `.ovb` bundle on any static server, then add the player to any page:

```html
<script src="https://your-player-host/openvoicing-embed.js"></script>
<div data-openvoicing-bundle="https://example.com/tune.ovb"></div>
```

Or drive it from JavaScript:

```js
const player = OpenVoicing.create("#slot", { bundle: "https://example.com/tune.ovb" });
player.on("ready", (e) => console.log(e.title));
player.play();
player.setSpeed(0.5);
player.seek(30);
```

Try it locally: `pnpm dev`, then open http://localhost:5173/sdk-demo.html.

## Command line

The `ovb` CLI (from `@openvoicing/bundle`) creates and validates bundles:

```sh
pnpm --filter @openvoicing/bundle build
node packages/bundle/bin/ovb.mjs create --score song.musicxml --recording take.mp3 --out song.ovb
node packages/bundle/bin/ovb.mjs validate song.ovb
node packages/bundle/bin/ovb.mjs inspect song.ovb
```

## More docs

- [Bundle format spec](docs/bundle-format.md)
- [Static-hosting cookbook](docs/hosting-cookbook.md)
- [Gallery submissions](docs/gallery.md)
- [Publishing packages](docs/publishing.md)
- [Contributing](CONTRIBUTING.md)

## Layout

```
packages/score-model   # document format, converters, sync maps (MPL-2.0)
packages/player        # embeddable player (MPL-2.0)
packages/audio-engine  # time-stretch playback, waveforms (MPL-2.0)
packages/bundle        # .ovb bundle format: create, read, validate (MPL-2.0)
apps/web               # authoring app + embeddable player page
docs/                  # format specs
```

## Roadmap

See [PLAN.md](PLAN.md) for the full plan: real-recording sync, the sync point
editor, the notation editor, scanning (OMR), courses and teaching tools,
embedding, and self-hosting.

## License

Player and score-model packages: MPL-2.0. Platform components (server, web
app) will be AGPL-3.0. See [PLAN.md](PLAN.md#6-licensing-and-governance) for
the reasoning.
