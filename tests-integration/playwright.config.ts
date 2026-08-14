import { defineConfig } from "@playwright/test";

export type TestOptions = {
  vscodeVersion: string;
};

export default defineConfig<void, TestOptions>({
  reporter: process.env.CI ? [["list"], ["blob", { outputDir: "blob-report" }]] : "list",
  timeout: process.env.CI ? 60_000 : 30_000,
  retries: process.env.CI ? 2 : 0,
  workers: process.platform === "darwin" ? 4 : 5,
  fullyParallel: true,
  use: {
    screenshot: "only-on-failure",
  },
  expect: {
    timeout: process.env.CI ? 30_000 : 15_000,
  },
  globalSetup: "./global-setup",
  projects: [
    {
      name: "integration tests",
      testDir: "./tests",
    },
  ],
});
