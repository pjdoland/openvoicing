# User guide

OpenVoicing turns sheet music into an interactive practice tool. There are three
things you do with a piece: **Play** it, **Practice** it, and **Edit** it. This
guide walks through each. Nothing here requires any technical background.

- [Getting started](#getting-started)
- [Practice a passage](#practice-a-passage)
- [Play along with a real recording](#play-along-with-a-real-recording)
- [Edit the notation](#edit-the-notation)
- [Name and share a piece](#name-and-share-a-piece)
- [Keyboard shortcuts](#keyboard-shortcuts)
- [FAQ](#faq)

## Getting started

1. Open the app. A demo piece loads so you can try things right away.
2. Press **Play** (or the spacebar). The notation highlights the note that's
   sounding and scrolls to follow along.
3. Up in the top-right, the mode toggle switches between:
   - **Listen** — a clean player for just viewing and playing.
   - **Practice** — reveals the practice tools (tempo, looping, recording sync).
4. To use your own music, choose **File → Open score file** and pick a MusicXML
   (`.musicxml`, `.xml`, `.mxl`) or Guitar Pro file, or **File → New score** to
   start blank.

Your work is saved automatically in your browser — the header shows **"All changes
saved."** There is no Save button to hunt for.

## Practice a passage

Switch to **Practice** mode for these.

- **Slow it down without changing pitch.** Use the **Speed** `−` / `+` buttons
  (5% steps), or press **h** to toggle half speed. The music sounds lower in
  tempo but at the correct pitch.
- **Loop a section.** Click **Loop**, or drag across the notes you want to repeat.
  During playback you can also press **[** to set the loop start and **]** to set
  the end.
- **Count-in and metronome.** Turn on **Count-in** for a lead-in before playback;
  the metronome click helps you keep time.

## Play along with a real recording

OpenVoicing can line a real audio recording up to the score so playback of the
recording follows the notation.

1. In **Practice** mode, open the **Recording & sync** panel and add an audio file.
2. Use **Auto sync** to align it automatically, or **tap sync** to tap each bar's
   downbeat yourself.
3. The **Sound** toggle chooses what you hear:
   - **Performance** — the real recording.
   - **Notes** — the computer playing the written notation.
4. The colored numbers above the waveform are **sync-confidence flags**: **blue** =
   looks well aligned, **amber** = worth a glance, **red** = probably needs
   nudging (drag the marker into place). A genuine tempo change or fermata can
   legitimately show amber or red.

Turn on **Follow** to keep the score scrolled to the spot that's playing.

## Edit the notation

1. Turn on **Edit** (top-right).
2. Click a note to select it, or press **N** to enter **note-input mode**, where
   typing pitches places notes and advances automatically.
3. Type **A**–**G** to set pitch, **1 2 4 8 6 3** to set the note length ("value"),
   and use the toolbar for accidentals, ties, dynamics, and more.
4. To rename the piece, open the **⚙ Score** button in the edit toolbar and choose
   **Title** (it also sets the composer, tempo, time signature, and key).

Nothing needs saving — edits autosave, and **Delete** only clears the selected note
to a rest and is undoable with **⌘/Ctrl+Z**. See the full
[keyboard shortcuts](#keyboard-shortcuts) below.

## Name and share a piece

- **Name it:** Edit → **⚙ Score → Title**.
- **Export a bundle:** **File → Export bundle** writes a single `.ovb` file
  containing the score, any recording, and the sync map. It is self-contained and
  shareable — anyone with the file (or the embeddable player pointed at it) sees
  the same interactive piece, no account needed.
- You can also export plain **MusicXML** to open the score in other notation apps.

## Keyboard shortcuts

Press **?** in the app any time to open this list (it's the authoritative source;
this table mirrors it).

**Transport**

| Key | Action |
| --- | --- |
| Space | Play / pause |
| − / + | Speed down / up 5% |
| h | Toggle half speed |
| [ / ] | Set loop start / end during playback |
| 1–9 | Recall a saved loop |

**Sync**

| Key | Action |
| --- | --- |
| p | Plant a sync point at the playhead |
| ⌘/Ctrl+Z | Undo a sync edit |
| ← → | Nudge a focused sync marker |

**Editor (Edit mode)**

| Key | Action |
| --- | --- |
| a–g | Set pitch |
| Shift+a–g | Add note to chord |
| ← → | Move selection |
| Shift+← → | Extend selection |
| ↑ ↓ | Transpose note (Shift = octave) |
| 1 2 4 8 6 3 | Set duration |
| . | Toggle dot |
| + / − | Sharpen / flatten |
| Shift+3 | Toggle triplet |
| r | Rest |
| b | Repeat previous bar |
| t | Tie to next |
| j | Respell enharmonic |
| l | Edit lyric |
| i | Insert beat |
| x | Delete beat |
| ⌘/Ctrl+C / X / V | Copy / cut / paste |
| ⌘/Ctrl+Z | Undo / redo (with Shift) |
| Esc | Deselect |

**General**

| Key | Action |
| --- | --- |
| ? | Show the shortcut sheet |
| ⌘/Ctrl+K | Command palette (search every action) |

## FAQ

**Does slowing down change the pitch?**
No. Speed and pitch are independent — slowing the tempo keeps every note at its
correct pitch, for both the notation playback and a synced recording.

**Where are my changes saved? Is there a Save button?**
There's no Save button. Everything autosaves to your browser automatically; the
header shows "All changes saved." Reloading restores your last session. To keep a
copy or move it elsewhere, export an `.ovb` bundle or MusicXML.

**Can I share a piece without the app?**
Yes — export an `.ovb` bundle. It's a single self-contained file that holds the
score, recording, and sync. Share the file, or embed the player pointed at it.

**Why is a bar marked amber or red?**
Those are sync-confidence flags. Amber/red means that bar's sync marker is spaced
differently from its neighbors, so it *might* be misaligned — or it might be a real
tempo change. Blue means it looks well aligned. See
[play along with a recording](#play-along-with-a-real-recording).

**Can I use it without a mouse?**
Largely, yes. Most actions have keyboard shortcuts, and **⌘/Ctrl+K** opens a
command palette that searches every action by name.

**What files can I open?**
MusicXML (`.musicxml`, `.xml`, `.mxl`), Guitar Pro files, and OpenVoicing `.ovb`
bundles.
