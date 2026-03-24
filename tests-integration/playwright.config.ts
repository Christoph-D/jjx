import { defineConfig } from "@playwright/test";

export type TestOptions = {
  vscodeVersion: string;
};

export default defineConfig<void, TestOptions>({
  reporter: "list",
  timeout: 60_000,
  workers: 4,
  fullyParallel: true,
  expect: {
    timeout: 20_000,
  },
  globalSetup: "./globalSetup",
  projects: [
    {
      name: "integration tests",
      testMatch: /\.test\.ts/,
    },
  ],
});
