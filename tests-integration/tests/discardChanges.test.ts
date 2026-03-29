import { test, expect } from "./baseTest";

test("discard changes for a single file via inline button", async ({ graphFrame, testRepo, workbox }) => {
  await testRepo.commitFile("a.txt", "original", "A");

  await testRepo.writeFile("a.txt", "modified");
  await testRepo.writeFile("b.txt", "new file");

  await expect(graphFrame.locator("#nodes > div").first()).toBeVisible();

  const scmView = workbox.locator(".scm-view").first();
  await scmView.waitFor();

  const scmTree = workbox.getByRole("tree", { name: "Source Control Management" });

  const aFileItem = scmTree.getByRole("treeitem", { name: /^a\.txt/ }).first();
  await expect(aFileItem).toBeVisible();
  await aFileItem.hover();

  const discardButton = aFileItem.getByRole("button", { name: "Discard Changes" });
  await expect(discardButton).toBeVisible();
  await discardButton.click();

  const dialog = workbox.locator(".monaco-dialog-box");
  await expect(dialog).toBeVisible();

  const confirmDiscard = dialog.getByRole("button", { name: "Discard" });
  await confirmDiscard.click();

  await expect(scmTree.getByRole("treeitem", { name: /^a\.txt/ })).toHaveCount(1);

  await expect(async () => {
    const content = await testRepo.readFile("a.txt");
    expect(content).toBe("original");
  }).toPass();

  const bFileItem = scmTree.getByRole("treeitem", { name: /^b\.txt/ });
  await expect(bFileItem).toBeVisible();
});

test("discard changes for entire resource group via inline button", async ({ graphFrame, testRepo, workbox }) => {
  await testRepo.commitFile("a.txt", "original", "A");

  await testRepo.writeFile("a.txt", "modified");
  await testRepo.writeFile("b.txt", "new file");

  await expect(graphFrame.locator("#nodes > div").first()).toBeVisible();

  const scmView = workbox.locator(".scm-view").first();
  await scmView.waitFor();

  const scmTree = workbox.getByRole("tree", { name: "Source Control Management" });
  const bFileItem = scmTree.getByRole("treeitem", { name: /^b\.txt/ }).first();
  await expect(bFileItem).toBeVisible();

  const workingCopyItem = scmTree.getByRole("treeitem", { name: "Working Copy" });
  await expect(workingCopyItem).toBeVisible();
  await workingCopyItem.hover();

  const discardButton = workingCopyItem.getByRole("button", { name: "Discard Changes" });
  await expect(discardButton).toBeVisible();
  await discardButton.click();

  const dialog = workbox.locator(".monaco-dialog-box");
  await expect(dialog).toBeVisible();

  const confirmDiscard = dialog.getByRole("button", { name: "Discard" });
  await confirmDiscard.click();

  await expect(scmTree.getByRole("treeitem", { name: /^a\.txt/ })).toHaveCount(1);
  await expect(scmTree.getByRole("treeitem", { name: /^b\.txt/ })).toHaveCount(0);

  await expect(async () => {
    const content = await testRepo.readFile("a.txt");
    expect(content).toBe("original");
  }).toPass();

  await expect(async () => {
    const diffResult = await testRepo.jjCommand(["diff", "--name-only"]);
    expect(diffResult.stdout.trim()).toBe("");
  }).toPass();
});
