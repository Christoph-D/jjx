import { defineConfig } from "@playwright/test";

export type TestOptions = {
  vscodeVersion: string;
};

export default defineConfig<void, TestOptions>({
  reporter: process.env.CI ? [["list"], ["blob", { outputDir: "blob-report" }]] : "list",
  timeout: 60_000,
  retries: 2,
  workers: process.platform === "darwin" ? 4 : 5,
  fullyParallel: true,
  use: {
    screenshot: "only-on-failure",
  },
  expect: {
    timeout: 30_000,
  },
  globalSetup: "./global-setup",
  projects: [
    {
      name: "integration tests",
      testDir: "./tests",
    },
  ],
});
