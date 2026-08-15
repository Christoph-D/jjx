import { test, expect, waitForSCMView, runCommand } from "./base-test";

test("shows diff when clicking modified files", async ({ graphFrame, testRepo, workbox }) => {
  await testRepo.writeFile("deleted-first.txt", "Deleted first");
  await testRepo.writeFile("deleted-second.txt", "Deleted second");
  await testRepo.writeFile("moved.txt", "Line 1\nLine 2\nLine 3\nLine 4\nLine 5\n");
  await testRepo.writeFile("subdir/nested.txt", "Original content\nLine 2\n");
  await testRepo.commitFile("test.txt", "A", "Initial commit");

  await testRepo.writeFile("added-first.txt", "Added first");
  await testRepo.deleteFile("deleted-first.txt");
  await testRepo.deleteFile("moved.txt");
  await testRepo.writeFile("moved2.txt", "Line 1\nLine 2\nLine 3 changed\nLine 4\nLine 5\n");
  await testRepo.commitFile("test.txt", "B", "Second commit");

  await testRepo.writeFile("added-second.txt", "Added second");
  await testRepo.deleteFile("deleted-second.txt");
  await testRepo.writeFile("test.txt", "C");
  await testRepo.writeFile("subdir/nested.txt", "Modified content\nLine 2\n");

  await expect(graphFrame.locator("#nodes > div").first()).toBeVisible();

  const scmView = await waitForSCMView(workbox, ["test.txt", "nested.txt"], ["test.txt"]);

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

  // Moved file
  const movedFile = scmView.getByRole("treeitem", { name: /moved2\.txt/ });
  await expect(movedFile).toHaveCount(1);
  await movedFile.click();
  await validateDiff("Line 3", "Line 3 changed");
  await expect(workbox.getByRole("tab", { name: /moved\.txt → moved2\.txt/ })).toBeVisible();

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

  // Test path separators with a file in a subdirectory
  const nestedFile = scmView.getByRole("treeitem", { name: /nested\.txt/ });
  await expect(nestedFile).toHaveCount(1);
  await nestedFile.first().click();
  await validateDiff("Original content", "Modified content");
});

