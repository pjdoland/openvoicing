# Static-hosting cookbook

OpenVoicing has no backend. The app is a static site and the player is a static
page that reads `.ovb` bundles from any URL. Here is how to host both, and how
to publish a single interactive piece.

## Host a single piece (the common case)

1. In the app, build your piece (import or compose, add a recording, sync it).
2. Click **Export bundle** to download `your-piece.ovb`.
3. Upload that file anywhere that serves static files over HTTPS.
4. Embed it on any page:

   ```html
   <script src="https://YOUR-PLAYER-HOST/openvoicing-embed.js"></script>
   <div data-openvoicing-bundle="https://YOUR-FILES/your-piece.ovb"></div>
   ```

   The **Copy embed** button in the app produces this snippet.

### CORS

If the bundle is served from a different origin than the player, the file host
must send `Access-Control-Allow-Origin`. Most static hosts (GitHub Pages,
Netlify, S3+CloudFront, Cloudflare Pages) allow this or can be configured to.
Same-origin hosting needs no CORS.

### YouTube video bundles

If a bundle uses a YouTube video recording, the player loads the official
YouTube IFrame API and embeds `https://www.youtube-nocookie.com`. When you set
a Content-Security-Policy, allow those origins so the video can play:

```
frame-src   https://www.youtube-nocookie.com;
script-src  https://www.youtube.com;
```

Nothing is downloaded from YouTube; the video streams through its player, so a
YouTube-backed bundle needs a network connection (it is marked `external` in
the manifest). Audio-only bundles are fully self-contained and need none of
this.

## Host the whole app / player

Build and deploy the `apps/web/dist` folder:

```sh
pnpm build
# deploy apps/web/dist/** to any static host
```

Platform notes:

- **GitHub Pages / Netlify / Cloudflare Pages / S3**: upload `dist` as-is.
- Serve `.ovb` with `Content-Type: application/zip` (or `application/octet-stream`).
- The service worker precaches the app for offline use; no config needed.

## Deep links

Preset the player with query params on `embed.html` (or via the SDK `params`):

- `speed=0.75` — playback speed
- `loop=8-14` (seconds) or `loop=b3-6` (bar numbers, when synced)
- `t=12` — start position in seconds

```html
<div
  data-openvoicing-bundle="https://YOUR-FILES/etude.ovb"
  data-openvoicing-player="https://YOUR-PLAYER-HOST/embed.html?speed=0.7&loop=b5-8"
></div>
```

## Command line

The `ovb` CLI (in `@openvoicing/bundle`) creates and validates bundles in
scripts and CI:

```sh
ovb create --score etude.musicxml --recording take.mp3 --out etude.ovb --title "Etude"
ovb validate etude.ovb
ovb inspect etude.ovb
```
