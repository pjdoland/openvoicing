# Publishing packages

The player, score model, and bundle format are meant to be embedded by others,
so the reusable packages are published to npm under the MPL-2.0 license.

## Packages intended for npm

- `@openvoicing/score-model` — document format and converters
- `@openvoicing/bundle` — `.ovb` reader/writer and the `ovb` CLI
- `@openvoicing/audio-engine` — time-stretch and analysis
- `@openvoicing/player` — the rendering/playback wrapper

Each is currently consumed as TypeScript source inside the monorepo. Before a
first npm release they need a build step that emits `.js` + `.d.ts` (the
`bundle` package already does this via `tsconfig.build.json`; the others follow
the same pattern) and a `publishConfig` with `"access": "public"`.

## Release checklist

1. `pnpm test && pnpm typecheck && pnpm build`
2. Bump versions (keep the four packages in lockstep for now).
3. `pnpm --filter <pkg> build` to emit `dist`.
4. `npm publish --access public` from each package (requires an npm token with
   publish rights to the `@openvoicing` scope).
5. Tag the release: `git tag vX.Y.Z && git push --tags`.

## Player on a CDN

The embed script (`apps/web/public/openvoicing-embed.js`) is a dependency-free
file. Publish it to any CDN and point the `<script src>` at it. Its companion
type definitions live next to it (`openvoicing-embed.d.ts`).

Automating steps 3-5 in CI (on tag push) is the natural next step; it needs an
`NPM_TOKEN` secret, which is why it is not enabled in the repo by default.
