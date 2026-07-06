# Editable & Exportable Everywhere, Plan v2 (council-refined)

Supersedes the v1 draft. v1 recommended "Option C" (a parallel full-fidelity
model rendered by constructing alphaTab `Score` objects). A six-member expert
council reviewed v1; this v2 reconciles their findings. The headline change:
**the council split the goal in two, and the cheaper half delivers what the
product actually needs.**

## What the council changed

- **Rendering (verified against the alphaTab 1.8.3 dist):** programmatic
  `Score` construction *is* supported (`renderScore`, `@since 0.9.4`) **but** the
  caller must run `consolidate → finish(settings) → rebuildRepeatGroups`
  itself, and everything crosses a **worker JSON-serialization boundary** whose
  `ScoreSerializer` coverage, not the class surface, is the true fidelity
  ceiling. All tick/bounds/cursor data is finish-derived. Keep alphaTex as a
  fallback, don't rush to drop it.
- **MusicXML/notation:** v1's model was fidelity-capped in three fatal ways:
  duration as ticks at a fixed PPQ 960 (can't represent prime/nested tuplets),
  **no transposition** (breaks every transposing-instrument score), and global
  key/time (breaks polymeter). Rhythm must be **symbolic** (note-type + dots +
  time-modification), key/time/transpose **per-part**. The "opaque blob"
  pass-through is unrealistic for order-dependent, spanning MusicXML.
- **Serialization:** bumping `formatVersion` as v1 proposed would **reject every
  existing bundle** (`validateManifest` is strict-equality); need a version
  *range* + migration chain. The bundle has **no slot for the model** today.
  Derive `startTick` (don't store it). id-refs for ties/slurs/beams.
- **Editing UX:** the single, staff-less `BeatAddress` is the load-bearing
  weakness; need an **ID-based layered cursor**. Both the current
  snapshot-per-keystroke undo *and* v1's proposed command+inverse are wrong
  targets, use **patch-based undo** (derive inverses for free). The edit
  preview still round-trips through lossy alphaTex, contradicting "render
  fidelity == edit fidelity."
- **QA:** today's "round-trip" test compares `import(export(import(x)))` to
  `import(x)`, importer loss is **invisible**. A real harness must canonicalize
  and compare against the **original source**; but see the scope verdict below,
  which may make most of that unnecessary.
- **Scope/delivery (the pivotal dissent):** v1 (and B) each build a **second
  music-notation engine** for a 1,345-LOC codebase and a small team. The app
  **already** renders complex scores at full fidelity natively and **already**
  preserves the original file verbatim in the bundle. So there is a third,
  much cheaper architecture the plan missed.

## Reframing the goal (the key decision)

The council surfaced that "full-fidelity editable **model**" conflates two
different goals with wildly different costs:

- **Goal A, "everything is editable and exportable" for the operations that
  matter** (change pitch, change duration, add/delete note, lyrics) on *any*
  score, with lossless export. This is what the product, a practice / sync /
  teaching tool, actually needs.
- **Goal B, "a model that can represent and edit *every* notation feature"**
  (ornaments, hairpins, cross-staff beaming, voltas…). Multi-quarter; per the
  scope lead, likely a "solution looking for a problem" here, nobody edits a
  hairpin in a practice tool; they fix it upstream and re-import.

## Architecture: Option D, edit-by-patch on the source (recommended path to Goal A)

Neither B (mutate alphaTab's private model) nor C (parallel model + programmatic
render). Instead:

1. **Source of truth = the original MusicXML** (`.mxl` = unzip → patch → rezip).
   The bundle already keeps it.
2. **Edits are a list of operations** keyed by `(partId, measure, staff, voice,
   note-position)`, the same (bar, tick) addressing the sync anchors already
   use, applied by mutating just those DOM nodes.
3. **Render = feed the patched MusicXML to alphaTab's own importer** (the native
   path already shipped) → full fidelity, no programmatic `Score`, no coupling
   to alphaTab internals, no alphaTex on this path.
4. **Export = serialize the patched DOM.** Untouched material is preserved
   node-for-node **by construction**, this *deletes* the round-trip-completeness
   problem, the canonical-form harness, and the golden corpus from the critical
   path.
5. **Undo/redo = pop the edit list.** Trivial and correct.

Why this beats C/B here: every notation feature otherwise has to land in four
places (model type, alphaTab-builder, XML importer, XML exporter). Patching
needs **zero** of that for untouched notation, and only DOM-level edits for the
touched notes. Most of the council's hardest concerns (symbolic rhythm,
transposition, id-ref spanners, canonical round-trip) **evaporate** because we
never re-model the score.

