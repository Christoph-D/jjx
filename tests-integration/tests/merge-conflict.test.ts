import { test, expect, waitForSCMView, mod, runCommand } from "./base-test";

test("resolve merge conflict in merge editor", async ({ graphFrame, testRepo, workbox }) => {
  await testRepo.writeFile("file1.txt", "A");
  await testRepo.writeFile("file2.txt", "A");
  const baseChange = await testRepo.commit("Base commit");

  await testRepo.writeFile("file1.txt", "B");
  await testRepo.writeFile("file2.txt", "B");
  const changeB = await testRepo.commit("Change B");

  await testRepo.jjCommand(["new", baseChange]);
  await testRepo.writeFile("file1.txt", "C");
  await testRepo.writeFile("file2.txt", "C");
  const changeC = await testRepo.commit("Change C");

  await testRepo.jjCommand(["new", changeB, changeC]);

  const conflictResult = await testRepo.log("@");
  expect(conflictResult[0].conflict).toBe(true);

  await expect(graphFrame.locator("#nodes > div").first()).toBeVisible();

  const scmView = await waitForSCMView(workbox, ["file1.txt", "file2.txt"], ["file1.txt", "file2.txt"]);

  await expect(scmView.getByRole("treeitem", { name: /Working Copy \(conflict\)/ })).toBeVisible();

  const file1Item = scmView.getByRole("treeitem", { name: /file1\.txt/ });
  await file1Item.first().click();

  const mergeEditor1Left = workbox.locator('.monaco-editor[role="code"][data-uri*="left_file1.txt"]');
  await expect(mergeEditor1Left).toBeVisible();

  const mergeEditor1Right = workbox.locator('.monaco-editor[role="code"][data-uri*="right_file1.txt"]');
  await expect(mergeEditor1Right).toBeVisible();

  await expect(mergeEditor1Left.locator(".view-line")).toContainText("B");
  await expect(mergeEditor1Right.locator(".view-line")).toContainText("C");

  const mergeEditor1Output = workbox.locator('.monaco-editor[role="code"][data-uri*="/file1.txt"]');
  await expect(mergeEditor1Output).toBeVisible();

  await mergeEditor1Output.click();
  await workbox.keyboard.press(`${mod}+a`);
  await workbox.keyboard.type("Merged1");

  await workbox.keyboard.press(`${mod}+s`);
  await expect(workbox.locator(".tab.active")).not.toHaveClass(/dirty/);

  const file2Item = scmView.getByRole("treeitem", { name: /file2\.txt/ });
  await file2Item.first().click();

  const mergeEditor2Left = workbox.locator('.monaco-editor[role="code"][data-uri*="left_file2.txt"]');
  await expect(mergeEditor2Left).toBeVisible();

  const mergeEditor2Right = workbox.locator('.monaco-editor[role="code"][data-uri*="right_file2.txt"]');
  await expect(mergeEditor2Right).toBeVisible();

  await expect(mergeEditor2Left.locator(".view-line")).toContainText("B");
  await expect(mergeEditor2Right.locator(".view-line")).toContainText("C");

  const mergeEditor2Output = workbox.locator('.monaco-editor[role="code"][data-uri*="/file2.txt"]');
  await expect(mergeEditor2Output).toBeVisible();

  await mergeEditor2Output.click();
  await workbox.keyboard.press(`${mod}+a`);
  await workbox.keyboard.type("Merged2");

  await workbox.keyboard.press(`${mod}+s`);
  await expect(workbox.locator(".tab.active")).not.toHaveClass(/dirty/);

  await runCommand(workbox, "View: Close All Editors");
  await expect(mergeEditor1Output).toBeHidden();
  await expect(mergeEditor2Output).toBeHidden();

  await expect(async () => {
    const log = await testRepo.log("@");
    expect(log[0].conflict).toBe(false);
  }).toPass();

  const file1Content = await testRepo.readFile("file1.txt");
  expect(file1Content.trim()).toBe("Merged1");

  const file2Content = await testRepo.readFile("file2.txt");
  expect(file2Content.trim()).toBe("Merged2");
});

