import { test, expect } from "./baseTest";

test("shows diff when clicking modified file in Working Copy", async ({ graphFrame, testRepo, workbox }) => {
  await testRepo.commitFile("test.txt", "A", "Initial commit");
  await testRepo.writeFile("test.txt", "B");

  await expect(graphFrame.locator("#nodes > div").first()).toBeVisible();

  // Wait for both test.txt files to appear (Working Copy + Parent Commit)
  // Working Copy file appears after extension detects the change
  const testFiles = workbox.getByRole("treeitem", { name: /test\.txt/ });
  await expect(testFiles).toHaveCount(2, { timeout: 10000 });

  // Click the first one (Working Copy)
  await testFiles.first().click();

  const diffEditor = workbox.locator(".editor-instance");
  await expect(diffEditor).toBeVisible();
  await expect(diffEditor.getByText("A", { exact: true }).first()).toBeVisible();
  await expect(diffEditor.getByText("B", { exact: true }).first()).toBeVisible();
});

test("shows diff when clicking modified file in Parent Commit", async ({ graphFrame, testRepo, workbox }) => {
  await testRepo.commitFile("test.txt", "A", "Initial commit");
  await testRepo.commitFile("test.txt", "B", "Second commit");
  await testRepo.writeFile("test.txt", "C");

  await expect(graphFrame.locator("#nodes > div").first()).toBeVisible();

  // Wait for both test.txt files to appear (Working Copy + Parent Commit)
  const testFiles = workbox.getByRole("treeitem", { name: /test\.txt/ });
  await expect(testFiles).toHaveCount(2, { timeout: 10000 });

  // Click the second one (Parent Commit)
  const fileItem = testFiles.nth(1);
  await fileItem.click();

  const diffEditor = workbox.locator(".editor-instance");
  await expect(diffEditor).toBeVisible();
  await expect(diffEditor.getByText("A", { exact: true }).first()).toBeVisible();
  await expect(diffEditor.getByText("B", { exact: true }).first()).toBeVisible();

  // Click the first one (Working Copy)
  const fileItemWorkingCopy = testFiles.first();
  await fileItemWorkingCopy.click();

  const diffEditorWorkingCopy = workbox.locator(".editor-instance");
  await expect(diffEditorWorkingCopy).toBeVisible();
  await expect(diffEditorWorkingCopy.getByText("B", { exact: true }).first()).toBeVisible();
  await expect(diffEditorWorkingCopy.getByText("C", { exact: true }).first()).toBeVisible();
});
