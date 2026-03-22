import { defineConfig } from "@playwright/test";

export type TestOptions = {
  vscodeVersion: string;
};

export default defineConfig<void, TestOptions>({
  reporter: "list",
  timeout: 120_000,
  workers: 1,
  expect: {
    timeout: 30_000,
  },
  globalSetup: "./globalSetup",
});
