import { test, expect, mod } from "./baseTest";
import type { Locator } from "@playwright/test";

async function openFile(workbox: import("@playwright/test").Page, fileName: string): Promise<Locator> {
  await workbox.keyboard.press(`${mod}+p`);
  const quickOpen = workbox.locator(".quick-input-widget");
  await expect(quickOpen).toBeVisible();
  await workbox.keyboard.type(fileName);
  const result = quickOpen.locator(".monaco-list-row").first();
  await expect(result).toBeVisible();
  await result.click();

  const editor = workbox.locator('.monaco-editor[role="code"][data-uri^="file://"]');
  await expect(editor).toBeVisible();
  return editor;
}

async function hasAnnotation(locator: Locator, text: string): Promise<boolean> {
  return locator.evaluate((el, searchText) => {
    const elements = el.querySelectorAll("*");
    for (const element of elements) {
      try {
        const afterContent = window.getComputedStyle(element, "::after").content;
        if (afterContent && afterContent !== "none" && afterContent !== "normal") {
          const clean = afterContent.replace(/^"|"$/g, "").replace(/^'|'$/g, "");
          if (clean.includes(searchText)) {
            return true;
          }
        }
      } catch {
        // Some elements may not support ::after
      }
    }
    return false;
  }, text);
}

test("blame annotations appear in the editor", async ({ graphFrame, testRepo, workbox }) => {
  await testRepo.commitFile("a.txt", "line 1\nline 2 (original)\n", "First commit");
  await testRepo.writeFile("a.txt", "line 1\nline 2 (modified)\n");
  await testRepo.commit("Second commit");

  await expect(graphFrame.locator("#nodes > div").first()).toBeVisible();

  const editor = await openFile(workbox, "a.txt");
  await editor.click();

  await workbox.keyboard.press("Control+Home");
  await workbox.keyboard.press("ArrowDown");

  await expect(async () => {
    expect(await hasAnnotation(editor, "Second commit")).toBe(true);
  }).toPass();

  await workbox.keyboard.press("Control+Home");

  await expect(async () => {
    expect(await hasAnnotation(editor, "First commit")).toBe(true);
  }).toPass();

  await testRepo.writeFile(".vscode/settings.json", '{"jjx.enableAnnotations": false}');

  await expect(async () => {
    expect(await hasAnnotation(editor, "First commit")).toBe(false);
  }).toPass();

  await testRepo.writeFile(".vscode/settings.json", '{"jjx.enableAnnotations": true}');

  await expect(async () => {
    expect(await hasAnnotation(editor, "First commit")).toBe(true);
  }).toPass();
});
