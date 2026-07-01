# OpenVoicing Bundle Format (v0)

An OpenVoicing bundle (`.ovb`) is a self-contained, portable package holding a
piece of interactive sheet music: a score, zero or more recordings, and the
sync maps that tie recordings to the score. Anything that can host a static
file can publish a bundle; anything that implements this spec can play one.

This document is the normative spec for `formatVersion: 0`. The spec is
licensed CC-BY 4.0.

## Container

A bundle is a standard ZIP archive. The extension `.ovb` and MIME type
`application/zip` are recommended. A file named `manifest.json` must exist at
the archive root.

Readers must reject archives whose manifest is missing, whose `format` is not
`"openvoicing-bundle"`, or whose `formatVersion` they do not implement.
Guessing at unknown versions is not allowed; failing loudly preserves trust in
the format.

## Manifest

```json
{
  "format": "openvoicing-bundle",
  "formatVersion": 0,
  "title": "Blackbird",
  "score": {
    "path": "score/score.gp",
    "type": "guitarpro"
  },
  "recordings": [
    {
      "id": "take1",
      "name": "Studio take",
      "path": "recordings/take1.mp3",
      "syncPoints": [
        { "tick": 0, "timeSeconds": 1.2 },
        { "tick": 3840, "timeSeconds": 3.65 }
      ]
    }
  ]
}
```

### Fields

- `format` (string, required): always `"openvoicing-bundle"`
- `formatVersion` (number, required): `0` for this spec
- `title` (string, required): display title
- `attribution` (object, optional): free-text metadata, all fields optional
  strings: `composer`, `artist`, `copyright`, `license` (ideally an SPDX id or
  URL), `source` (where the material came from)
- `score` (object, required):
  - `path`: archive path of the score file
  - `type`: one of `"guitarpro"`, `"musicxml"`, `"alphatex"`
- `recordings` (array, required, may be empty): each entry has
  - `id` (string, required): stable within the bundle
  - `name` (string, required): display name
  - `path` (string, required): archive path of the audio file
  - `syncPoints` (array, optional): sync anchors, see below

Every `path` referenced by the manifest must exist in the archive. Readers
must ignore unknown manifest fields (forward compatibility within a major
version) and must ignore archive entries the manifest does not reference.

## Sync points

A sync point anchors a musical position to a media timestamp:

- `tick` (number): absolute score position in MIDI ticks at 960 pulses per
  quarter note, measured in playback order from the start of the piece
- `timeSeconds` (number): position in the recording, in seconds

Playback position between anchors is linearly interpolated in both directions;
positions outside the anchored range extrapolate from the nearest pair.
Anchors are typically one per bar (at the bar's start tick) but may be denser
for rubato passages. Writers should emit anchors sorted by tick; readers must
sort before interpolating.

## Media formats

Recordings should use widely decodable audio formats (MP3, Ogg Vorbis, FLAC,
WAV). Browser-based players decode via the Web Audio API, so anything the
platform's `decodeAudioData` accepts will work; MP3 is the safest choice.

## Planned for future versions

- Canonical score JSON (the OpenVoicing score model) alongside the source file
- Cover images and precomputed waveform peaks
- Video recordings
- An unpacked directory layout with the same manifest for large-media
  streaming (a ZIP cannot be range-requested)
