import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    exclude: [
      "node_modules",
      "directions/*/fixtures/**",
      "docs/**",
    ],
  },
});
