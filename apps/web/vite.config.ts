import { fileURLToPath, URL } from "node:url";
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { alphaTab } from "@coderline/alphatab-vite";
import { VitePWA } from "vite-plugin-pwa";

export default defineConfig({
  plugins: [
    react(),
    alphaTab(),
    VitePWA({
      registerType: "autoUpdate",
      // alphaTab's worker/worklet bundles are ~2.3MB each and must be cached
      // for offline playback.
      workbox: {
        globPatterns: ["**/*.{js,css,html,svg,png,woff,woff2,sf3,wasm,ovb}"],
        maximumFileSizeToCacheInBytes: 5 * 1024 * 1024,
        // The embed page is addressed as /embed.html?bundle=<url>; params must
        // not break the precache match, and it must not fall back to index.html.
        ignoreURLParametersMatching: [/.*/],
        navigateFallbackDenylist: [/\/embed\.html/],
      },
      manifest: {
        name: "OpenVoicing",
        short_name: "OpenVoicing",
        description: "Open source living sheet music: practice, sync, edit, share.",
        theme_color: "#1b1f27",
        background_color: "#f4f5f7",
        display: "standalone",
        start_url: "/",
        icons: [
          { src: "/icons/icon-192.png", sizes: "192x192", type: "image/png" },
          { src: "/icons/icon-512.png", sizes: "512x512", type: "image/png" },
          {
            src: "/icons/icon-512.png",
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
