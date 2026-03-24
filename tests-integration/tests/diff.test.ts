import { test, expect } from "./baseTest";

test("shows diff when clicking modified files", async ({ graphFrame, testRepo, workbox }) => {
  await testRepo.writeFile("deleted-first.txt", "Deleted first");
  await testRepo.writeFile("deleted-second.txt", "Deleted second");
  await testRepo.commitFile("test.txt", "A", "Initial commit");

  await testRepo.writeFile("added-first.txt", "Added first");
  await testRepo.deleteFile("deleted-first.txt");
  await testRepo.commitFile("test.txt", "B", "Second commit");

  await testRepo.writeFile("added-second.txt", "Added second");
  await testRepo.deleteFile("deleted-second.txt");
  await testRepo.writeFile("test.txt", "C");

  await expect(graphFrame.locator("#nodes > div").first()).toBeVisible();
  const scmView = workbox.locator(".scm-view").first();
  await scmView.waitFor();

  // Wait for both test.txt files to appear (Working Copy + Parent Commit)
  const testFiles = scmView.getByRole("treeitem", { name: /test\.txt/ });
  await expect(testFiles).toHaveCount(2);

  const diffEditor = workbox.locator(".editor-instance");
  const originalEditor = diffEditor.locator(".editor.original .view-lines");
  const modifiedEditor = diffEditor.locator(".editor.modified .view-lines");
  const validateDiff = async (left: string, right: string) => {
    await expect(diffEditor).toBeVisible();
    if (left !== "") {
      await expect(originalEditor.getByText(left, { exact: true }).first()).toBeVisible();
    } else {
      await expect(originalEditor).toHaveText(/^\s*$/);
    }
    if (right !== "") {
      await expect(modifiedEditor.getByText(right, { exact: true }).first()).toBeVisible();
    } else {
      await expect(modifiedEditor).toHaveText(/^\s*$/);
    }
  };

  // Click the first one (Working Copy)
  await testFiles.first().click();
  await validateDiff("B", "C");

  // Click the second one (Parent Commit)
  await testFiles.nth(1).click();
  await validateDiff("A", "B");

  // Deleted files
  const deletedFirstItems = scmView.getByRole("treeitem", { name: /deleted-first\.txt/ });
  await expect(deletedFirstItems).toHaveCount(1);
  await deletedFirstItems.first().click();
  await validateDiff("Deleted first", "");

  const deletedSecondItems = scmView.getByRole("treeitem", { name: /deleted-second\.txt/ });
  await expect(deletedSecondItems).toHaveCount(1);
  await deletedSecondItems.first().click();
  await validateDiff("Deleted second", "");

  // Added files
  const addedFirstItems = scmView.getByRole("treeitem", { name: /added-first\.txt/ });
  await expect(addedFirstItems).toHaveCount(1);
  await addedFirstItems.first().click();
  await validateDiff("", "Added first");

  const addedSecondItems = scmView.getByRole("treeitem", { name: /added-second\.txt/ });
  await expect(addedSecondItems).toHaveCount(1);
  await addedSecondItems.first().click();
  await validateDiff("", "Added second");
});
