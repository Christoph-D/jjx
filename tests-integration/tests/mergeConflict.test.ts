import { test, expect } from "./baseTest";

test("resolve merge conflict in merge editor", async ({ graphFrame, testRepo, workbox }) => {
  const baseChange = await testRepo.commitFile("test.txt", "A", "Base commit");
  const changeB = await testRepo.commitFile("test.txt", "B", "Change B");

  await testRepo.jjCommand(["new", baseChange]);
  const changeC = await testRepo.commitFile("test.txt", "C", "Change C");

  await testRepo.jjCommand(["new", changeB, changeC]);

  const conflictResult = await testRepo.log("@");
  expect(conflictResult[0].conflict).toBe(true);

  await expect(graphFrame.locator("#nodes > div").first()).toBeVisible();

  const scmView = workbox.locator(".scm-view").first();
  await scmView.waitFor();

  const conflictedFile = workbox.locator(".scm-view").getByText("test.txt").first();
  await expect(conflictedFile).toBeVisible();
  await conflictedFile.click();

  const mergeEditorLeft = workbox.locator('.monaco-editor[role="code"][data-uri*="left_test.txt"]');
  await expect(mergeEditorLeft).toBeVisible();

  const mergeEditorRight = workbox.locator('.monaco-editor[role="code"][data-uri*="right_test.txt"]');
  await expect(mergeEditorRight).toBeVisible();

  await expect(mergeEditorLeft.locator(".view-line")).toContainText("B");
  await expect(mergeEditorRight.locator(".view-line")).toContainText("C");

  const mergeEditor = workbox.locator('.monaco-editor[role="code"][data-uri*="output_test.txt"]');
  await expect(mergeEditor).toBeVisible();

  const resultEditor = workbox.locator('.monaco-editor[role="code"][data-uri*="output_test.txt"]');
  await resultEditor.click();
  await workbox.keyboard.press("Control+a");
  await workbox.keyboard.type("Merged");

  await workbox.keyboard.press("Control+s");
  await expect(workbox.locator(".tab.active")).not.toHaveClass(/dirty/);
  await workbox.keyboard.press("Control+w");

  await expect(mergeEditor).toBeHidden();

  await expect(async () => {
    const log = await testRepo.log("@");
    expect(log[0].conflict).toBe(false);
  }).toPass();

  const fileContent = await testRepo.readFile("test.txt");
  expect(fileContent.trim()).toBe("Merged");
});
