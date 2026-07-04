# `ovb` CLI reference

The `ovb` command (from `@openvoicing/bundle`) creates, validates, and inspects
`.ovb` bundles from the terminal. It's handy for scripting, CI, and preparing
bundles to host.

## Getting it

From the repo:

```sh
pnpm --filter @openvoicing/bundle build
node packages/bundle/bin/ovb.mjs <command>
```

## Commands

### `ovb create`

Package a score (and optionally a recording) into a bundle.

```sh
ovb create --score <file> --out <file.ovb> [--title <T>] [--recording <audio>] [--youtube <url>]
```

| Flag | Required | Meaning |
| --- | --- | --- |
| `--score <file>` | yes | Source score: `.musicxml`, `.xml`, `.mxl`, or a Guitar Pro file. |
| `--out <file.ovb>` | yes | Path to write the bundle to. |
| `--title <T>` | no | Title stored in the manifest. |
| `--recording <audio>` | no | An audio file to include (e.g. `.mp3`, `.ogg`, `.wav`). |
| `--youtube <url>` | no | A YouTube URL or video id to attach as a video recording. |

```sh
# Audio recording packed into the bundle:
ovb create --score song.musicxml --recording take.mp3 --title "My Tune" --out song.ovb

# YouTube video recording (referenced, not downloaded; marks the bundle external):
ovb create --score song.musicxml --youtube https://youtu.be/VIDEO_ID --out song.ovb

# YouTube video with a paired audio file for the waveform / auto-sync:
ovb create --score song.musicxml --youtube VIDEO_ID --recording take.mp3 --out song.ovb
```

### `ovb validate`

Check that a bundle is well-formed and its `formatVersion` is supported. Exits
non-zero on failure, so it works in CI.

```sh
ovb validate song.ovb
```

### `ovb inspect`

Print the manifest and the list of files inside a bundle.

```sh
ovb inspect song.ovb
```

### `ovb help`

```sh
ovb help
```

## Notes

- A bundle is a ZIP archive with a `manifest.json`; see the
  [bundle format spec](bundle-format.md) for the on-disk layout and the
  `formatVersion` compatibility rule (readers reject unknown major versions).
- To host the bundle you produce, see [deploy-app.md](deploy-app.md#hosting-ovb-bundles).
