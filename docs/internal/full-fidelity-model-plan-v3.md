# Full-Fidelity Editable Model, Plan v3 (committed: Option C)

Decision: **Option C**, own a rich, renderer-agnostic semantic music document
model; alphaTab is a render target, not the source of truth or fidelity ceiling.
This v3 is the committed roadmap; v1/v2 record the reasoning and the six-member
council review that shaped it.

## Design invariants (from the council)

- **Semantic, symbolic rhythm.** Store note-type + dots + time-modification;
  derive ticks. (PPQ 960 can't integer-represent prime/nested tuplets.)
- **Per-part key / time / `<transpose>`** over a **single global bar time-grid**.
  The global grid gives one tick axis (sync/recording stay valid); per-part
  attributes give written key, meter, polymeter, and transposing instruments.
- **ID-first.** Spanners (tie/slur/beam/tuplet/hairpin/8va/pedal/volta) are
  first-class objects with endpoint id-refs; selection is a layered ID cursor
  (`partId/staffIndex/barIndex/voiceIndex/beatId/noteId?`); refs resolve to
  indices at apply time so edits survive insert/delete/repack.
- **Voice ⟂ staff.** A note carries both; support per-note staff override
  (cross-staff) without a hierarchy rewrite.
- **Lossless, belt-and-suspenders.** Model what we can; preserve the original
  source so untouched regions round-trip verbatim (Option D's patch-on-source
  becomes a fallback *inside* C, keyed to elements, not free-floating blobs).
- **Patch-based undo** (immer produce-with-patches): op authors write only the
  forward mutation; inverse is derived; history carries selection + a sync-map
  remap for structural edits.
- **Render adapter** `toAlphaTabScore(doc)` runs `consolidate → finish(settings)
  → rebuildRepeatGroups` explicitly (verified required); alphaTab pinned + a
  tick/bounds conformance golden. Cursor/bounds/`barTicks` stay finish-derived.
- **Versioned + migratable.** `formatVersion` gate accepts a *range* + migration
  chain (never strict-equality); bundle gains an authoritative model slot;
  original source retained for provenance/pass-through.
- **Proof harness compares against the original source** (today's test can't
  detect importer loss): a `CanonicalScore` normal form, graded tiers
  (structural / notation / bit-exact), fuzz + undo-identity properties, a
  PD/CC0 corpus bucketed by feature, and a **ratcheting `fidelityScore` gate**.

## Phases (each ships value; gate = fidelity ratchet, never down)

- **P0, Keystone spikes + harness (no UI).**
  1. Render adapter: build an alphaTab `Score` programmatically, run the finish
     pipeline, render, and assert `masterBars[].start`/`calculateDuration`/
     bounds are correct. **De-risks the whole architecture, do first.**
  2. `CanonicalScore` + source-comparing round-trip harness; seed the corpus.
  3. New semantic schema types behind a flag; `startTick` derived; validator.
  4. Version-range gate + migration scaffold; bundle model slot; fix
     edits-dropped-on-export bug.
- **P1, Staves & clefs → the Goldberg becomes editable.** Import multi-staff to
  the new model; render via the adapter; ID cursor + patch undo; edit
  pitch/duration/add/delete/lyric across staves/voices; retire the read-only
  routing for the edit subset; MusicXML/MIDI export from the model. Gate:
  multistaff + polyphony corpus at tier-0 100%; Goldberg editable e2e.
- **P2, Core notation.** Slurs, articulations, ornaments, dynamics, grace
  notes, model + render + import/export + edit ops + inspector UX (Basic/
  Advanced). Gate: notation corpus tier-1 ≥90%; tier-0 stays 100%.
- **P3, Structure.** Repeats, voltas, endings, barlines, breaks, directions,
  printed-vs-`<sound>` tempo. MIDI round-trip (pitch-only) incl. repeat expand.
- **P4, Breadth.** Guitar Pro / `.mxl` fidelity, chord symbols, multi-verse
  lyrics, fingering; polish the editing UX.

## Non-goals / guardrails

Not a big-bang rewrite: the new model lives behind a flag; the current simple
path keeps working until the new path subsumes it. alphaTex stays as a
fallback/debug format until P1 proves the adapter. Pin alphaTab; a version bump
must fail the conformance golden, not silently corrupt output.
