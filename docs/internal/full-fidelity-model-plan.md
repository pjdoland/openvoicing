# Full-Fidelity Editable Model, Plan (draft for council review)

## Goal

Every score that OpenVoicing can *display* should also be *editable* and
*exportable*, regardless of the file it was loaded from. The loaded file is a
source; edits produce a new document/bundle and never mutate the original. Today
only scores that round-trip through our simplified `ScoreDocument` are editable;
complex scores (multi-staff piano, Guitar Pro, `.mxl`) render
natively through alphaTab and are read-only.

## Principles

1. **No silent loss.** Loading a score must not discard information it will need
   to export or edit. If we cannot represent something, we preserve it verbatim
   (pass-through) rather than drop it.
2. **Render fidelity == edit fidelity.** What you see (alphaTab) is what you can
   edit and export. No "simplified for editing" fork.
3. **Round-trip is the contract.** MusicXML in → model → MusicXML out must be
   musically equivalent (a golden-file corpus enforces this).
4. **Versioned, migratable** document + bundle format.
5. **Incremental.** Ship value each phase; never a big-bang rewrite that leaves
   the app broken for weeks.

## Current model (baseline)

`ScoreDocument`: `parts[] → measures[] → voices[] → beats[] → notes[]`, plus a
global `bars[]` carrying effective time signature / key / tempo. Pipelines:
`importMusicXml` (v0), `toAlphaTex` (render bridge), `toMusicXml`, `toMidi`,
`ScoreEditor` (edits + undo).

### Gap analysis (why complex scores are read-only)

- **No staff level.** A part has voices but no staves; a grand staff (2 staves,
  treble+bass) cannot be represented. `toAlphaTex` emits a single `{score}`
  staff and **only `voices[0]`**, the whole reason `isMultiStaffMusicXml`
  routes piano scores to the read-only native path.
- **No clefs / clef changes.**
- **Missing notation:** ornaments (trill/mordent/turn), articulations
  (staccato/accent/tenuto/fermata), slurs (ties exist, slurs don't), dynamics &
  hairpins, grace notes, arpeggios, glissando, tremolo.
- **Missing structure:** repeats, voltas, segno/coda/D.C./D.S., multiple
  endings, barline styles, system/page breaks.
- **Missing per-note detail:** stem direction, beaming (explicit), note-spelling
  edge cases, fingering, string/bowing beyond guitar, ties across barlines.
- **Directions/text:** tempo text, rehearsal marks, chord symbols, lyrics
  verses (single lyric only today).
- **alphaTex ceiling.** Even with a richer model, alphaTex (a text input format)
  cannot express everything alphaTab can render, so the *render bridge* itself
  is lossy.

## Architectural options

### Option A, Expand `ScoreDocument`, keep alphaTex render bridge
Grow our schema to cover the above and extend `toAlphaTex`. Cheapest structurally
but bounded by alphaTex's expressiveness (ornaments, dynamics, cross-staff, grace
notes are limited/absent) → render stays lossy. **Rejected** as the render path.

### Option B, Adopt alphaTab's model as the edit substrate
Edit `api.score` (alphaTab `Score/Track/Staff/Bar/Voice/Beat/Note`) in place,
serialize that to our bundle, and write our own alphaTab→MusicXML exporter.
No reinvention; full fidelity by construction. Risks: alphaTab's model is not a
stable *mutation* API; undo/redo, serialization, and MusicXML export all become
our responsibility against an internal shape that can change between alphaTab
versions; tight coupling.

### Option C, Mirror model + programmatic render (recommended)
Expand our model to the **standard hierarchy that maps 1:1 to alphaTab's**
(`score → part → staff(+clef) → bar → voice → beat → note`, plus attributes and
notation), and **render by constructing alphaTab `Score` objects
programmatically** (not via alphaTex text) so rendering is lossless. Keep our
own serializable/editable model and a first-class MusicXML round-trip as the
fidelity contract. Anything we truly cannot model yet is preserved as an opaque
pass-through blob keyed to its owning element so export stays lossless while the
model catches up.

**Recommendation: Option C.** It preserves our goals (own editable/serializable
model + MusicXML export) while getting render fidelity from alphaTab's own model.
The council should stress-test C vs B specifically on: maintenance cost of
tracking alphaTab's model, whether programmatic `Score` construction is a
supported/stable alphaTab path, and whether the pass-through blob is workable.

## Target data model (sketch, Option C)

```
Score { id, format, version, work{title,composer,...}, defaults, parts[] }
Part  { id, name, instruments[], staves[] }
Staff { id, clefs[](with position), lines }
Bar (per part, aligned to global BarSpec[]) {
  timeSig?, key?, clefChange?, repeats{start,end,times,volta?}, barlineStyle?,
  voices[] { beats[] { startTick, durationTicks, graceKind?, tuplet?,
    slur/tieRefs, articulations[], ornaments[], dynamics?, lyrics[],
    notes[] { step, alter, octave, tie, notehead?, stem?, fingering?, ... } } }
}
Directions (tempo/text/rehearsal/hairpin) anchored to (bar, tick).
unknown: opaque per-element pass-through for not-yet-modeled MusicXML.
```

Design questions for the council: staff-vs-voice ownership of beats; how ties
and slurs are referenced (id refs vs start/stop flags); cross-staff beaming;
whether "global bars" survives or bars become per-part.

## Pipelines

- **Import**: MusicXML (partwise/timewise, handle `<backup>/<forward>/<staff>`),
  compressed `.mxl`, and Guitar Pro (via alphaTab's importer → our model).
  Everything unmodeled → `unknown` pass-through.
- **Render**: model → alphaTab `Score` object → `api.renderScore(...)`.
- **Export**: model → MusicXML (lossless w/ pass-through), model → MIDI, bundle.
- **Fidelity harness**: a corpus of real scores; assert
  `export(import(x)) ≈ x` (musically), plus visual-regression snapshots.

## Editing & undo/redo

Extend `ScoreEditor` to the new hierarchy: staff/clef ops, add/remove voice,
articulations/ornaments/dynamics toggles, slurs, grace notes, repeats. Keep the
command + inverse-command undo stack; ensure every op has an inverse and edits
are structurally validated (bar duration, tie/slur consistency).

## Format versioning & migration

Bump `SCORE_FORMAT_VERSION` and the bundle `formatVersion`; write a migration
from v0 docs. Bundles already carry the original source file, so old bundles
keep opening. Define forward-compat rules for `unknown` blobs.

## Phased roadmap (proposed)

- **P0, Foundations & harness.** New schema types behind a flag; MusicXML
  round-trip harness + corpus; `unknown` pass-through; no UI change.
- **P1, Staves & clefs.** Model staves; import multi-staff; programmatic
  alphaTab render; multi-staff scores become editable (notes) & round-trip. Retire
  `isMultiStaffMusicXml` read-only routing.
- **P2, Core notation.** Slurs, articulations, ornaments, dynamics, grace
  notes, model, render, import/export, edit ops.
- **P3, Structure.** Repeats, voltas, endings, barlines, breaks, directions.
- **P4, Breadth.** Guitar Pro import fidelity, chord symbols, multi-verse
  lyrics, fingering; polish edit UX (inspector for the new attributes).

## Risks / open questions

- alphaTab programmatic `Score` construction: supported and stable? (spike in P0)
- Maintenance coupling to alphaTab's internal model (Option C/B).
- MusicXML is vast; scope the "musically equivalent" bar for round-trip.
- Editing complex polyphony/cross-staff without a fragile UX.
- Performance of re-rendering large scores on each edit.
- Do we still need `toAlphaTex` at all after programmatic render? (probably drop)
