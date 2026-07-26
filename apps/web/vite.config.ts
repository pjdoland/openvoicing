import { fileURLToPath, URL } from "node:url";
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { alphaTab } from "@coderline/alphatab-vite";
import { VitePWA } from "vite-plugin-pwa";

// Serve from the domain root by default; set OPENVOICING_BASE (with leading and
// trailing slash) to deploy under a sub-path, e.g. GitHub project Pages at
// "/openvoicing/". See docs/deploy-app.md.
const base = process.env.OPENVOICING_BASE || "/";

export default defineConfig({
  base,
  plugins: [
    react(),
    alphaTab(),
    VitePWA({
      registerType: "autoUpdate",
      // alphaTab's worker/worklet bundles are ~2.3MB each and must be cached
      // for offline playback.
      workbox: {
        // HTML documents are never precached (see the "pages" runtimeCaching
        // entry below): a precached index.html/embed.html freezes the
        // RESPONSE HEADERS from install time, so a self-hoster fixing e.g.
        // their CSP header never reaches clients already running the old
        // service worker. Only hashed, immutable build assets go in the
        // precache manifest.
        globPatterns: ["**/*.{js,css,svg,png,woff,woff2,sf3,wasm,ovb}"],
        // The FluidR3 soundfont (~24MB) is too big to precache; it is cached on
        // first play via runtimeCaching below instead. HTML is excluded from
        // the manifest by globPatterns above; listed again here for clarity.
        globIgnores: ["**/soundfont/FluidR3Mono_GM.sf3", "**/*.html"],
        maximumFileSizeToCacheInBytes: 5 * 1024 * 1024,
        // The embed page is addressed as /embed.html?bundle=<url>; params must
        // not break the precache match for the assets it references.
        ignoreURLParametersMatching: [/.*/],
        // index.html is no longer precached, so there is nothing to fall back
        // to offline; navigations are served NetworkFirst instead (below),
        // which also serves embed.html correctly without a denylist.
        navigateFallback: null,
        runtimeCaching: [
          {
            urlPattern: ({ url }) => url.pathname.endsWith(".sf3"),
            handler: "CacheFirst",
            options: {
              cacheName: "soundfont",
              rangeRequests: true,
              expiration: { maxEntries: 2, maxAgeSeconds: 60 * 60 * 24 * 90 },
              cacheableResponse: { statuses: [0, 200] },
            },
          },
          {
            // Navigations/documents (index.html, embed.html, and any
            // integrator page embedding the player in an iframe): always try
            // the network first so a header fix (e.g. a corrected CSP) is
            // picked up immediately, falling back to the cache briefly only
            // when offline or the network is slow.
            urlPattern: ({ request }) =>
              request.destination === "document" || request.mode === "navigate",
            handler: "NetworkFirst",
            options: {
              cacheName: "pages",
              networkTimeoutSeconds: 3,
              cacheableResponse: { statuses: [0, 200] },
            },
          },
        ],
      },
      manifest: {
        name: "OpenVoicing",
        short_name: "OpenVoicing",
        description: "Open source living sheet music: practice, sync, edit, share.",
        theme_color: "#1b1f27",
        background_color: "#f4f5f7",
        display: "standalone",
        start_url: base,
        icons: [
          { src: `${base}icons/icon-192.png`, sizes: "192x192", type: "image/png" },
          { src: `${base}icons/icon-512.png`, sizes: "512x512", type: "image/png" },
          {
            src: `${base}icons/icon-512.png`,
            sizes: "512x512",
            type: "image/png",
            purpose: "maskable",
          },
        ],
      },
    }),
  ],
  build: {
    rollupOptions: {
      input: {
        main: fileURLToPath(new URL("./index.html", import.meta.url)),
        embed: fileURLToPath(new URL("./embed.html", import.meta.url)),
      },
    },
  },
});
