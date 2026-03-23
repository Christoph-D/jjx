import { test, expect } from "./baseTest";

test("shows diff when clicking modified file in Working Copy", async ({ graphFrame, testRepo, workbox }) => {
  await testRepo.commitFile("test.txt", "A", "Initial commit");
  await testRepo.writeFile("test.txt", "B");

  await expect(graphFrame.locator("#nodes > div").first()).toBeVisible({ timeout: 10000 });

  const fileItem = workbox.getByRole("treeitem", { name: /test\.txt/ }).first();
  await expect(fileItem).toBeVisible();
  await fileItem.click();

  const diffEditor = workbox.locator(".editor-instance");
  await expect(diffEditor).toBeVisible();
  await expect(diffEditor.getByText("A", { exact: true }).first()).toBeVisible({ timeout: 10000 });
  await expect(diffEditor.getByText("B", { exact: true }).first()).toBeVisible({ timeout: 10000 });
});

test("shows diff when clicking modified file in Parent Commit", async ({ graphFrame, testRepo, workbox }) => {
  await testRepo.commitFile("test.txt", "A", "Initial commit");
  await testRepo.commitFile("test.txt", "B", "Second commit");
  await testRepo.writeFile("test.txt", "C");

  await expect(graphFrame.locator("#nodes > div").first()).toBeVisible({ timeout: 10000 });

  const fileItem = workbox.getByRole("treeitem", { name: /test\.txt/ }).nth(1);
  await expect(fileItem).toBeVisible();
  await fileItem.click();

  const diffEditor = workbox.locator(".editor-instance");
  await expect(diffEditor).toBeVisible();
  await expect(diffEditor.getByText("A", { exact: true }).first()).toBeVisible({ timeout: 10000 });
  await expect(diffEditor.getByText("B", { exact: true }).first()).toBeVisible({ timeout: 10000 });

  const fileItemWorkingCopy = workbox.getByRole("treeitem", { name: /test\.txt/ }).nth(0);
  await expect(fileItemWorkingCopy).toBeVisible();
  await fileItemWorkingCopy.click();

  const diffEditorWorkingCopy = workbox.locator(".editor-instance");
  await expect(diffEditorWorkingCopy).toBeVisible();
  await expect(diffEditorWorkingCopy.getByText("B", { exact: true }).first()).toBeVisible({ timeout: 10000 });
  await expect(diffEditorWorkingCopy.getByText("C", { exact: true }).first()).toBeVisible({ timeout: 10000 });
});
