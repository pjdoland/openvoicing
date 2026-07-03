import { defineConfig } from "vitest/config";

// Coverage gate for the actively developed v1 model. Thresholds sit just below
// current coverage so they ratchet: a change that meaningfully drops coverage
// fails CI (`pnpm test:coverage`). Raise them as coverage improves.
export default defineConfig({
  test: {
    coverage: {
      provider: "v8",
      include: ["src/v1/**"],
      thresholds: {
        statements: 85,
        lines: 88,
        functions: 85,
        branches: 70,
      },
    },
  },
});
