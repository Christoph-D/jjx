import { test, expect } from "./base-test";

test("showChangedFiles off by default hides changed-files UI", async ({ graphFrame, testRepo }) => {
  await testRepo.commitFile("a.txt", "content a", "commit A");
  await testRepo.commitFile("b.txt", "content b", "commit B");

  await expect(graphFrame.locator("#nodes > div").first()).toBeVisible();
  await expect(graphFrame.locator('[data-role="changed-file"]')).toHaveCount(0);
});

test.describe("with showChangedFiles enabled", () => {
  test.use({ customSettings: { "jjx.showChangedFiles": true } });

  test("showChangedFiles renders files and click opens diff", async ({ graphFrame, testRepo, workbox }) => {
    await testRepo.commitFile("a.txt", "content a", "commit A");
    await testRepo.commitFile("b.txt", "content b", "commit B");

    await expect(graphFrame.locator('[data-role="changed-file"][data-path="a.txt"]')).toBeVisible();
    await expect(graphFrame.locator('[data-role="changed-file"][data-path="b.txt"]')).toBeVisible();

    const aFile = graphFrame.locator('[data-role="changed-file"][data-path="a.txt"]');
    await aFile.click();

    const diffEditor = workbox.locator(".editor-instance");
    await expect(diffEditor).toBeVisible();
    // a.txt is Added in commit A: original is empty, modified contains the content.
    const original = workbox.locator(".editor.original .view-lines");
    const modified = workbox.locator(".editor.modified .view-lines");
    await expect(original).toHaveText(/^\s*$/);
    await expect(modified.getByText("content a", { exact: true }).first()).toBeVisible();
  });

  test("conflicted file with a regular diff entry keeps the conflict indicator", async ({ graphFrame, testRepo }) => {
    // Two sibling branches each add conflict.txt with different content, so
    // merging them produces a conflict.
    const baseChange = await testRepo.commitFile("base.txt", "base", "Base commit");

    await testRepo.writeFile("conflict.txt", "B");
    const changeB = await testRepo.commit("Change B");

    await testRepo.jjCommand(["new", baseChange]);
    await testRepo.writeFile("conflict.txt", "C");
    const changeC = await testRepo.commit("Change C");

    // Merge both branches, then copy the conflicted file into a new change on
    // top of the base commit. That change adds conflict.txt with a conflict
    // relative to its parent, so the file shows up in the diff with a plain
    // status letter (A) while also being conflicted.
    await testRepo.jjCommand(["new", changeB, changeC]);
    await testRepo.jjCommand(["describe", "-m", "merge"]);
    const mergeChangeId = (await testRepo.log("@"))[0].change_id;

    await testRepo.jjCommand(["new", baseChange]);
    await testRepo.jjCommand(["restore", "--from", mergeChangeId, "conflict.txt"]);
    await testRepo.writeFile("plain.txt", "plain");
    await testRepo.jjCommand(["describe", "-m", "adds conflicted file"]);
    const conflictedChangeId = (await testRepo.log("@"))[0].change_id;

    const changeRow = graphFrame.locator(`#nodes > div[data-change-id^="${conflictedChangeId}/"]`);
    await expect(changeRow).toBeVisible();

    const conflictFile = changeRow.locator('[data-role="changed-file"][data-path="conflict.txt"]');
    await expect(conflictFile).toBeVisible();
    // The status letter keeps its plain meaning but is marked as conflicted
    // (A! with conflict color), not rendered as a regular addition.
    await expect(conflictFile).toHaveAttribute("data-conflict", "");
    await expect(conflictFile.locator("span").first()).toHaveText("A!");

    const plainFile = changeRow.locator('[data-role="changed-file"][data-path="plain.txt"]');
    await expect(plainFile).toBeVisible();
    await expect(plainFile).not.toHaveAttribute("data-conflict", "");
    await expect(plainFile.locator("span").first()).toHaveText("A");
  });
});
