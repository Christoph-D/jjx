import { defineConfig } from "@playwright/test";

export type TestOptions = {
  vscodeVersion: string;
};

export default defineConfig<void, TestOptions>({
  reporter: "list",
  timeout: 30_000,
  workers: 4,
  fullyParallel: true,
  expect: {
    timeout: 10_000,
  },
  globalSetup: "./globalSetup",
});
