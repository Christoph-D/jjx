import { defineConfig } from "@playwright/test";

export type TestOptions = {
  vscodeVersion: string;
};

export default defineConfig<void, TestOptions>({
  reporter: process.env.CI ? [["list"], ["html", { open: "never" }]] : "list",
  timeout: 60_000,
  workers: 4,
  fullyParallel: true,
  use: {
    screenshot: "only-on-failure",
  },
  expect: {
    timeout: 20_000,
  },
  globalSetup: "./globalSetup",
  projects: [
    {
      name: "integration tests",
      testDir: "./tests",
    },
  ],
});
