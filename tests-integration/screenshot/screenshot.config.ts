import { defineConfig } from "@playwright/test";

export default defineConfig({
  timeout: 30_000,
  workers: 1,
  fullyParallel: false,
  expect: {
    timeout: 10_000,
  },
  globalSetup: "../globalSetup",
  testMatch: "screenshot.test.ts",
});