// Returns the badge text (e.g. "A", "A!", "M!") shown next to each file in the
// given SCM section. VS Code renders file decoration badges as CSS ::after
// content, so the text is read from the computed style.
async function sectionFileBadges(
  workbox: import("@playwright/test").Page,
  sectionLabel: string,
): Promise<Record<string, string>> {
  return workbox.getByRole("tree", { name: "Source Control Management" }).evaluate((el, sectionLabel) => {
    const items = Array.from(el.querySelectorAll("[role='treeitem']"));
    let inSection = false;
    const badges: Record<string, string> = {};
    for (const item of items) {
      if (item.getAttribute("aria-level") === "1") {
        inSection = (item.getAttribute("aria-label") ?? "").includes(sectionLabel);
      } else if (inSection && item.getAttribute("aria-level") === "2") {
        const fileName = (item.getAttribute("aria-label") ?? "").split(",")[0].trim();
        const label = item.querySelector(".monaco-icon-label[class*='decoration-itemBadge']");
        if (fileName && label) {
          badges[fileName] = getComputedStyle(label, "::after").content.replace(/^"|"$/g, "");
        }
      }
    }
    return badges;
  }, sectionLabel);
}

test("selecting a conflicted non-parent change shows conflict status", async ({ graphFrame, testRepo, workbox }) => {
  // Two sibling branches each add conflict.txt with different content, so
  // merging them produces a conflict.
  const baseChange = await testRepo.commitFile("base.txt", "base", "Base commit");

  await testRepo.writeFile("conflict.txt", "B");
  const changeB = await testRepo.commit("Change B");

  await testRepo.jjCommand(["new", baseChange]);
  await testRepo.writeFile("conflict.txt", "C");
  const changeC = await testRepo.commit("Change C");

  // Merge both branches, then copy the conflicted file into a new change on top
  // of the base commit. That change adds conflict.txt with a conflict relative
  // to its parent.
  await testRepo.jjCommand(["new", changeB, changeC]);
  await testRepo.jjCommand(["describe", "-m", "merge"]);
  const mergeChangeId = (await testRepo.log("@"))[0].change_id;

  await testRepo.jjCommand(["new", baseChange]);
  await testRepo.jjCommand(["restore", "--from", mergeChangeId, "conflict.txt"]);
  await testRepo.jjCommand(["describe", "-m", "adds conflicted file"]);
  const conflictedChangeId = (await testRepo.log("@"))[0].change_id;

  // Move the working copy two changes ahead so the conflicted change is
  // neither the working copy nor one of its parents.
  await testRepo.jjCommand(["new"]);
  await testRepo.jjCommand(["new"]);

  const nodes = graphFrame.locator("#nodes > div");
  await expect(nodes).toHaveCount(8); // @, empty, conflicted change, merge, B, C, base, root

  // The conflict propagates to descendants, so the working copy and its parent
  // list conflict.txt as conflicted (X!) as well.
  const scmView = await waitForSCMView(workbox, ["conflict.txt"], ["conflict.txt"]);

  // Single-click the conflicted change (a non-parent change).
  const conflictedNode = graphFrame.locator(`#nodes > div[data-change-id^="${conflictedChangeId}/"]`);
  await conflictedNode.click();
  await expect(conflictedNode).toHaveAttribute("data-selected");

  // The Selected Commit section lists conflict.txt as added-with-conflict (A!),
  // not as a plain addition (A).
  await expect(async () => {
    expect(await sectionFileBadges(workbox, "Selected Commit")).toEqual({ "conflict.txt": "A!" });
  }).toPass();

  // Clicking the conflicted file opens the merge editor (left shows B's content,
  // right shows C's content), not a plain diff.
  const conflictItem = scmView.getByRole("treeitem", { name: /conflict\.txt/ }).last();
  await conflictItem.click();

  const mergeEditorLeft = workbox.locator('.monaco-editor[role="code"][data-uri*="left_conflict.txt"]');
  await expect(mergeEditorLeft).toBeVisible();
  await expect(mergeEditorLeft.locator(".view-line")).toContainText("B");

  const mergeEditorRight = workbox.locator('.monaco-editor[role="code"][data-uri*="right_conflict.txt"]');
  await expect(mergeEditorRight).toBeVisible();
  await expect(mergeEditorRight.locator(".view-line")).toContainText("C");
});