**Honest limits of D:** it gives *full-fidelity render + edit the common
operations + lossless export*, not arbitrary notation editing. Complex notation
edits (ornaments/dynamics/structure) are awkward as raw DOM patches. If real
demand appears, specific features graduate to a richer model later, but that is
pull-based, not pre-built.

**Kill criterion (from the council):** if the DOM-patch *addressing* forces us to
parse each part into a full tick/voice grid (because of `<backup>/<forward>`
arithmetic), we've secretly rebuilt an importer, stop and re-evaluate B at that
point, since we'd be paying model cost either way.

## Real bug to fix regardless of path

`buildBundleBytes` writes the **original** `source.data` into the bundle, so
edits to even simple scores are **dropped on export/bundle** today. The MVP must
fix this (persist edits into the exported bundle).

## MVP slice & Definition of Done (Goal A, ~1 month / 1 dev)

"**The Goldberg's notes become editable and it still exports.**"

- Load multi-staff MusicXML / `.mxl`; renders full-fidelity (already true).
- Select a note on any staff/voice; **change pitch, change duration, delete,
  add** (pitch-only is an acceptable timeboxed descope).
- Edits patch the source MusicXML DOM (correct `<backup>/<forward>/<staff>`
  voice/staff addressing).
- Re-render via alphaTab's MusicXML importer on a **debounced** apply.
- Undo/redo (edit-list pop). **Selection is visible** in the score and
  **survives re-render** (scroll + re-mark), a gap that exists even today.
- Export MusicXML with edits applied, everything else verbatim.
- **Bundle save persists edits** (fixes the bug above).
- ~6 `load → edit → export → reload → assert` e2e tests (extend
  `editor.spec.ts`), no golden corpus.
- Timebox trip-wire: not shippable in 4 weeks → descope to pitch-only; pitch-only
  not shippable in 2 weeks → architecture is wrong, halt and reassess.

## Carried-forward rigor (applies to whichever path)

- **ID-based layered cursor** (`{partId, staffIndex, barIndex, voiceIndex,
  beatId, noteId?}`), address by stable id, resolve to index at apply time.
- **Version gate accepts a range + migration chain**; keep the original source
  in the bundle for provenance; add an edits payload to the bundle.
- **Partial-editability is explicit and honest:** an "editable pitches/rhythms;
  ornaments/slurs preserved from original" banner; never silently drop.
- **Structural edits emit a sync-map remap** (bar renumber → sync/recording
  follow).
- If we ever take the model/programmatic-render path: a `toAlphaTabScore`
  adapter that explicitly runs `consolidate/finish/rebuildRepeatGroups`, pin
  alphaTab + a bounds/tick conformance golden, and a source-comparing canonical
  harness with graded tiers and a ratcheting `fidelityScore` gate.

## Deferred / cut (pull-based, not pre-built)

Programmatic `Score` construction; the parallel full-hierarchy model; the
MusicXML round-trip golden corpus + "musically equivalent" contract; editing
(not rendering) of ornaments/dynamics/hairpins/repeats/grace notes; Guitar Pro
edit fidelity (keep GP read-only); retiring alphaTex.

## The decision for the product owner

The council's near-unanimous engineering read: **pursue Goal A via Option D**,
ship the Goldberg-editable slice in ~a month, and let full-notation editing
(Goal B) be pulled in feature-by-feature only when a real user needs it, rather
than pre-building a second notation engine. Goal B remains possible later; D does
not paint us into a corner (the source is always preserved).

Confirm the target before implementation: **A (recommended) or the literal
full-fidelity model B.**
