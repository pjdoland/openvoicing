import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  test: {
    environment: "jsdom",
    globals: true,
    setupFiles: ["./test/setup.ts"],
    include: ["test/**/*.test.{ts,tsx}"],
    coverage: {
      provider: "v8",
      include: ["src/**/*.{ts,tsx}"],
      // App.tsx and embed.tsx are the top-of-pyramid integration shells,
      // exercised by the Playwright E2E suite rather than unit tests; the
      // pure logic and leaf components extracted from them are unit-tested.
      exclude: ["src/main.tsx", "src/demo.ts", "src/App.tsx", "src/embed.tsx"],
    },
  },
});