test("toggle diff view switches between file and diff editors", async ({ graphFrame, testRepo, workbox }) => {
  test.slow();
  // Parent commit diffs: a.txt (FIRST -> SECOND), deleted.txt (deleted),
  // added.txt (added). Working copy diffs: a.txt (SECOND -> THIRD),
  // added.txt (ADDED -> CHANGED).
  await testRepo.commitFile("a.txt", "FIRST", "First commit");
  await testRepo.commitFile("deleted.txt", "KEEP ME", "Second commit");
  await testRepo.writeFile("a.txt", "SECOND");
  await testRepo.deleteFile("deleted.txt");
  await testRepo.writeFile("added.txt", "ADDED");
  await testRepo.commit("Third commit");
  await testRepo.writeFile("a.txt", "THIRD");
  await testRepo.writeFile("added.txt", "CHANGED");

  await expect(graphFrame.locator("#nodes > div").first()).toBeVisible();
  const scmView = await waitForSCMView(workbox, ["a.txt", "added.txt"], ["a.txt", "added.txt", "deleted.txt"]);

  const diffEditor = workbox.locator(".editor-instance");
  const originalPane = diffEditor.locator(".editor.original .view-lines");
  const modifiedPane = diffEditor.locator(".editor.modified .view-lines");

  const expectDiff = async (left: string, right: string) => {
    await expect(modifiedPane).toBeVisible();
    if (left !== "") {
      await expect(originalPane.getByText(left, { exact: true })).toBeVisible();
    } else {
      await expect(originalPane).toHaveText(/^\s*$/);
    }
    if (right !== "") {
      await expect(modifiedPane.getByText(right, { exact: true })).toBeVisible();
    } else {
      await expect(modifiedPane).toHaveText(/^\s*$/);
    }
  };

  const expectFile = async (content: string) => {
    await expect(modifiedPane).toBeHidden();
    await expect(diffEditor.locator(".monaco-editor .view-lines").getByText(content, { exact: true })).toBeVisible();
  };

  const aFileItems = scmView.getByRole("treeitem", { name: /a\.txt/ });
  await expect(aFileItems).toHaveCount(2);

  // Diff at revision -> file at that revision
  await aFileItems.nth(1).click();
  await expectDiff("FIRST", "SECOND");
  await runCommand(workbox, "Toggle Diff View");
  await expectFile("SECOND");

  // File at revision -> diff at that revision
  await runCommand(workbox, "Toggle Diff View");
  await expectDiff("FIRST", "SECOND");

  await runCommand(workbox, "View: Close All Editors");

  // Working-copy diff -> plain working-copy file
  await aFileItems.first().click();
  await expectDiff("SECOND", "THIRD");
  await runCommand(workbox, "Toggle Diff View");
  await expectFile("THIRD");

  // Plain working-copy file -> working-copy diff
  await runCommand(workbox, "Toggle Diff View");
  await expectDiff("SECOND", "THIRD");

  // Deleted file in the parent commit
  await runCommand(workbox, "View: Close All Editors");
  const deletedItems = scmView.getByRole("treeitem", { name: /deleted\.txt/ });
  await expect(deletedItems).toHaveCount(1);

  // The deletion diff's modified side is an empty "deleted" resource, so it
  // can't be toggled to a single editor. The toggle command leaves the diff in
  // place (and the toggle button is hidden for this diff).
  await deletedItems.first().click();
  await expectDiff("KEEP ME", "");
  await runCommand(workbox, "Toggle Diff View");
  await expectDiff("KEEP ME", "");

  // Added file in the parent commit
  await runCommand(workbox, "View: Close All Editors");
  const addedItems = scmView.getByRole("treeitem", { name: /added\.txt/ });
  await expect(addedItems).toHaveCount(2);

  // Open the addition diff (empty original, "ADDED" modified), then toggle to
  // a single editor showing the added content instead of doing nothing.
  await addedItems.last().click();
  await expectDiff("", "ADDED");
  await runCommand(workbox, "Toggle Diff View");
  await expectFile("ADDED");

  // Toggle back to the addition diff.
  await runCommand(workbox, "Toggle Diff View");
  await expectDiff("", "ADDED");
});

test.describe("with the at-revision file click action", () => {
  test.use({ customSettings: { "jjx.fileClickAction": "at-revision" } });

  test("clicking a parent file opens it at that revision with a short change ID tab title", async ({
    graphFrame,
    testRepo,
    workbox,
  }) => {
    await testRepo.commitFile("a.txt", "FIRST", "First commit");
    await testRepo.writeFile("a.txt", "SECOND");
    await testRepo.commit("Second commit");
    await testRepo.writeFile("a.txt", "THIRD");

    await expect(graphFrame.locator("#nodes > div").first()).toBeVisible();
    const scmView = await waitForSCMView(workbox, ["a.txt"], ["a.txt"]);

    const aFileItems = scmView.getByRole("treeitem", { name: /a\.txt/ });
    await expect(aFileItems).toHaveCount(2);

    await aFileItems.nth(1).click();

    await expect(
      workbox.locator(".monaco-editor .view-lines").getByText("SECOND", { exact: true }).first(),
    ).toBeVisible();

    // The tab title names the revision with the same short change ID form the
    // diff title uses, not the full change ID.
    const tab = workbox.getByRole("tab", { name: /a\.txt \([a-z0-9]+\)/ });
    await expect(tab).toBeVisible();
    const label = await tab.getAttribute("aria-label");
    const shortChangeId = label!.match(/a\.txt \(([a-z0-9]+)\)/)![1];
    const parent = (await testRepo.log("@-"))[0];
    expect(parent.change_id.startsWith(shortChangeId)).toBe(true);
  });
});
