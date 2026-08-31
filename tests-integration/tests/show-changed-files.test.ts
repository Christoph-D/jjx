import { test, expect, clickFileMenuItem, runCommand, canonicalPath } from "./base-test";
import path from "path";

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

  test("changed-file context menu matches the SCM view context menu", async ({
    graphFrame,
    testRepo,
    workbox,
    electronApp,
  }) => {
    await testRepo.commitFile("a.txt", "content a", "commit A");
    await testRepo.writeFile("a.txt", "modified a");

    const workingCopyChangeId = (await testRepo.log("@"))[0].change_id;
    const commitAChangeId = (await testRepo.log("@-"))[0].change_id;

    const workingCopyFile = graphFrame
      .locator(`#nodes > div[data-change-id^="${workingCopyChangeId}/"]`)
      .locator('[data-role="changed-file"][data-path="a.txt"]');
    const commitAFile = graphFrame
      .locator(`#nodes > div[data-change-id^="${commitAChangeId}/"]`)
      .locator('[data-role="changed-file"][data-path="a.txt"]');
    await expect(workingCopyFile).toBeVisible();
    await expect(commitAFile).toBeVisible();

    const menu = graphFrame.locator("#file-context-menu");

    // Working-copy changes have no "Open File in Working Copy" entry (the file
    // already is the working copy), matching the @ SCM resource group.
    await test.step("working-copy file menu entries", async () => {
      await workingCopyFile.click({ button: "right" });
      await expect(menu).toBeVisible();
      await expect(menu.locator("[data-action]")).toHaveText([
        "View as Diff",
        "Open File",
        "Copy Path",
        "Copy Relative Path",
      ]);
      await graphFrame.locator("#nodes > div").first().click();
      await expect(menu).not.toBeVisible();
    });

    // Non-working-copy changes additionally offer "Open File in Working Copy".
    await test.step("non-working-copy file menu entries", async () => {
      await commitAFile.click({ button: "right" });
      await expect(menu).toBeVisible();
      await expect(menu.locator("[data-action]")).toHaveText([
        "View as Diff",
        "Open File",
        "Open File in Working Copy",
        "Copy Path",
        "Copy Relative Path",
      ]);
      await graphFrame.locator("#nodes > div").first().click();
      await expect(menu).not.toBeVisible();
    });

    await test.step("View as Diff on a non-working-copy change opens the change's diff", async () => {
      await clickFileMenuItem(graphFrame, commitAFile, "View as Diff");
      const diffEditor = workbox.locator(".editor-instance");
      await expect(diffEditor).toBeVisible();
      await expect(diffEditor.locator(".editor.original .view-lines")).toHaveText(/^\s*$/);
      await expect(diffEditor.locator(".editor.modified .view-lines").getByText("content a").first()).toBeVisible();
      await runCommand(workbox, "Close All Editors");
    });

    await test.step("Open File on a non-working-copy change opens the file at that revision", async () => {
      await clickFileMenuItem(graphFrame, commitAFile, "Open File");
      const atRevEditor = workbox.locator('.monaco-editor[role="code"][data-uri*="a.txt"]');
      await expect(atRevEditor.getByText("content a").first()).toBeVisible();
      await expect(workbox.locator(".tab.active")).toContainText("a.txt");
      await runCommand(workbox, "Close All Editors");
    });

    await test.step("Open File in Working Copy opens the live working-copy file", async () => {
      await clickFileMenuItem(graphFrame, commitAFile, "Open File in Working Copy");
      const openEditor = workbox.locator('.monaco-editor[role="code"][data-uri*="a.txt"]');
      await expect(workbox.locator(".tab.active")).toContainText("a.txt");
      await expect(openEditor.getByText("modified a").first()).toBeVisible();
      await runCommand(workbox, "Close All Editors");
    });

    await test.step("Open File on a working-copy change opens the live working-copy file", async () => {
      await clickFileMenuItem(graphFrame, workingCopyFile, "Open File");
      const openEditor = workbox.locator('.monaco-editor[role="code"][data-uri*="a.txt"]');
      await expect(openEditor.getByText("modified a").first()).toBeVisible();
      await runCommand(workbox, "Close All Editors");
    });

    await test.step("Copy Path copies the absolute path", async () => {
      await clickFileMenuItem(graphFrame, commitAFile, "Copy Path");
      await expect
        .poll(async () =>
          canonicalPath(
            await electronApp.evaluate(({ clipboard }: { clipboard: { readText: () => string } }) =>
              clipboard.readText(),
            ),
          ),
        )
        .toBe(canonicalPath(path.join(testRepo.repoPath, "a.txt")));
    });

    await test.step("Copy Relative Path copies the repository-relative path", async () => {
      await clickFileMenuItem(graphFrame, commitAFile, "Copy Relative Path");
      await expect
        .poll(() =>
          electronApp.evaluate(({ clipboard }: { clipboard: { readText: () => string } }) => clipboard.readText()),
        )
        .toBe("a.txt");
    });
  });
});
