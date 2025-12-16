import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    testTimeout: 30000,
    fileParallelism: true,
    globalSetup: "./tests/globalSetup.js",
  },
});
