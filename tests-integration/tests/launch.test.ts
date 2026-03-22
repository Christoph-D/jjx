import { test, expect } from "./baseTest";

test("VS Code launches with jjx extension", async ({ workbox }) => {
  await expect(workbox.locator(".monaco-workbench")).toBeVisible({ timeout: 30000 });
});
