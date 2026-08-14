import { test, expect, handleEditor } from "./base-test";
import type { Frame, Locator, Page } from "@playwright/test";
import { getParents, type TestRepo } from "../test-repo";

/**
 * Right-clicks `node` in the graph, picks "Split..." and returns the frame of the
 * opened Split view webview panel.
 */
async function openSplitView(workbox: Page, graphFrame: Frame, node: Locator): Promise<Frame> {
  await node.click({ button: "right" });
  const splitItem = graphFrame.locator('[data-action="split"]');
  await expect(splitItem).toBeVisible();
  await splitItem.click();

  let splitFrame: Frame | undefined;
  await expect(async () => {
    for (const frame of workbox.frames()) {
      try {
        if ((await frame.locator(".splitRoot").count()) > 0) {
          splitFrame = frame;
          return;
        }
      } catch {
        // The frame can be mid-navigation while the webview (re)loads; just try the next.
      }
    }
    throw new Error("Split view frame not ready");
  }).toPass();
  return splitFrame!;
}

/** The whole split view row (header plus hunk list) of the file `path`. */
function splitFileRow(frame: Frame, path: string): Locator {
  // The split view shows repository-relative paths.
  const pattern = new RegExp(`(?:^|/)${path.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}$`);
  return frame.locator(".splitFile").filter({ has: frame.locator(".splitPath", { hasText: pattern }) });
}

async function changeIdFor(testRepo: TestRepo, description: string): Promise<string> {
  const entry = (await testRepo.log()).find((e) => e.description.trim() === description);
  expect(entry, `Expected to find commit "${description}"`).toBeDefined();
  return entry!.change_id;
}

async function diffSummary(testRepo: TestRepo, changeId: string): Promise<string> {
  return (await testRepo.jjCommand(["diff", "--summary", "-r", changeId])).stdout.trim();
}

async function fileContent(testRepo: TestRepo, changeId: string, path: string): Promise<string> {
  return (await testRepo.jjCommand(["file", "show", "-r", changeId, path])).stdout;
}

test("partial split of a multi-file multi-hunk commit with tri-state checkboxes", async ({
  graphFrame,
  testRepo,
  workbox,
}) => {
  await testRepo.commitFile("f1.txt", "line1\nline2\nline3\nline4\nline5\nline6\n", "Base");
  await testRepo.writeFile("f1.txt", "changed1a\nchanged1b\nline3\nline4\nchanged5\nline6\n");
  await testRepo.writeFile("f2.txt", "added\n");
  await testRepo.commit("Split me");
  await testRepo.commitFile("child.txt", "child\n", "Child");

  const nodes = graphFrame.locator("#nodes > div");
  await expect(nodes).toHaveCount(5);

  const splitFrame = await openSplitView(workbox, graphFrame, nodes.nth(2));
  await expect(splitFrame.locator(".splitFile")).toHaveCount(2);
  await expect(splitFrame.locator(".splitHeaderDescription")).toHaveText("Split me");

  // The modified f1.txt is expanded into two hunks, everything checked initially.
  const f1Row = splitFileRow(splitFrame, "f1.txt");
  const f1Checkbox = f1Row.locator(".splitFileRow input.splitCheckbox");
  await expect(f1Checkbox).toBeChecked();

  const hunks = f1Row.locator(".splitHunk");
  await expect(hunks).toHaveCount(2);
  const hunk1 = hunks.nth(0);
  const hunk2 = hunks.nth(1);
  // A .splitHunk contains its own row plus its line rows, so the hunk checkbox
  // must be scoped to the .splitHunkRow to not match the line checkboxes.
  const hunk1Checkbox = hunk1.locator(".splitHunkRow input.splitCheckbox");
  const hunk2Checkbox = hunk2.locator(".splitHunkRow input.splitCheckbox");
  await expect(hunk1Checkbox).toBeChecked();
  await expect(hunk2Checkbox).toBeChecked();

  // Unchecking a hunk propagates up: the file checkbox becomes indeterminate.
  await hunk2Checkbox.click();
  await expect(hunk2Checkbox).not.toBeChecked();
  await expect(hunk1Checkbox).toBeChecked();
  await expect(f1Checkbox).toBeChecked({ indeterminate: true });

  // Unchecking a single line propagates up through its hunk to the file.
  const changed1bLine = hunk1.locator(".splitLineRow").filter({ hasText: "changed1b" });
  await changed1bLine.locator("input.splitCheckbox").click();
  await expect(changed1bLine.locator("input.splitCheckbox")).not.toBeChecked();
  await expect(hunk1Checkbox).toBeChecked({ indeterminate: true });
  await expect(f1Checkbox).toBeChecked({ indeterminate: true });

  // Checking an indeterminate hunk propagates down and re-checks its lines.
  await hunk1Checkbox.click();
  await expect(changed1bLine.locator("input.splitCheckbox")).toBeChecked();
  await expect(hunk1Checkbox).toBeChecked();

  // Checking an indeterminate file propagates down and re-checks its hunks.
  await f1Checkbox.click();
  await expect(hunk2Checkbox).toBeChecked();
  await expect(f1Checkbox).toBeChecked();

  // Final selection for the first commit: only the first hunk of f1.txt.
  await hunk2Checkbox.click();
  await expect(hunk2Checkbox).not.toBeChecked();
  const f2Checkbox = splitFileRow(splitFrame, "f2.txt").locator("input.splitCheckbox");
  await f2Checkbox.click();
  await expect(f2Checkbox).not.toBeChecked();

  await splitFrame.locator(".splitPrimaryButton").click();

  // jj asks for a description per resulting commit, selected changes first.
  await handleEditor(workbox, "", "Selected part");
  await handleEditor(workbox, "", "Remaining part");

  await expect(nodes).toHaveCount(6);

  await expect(async () => {
    const logEntries = await testRepo.log();
    expect(getParents(logEntries, "Selected part")).toEqual(["Base"]);
    expect(getParents(logEntries, "Remaining part")).toEqual(["Selected part"]);
    expect(getParents(logEntries, "Child")).toEqual(["Remaining part"]);
  }).toPass();

  const selected = await changeIdFor(testRepo, "Selected part");
  const remaining = await changeIdFor(testRepo, "Remaining part");
  const child = await changeIdFor(testRepo, "Child");

  expect(await diffSummary(testRepo, selected)).toBe("M f1.txt");
  expect(await diffSummary(testRepo, remaining)).toBe("M f1.txt\nA f2.txt");

  expect(await fileContent(testRepo, selected, "f1.txt")).toBe("changed1a\nchanged1b\nline3\nline4\nline5\nline6\n");
  expect(await fileContent(testRepo, remaining, "f1.txt")).toBe(
    "changed1a\nchanged1b\nline3\nline4\nchanged5\nline6\n",
  );

  // The rebased descendant sees both parts plus its own change.
  expect(await fileContent(testRepo, child, "f1.txt")).toBe("changed1a\nchanged1b\nline3\nline4\nchanged5\nline6\n");
  expect(await fileContent(testRepo, child, "f2.txt")).toBe("added\n");
  expect(await fileContent(testRepo, child, "child.txt")).toBe("child\n");
});

test("split with nothing selected creates an empty first commit", async ({ graphFrame, testRepo, workbox }) => {
  await testRepo.commitFile("base.txt", "base\n", "Base");
  await testRepo.writeFile("a.txt", "a\n");
  await testRepo.writeFile("b.txt", "b\n");
  await testRepo.commit("Split all");

  const nodes = graphFrame.locator("#nodes > div");
  await expect(nodes).toHaveCount(4);

  const splitFrame = await openSplitView(workbox, graphFrame, nodes.nth(1));
  await expect(splitFrame.locator(".splitFile")).toHaveCount(2);

  for (const path of ["a.txt", "b.txt"]) {
    const checkbox = splitFileRow(splitFrame, path).locator("input.splitCheckbox");
    await checkbox.click();
    await expect(checkbox).not.toBeChecked();
  }

  await splitFrame.locator(".splitPrimaryButton").click();

  await handleEditor(workbox, "", "Nothing selected");
  await handleEditor(workbox, "", "Everything remaining");

  await expect(nodes).toHaveCount(5);

  await expect(async () => {
    const logEntries = await testRepo.log();
    expect(getParents(logEntries, "Nothing selected")).toEqual(["Base"]);
    expect(getParents(logEntries, "Everything remaining")).toEqual(["Nothing selected"]);
    expect(getParents(logEntries, "@")).toEqual(["Everything remaining"]);
  }).toPass();

  const emptyFirst = (await testRepo.log()).find((e) => e.description.trim() === "Nothing selected");
  expect(emptyFirst).toBeDefined();
  expect(emptyFirst!.empty).toBe(true);

  expect(await diffSummary(testRepo, await changeIdFor(testRepo, "Everything remaining"))).toBe("A a.txt\nA b.txt");
});

test("split with everything selected creates an empty second commit", async ({ graphFrame, testRepo, workbox }) => {
  await testRepo.commitFile("base.txt", "base\n", "Base");
  await testRepo.writeFile("solo.txt", "solo\n");
  await testRepo.commit("Split all");

  const nodes = graphFrame.locator("#nodes > div");
  await expect(nodes).toHaveCount(4);

  const splitFrame = await openSplitView(workbox, graphFrame, nodes.nth(1));
  await expect(splitFrame.locator(".splitFile")).toHaveCount(1);
  await expect(splitFrame.locator("input.splitCheckbox").first()).toBeChecked();

  await splitFrame.locator(".splitPrimaryButton").click();

  await handleEditor(workbox, "", "All selected");
  await handleEditor(workbox, "", "All remaining");

  await expect(nodes).toHaveCount(5);

  await expect(async () => {
    const logEntries = await testRepo.log();
    expect(getParents(logEntries, "All selected")).toEqual(["Base"]);
    expect(getParents(logEntries, "All remaining")).toEqual(["All selected"]);
    expect(getParents(logEntries, "@")).toEqual(["All remaining"]);
  }).toPass();

  const emptySecond = (await testRepo.log()).find((e) => e.description.trim() === "All remaining");
  expect(emptySecond).toBeDefined();
  expect(emptySecond!.empty).toBe(true);

  expect(await diffSummary(testRepo, await changeIdFor(testRepo, "All selected"))).toBe("A solo.txt");
});

test("cancelling the split view leaves the repository unchanged", async ({ graphFrame, testRepo, workbox }) => {
  await testRepo.commitFile("base.txt", "base\n", "Base");
  await testRepo.writeFile("f1.txt", "line1\nline2\n");
  await testRepo.writeFile("f2.txt", "added\n");
  await testRepo.commit("Cancel me");

  const nodes = graphFrame.locator("#nodes > div");
  await expect(nodes).toHaveCount(4);

  const before = await testRepo.log();

  const splitFrame = await openSplitView(workbox, graphFrame, nodes.nth(1));
  await expect(splitFrame.locator(".splitFile")).toHaveCount(2);
  await expect(splitFrame.locator(".splitHeaderDescription")).toHaveText("Cancel me");
  const splitTab = workbox.locator(".tab", { hasText: /^Split / });
  await expect(splitTab).toBeVisible();

  // Toggling the selection must not matter when cancelling.
  const f2Checkbox = splitFileRow(splitFrame, "f2.txt").locator("input.splitCheckbox");
  await f2Checkbox.click();
  await expect(f2Checkbox).not.toBeChecked();

  await splitFrame.getByRole("button", { name: "Cancel" }).click();

  await expect(splitTab).toBeHidden();

  const after = await testRepo.log();
  expect(after.map((e) => [e.change_id, e.commit_id, e.description])).toEqual(
    before.map((e) => [e.change_id, e.commit_id, e.description]),
  );
  await expect(nodes).toHaveCount(4);
});

test("closing the split view offers to apply the current selection", async ({ graphFrame, testRepo, workbox }) => {
  await testRepo.commitFile("f1.txt", "one\ntwo\nthree\n", "Base");
  await testRepo.writeFile("f1.txt", "one\nTWO\nthree\n");
  await testRepo.writeFile("f2.txt", "added\n");
  await testRepo.commit("Close me");

  const nodes = graphFrame.locator("#nodes > div");
  await expect(nodes).toHaveCount(4);

  const splitFrame = await openSplitView(workbox, graphFrame, nodes.nth(1));
  await expect(splitFrame.locator(".splitFile")).toHaveCount(2);
  await expect(splitFrame.locator(".splitHeaderDescription")).toHaveText("Close me");

  const splitTab = workbox.locator(".tab", { hasText: /^Split / });
  await expect(splitTab).toBeVisible();

  // Latest selection: only the f1.txt change goes into the first commit.
  const f2Checkbox = splitFileRow(splitFrame, "f2.txt").locator("input.splitCheckbox");
  await f2Checkbox.click();
  await expect(f2Checkbox).not.toBeChecked();

  // Closing the tab without confirming asks whether to apply the selection after all.
  await splitTab.locator(".tab-close").click();
  const dialog = workbox.locator(".monaco-dialog-box");
  await expect(dialog).toBeVisible();
  await expect(dialog).toContainText("Apply the split with the current selection?");
  await dialog.getByRole("button", { name: "Apply Split" }).click();
  await expect(dialog).not.toBeVisible();
  await expect(splitTab).toBeHidden();

  await handleEditor(workbox, "", "Applied part");
  await handleEditor(workbox, "", "Remaining part");

  await expect(nodes).toHaveCount(5);

  await expect(async () => {
    const logEntries = await testRepo.log();
    expect(getParents(logEntries, "Applied part")).toEqual(["Base"]);
    expect(getParents(logEntries, "Remaining part")).toEqual(["Applied part"]);
    expect(getParents(logEntries, "@")).toEqual(["Remaining part"]);
  }).toPass();

  expect(await diffSummary(testRepo, await changeIdFor(testRepo, "Applied part"))).toBe("M f1.txt");
  expect(await diffSummary(testRepo, await changeIdFor(testRepo, "Remaining part"))).toBe("A f2.txt");
  expect(await fileContent(testRepo, await changeIdFor(testRepo, "Applied part"), "f1.txt")).toBe("one\nTWO\nthree\n");
});

test("closing the split view and discarding leaves the repository unchanged", async ({
  graphFrame,
  testRepo,
  workbox,
}) => {
  await testRepo.commitFile("base.txt", "base\n", "Base");
  await testRepo.writeFile("f1.txt", "line1\nline2\n");
  await testRepo.writeFile("f2.txt", "added\n");
  await testRepo.commit("Close me");

  const nodes = graphFrame.locator("#nodes > div");
  await expect(nodes).toHaveCount(4);

  const before = await testRepo.log();
  const splitTab = workbox.locator(".tab", { hasText: /^Split / });

  // First close: dismissing the dialog with Discard aborts the split.
  {
    const splitFrame = await openSplitView(workbox, graphFrame, nodes.nth(1));
    await expect(splitFrame.locator(".splitFile")).toHaveCount(2);

    const f2Checkbox = splitFileRow(splitFrame, "f2.txt").locator("input.splitCheckbox");
    await f2Checkbox.click();
    await expect(f2Checkbox).not.toBeChecked();

    await splitTab.locator(".tab-close").click();
    const dialog = workbox.locator(".monaco-dialog-box");
    await expect(dialog).toBeVisible();
    await expect(dialog).toContainText("Apply the split with the current selection?");
    await dialog.getByRole("button", { name: "Discard" }).click();
    await expect(dialog).not.toBeVisible();
    await expect(splitTab).toBeHidden();
  }

  let after = await testRepo.log();
  expect(after.map((e) => [e.change_id, e.commit_id, e.description])).toEqual(
    before.map((e) => [e.change_id, e.commit_id, e.description]),
  );
  await expect(nodes).toHaveCount(4);

  // Second close: dismissing the dialog with Escape aborts the split as well.
  {
    const splitFrame = await openSplitView(workbox, graphFrame, nodes.nth(1));
    await expect(splitFrame.locator(".splitFile")).toHaveCount(2);

    await splitTab.locator(".tab-close").click();
    const dialog = workbox.locator(".monaco-dialog-box");
    await expect(dialog).toBeVisible();
    await workbox.keyboard.press("Escape");
    await expect(dialog).not.toBeVisible();
    await expect(splitTab).toBeHidden();
  }

  after = await testRepo.log();
  expect(after.map((e) => [e.change_id, e.commit_id, e.description])).toEqual(
    before.map((e) => [e.change_id, e.commit_id, e.description]),
  );
  await expect(nodes).toHaveCount(4);
});

test("added, renamed and conflicted files only offer whole-file checkboxes", async ({
  graphFrame,
  testRepo,
  workbox,
}) => {
  await testRepo.writeFile("doomed.txt", "d1\nd2\n");
  await testRepo.writeFile("old.txt", "r1\nr2\nr3\n");
  await testRepo.writeFile("file1.txt", "A\n");
  const base = await testRepo.commit("Base");
  await testRepo.writeFile("file1.txt", "B\n");
  const sideB = await testRepo.commit("B");

  // Change file1.txt on top of Base plus whole-file operations, then rebase the
  // change onto B so file1.txt ends up conflicted in the commit being split.
  await testRepo.jjCommand(["new", base]);
  await testRepo.deleteFile("doomed.txt");
  await testRepo.deleteFile("old.txt");
  await testRepo.writeFile("new.txt", "r1\nr2\nr3\n");
  await testRepo.writeFile("file1.txt", "C\n");
  await testRepo.writeFile("added.txt", "added\n");
  const leaves = await testRepo.commit("Leaves");
  // Rebase with descendants so the working copy stays a child of the split
  // commit (`-r` would reattach it to the old parent instead).
  await testRepo.jjCommand(["rebase", "-s", leaves, "-d", sideB]);

  const nodes = graphFrame.locator("#nodes > div");
  await expect(nodes).toHaveCount(5);

  const splitFrame = await openSplitView(workbox, graphFrame, nodes.nth(1));
  await expect(splitFrame.locator(".splitFile")).toHaveCount(4);

  // None of the leaves is expandable: no chevron, no hunks, just a whole-file checkbox.
  // doomed.txt is deleted text, so it expands into a "File Deleted" checkbox plus one
  // full-removal hunk instead; its deletion stays selected and lands in the first commit.
  for (const path of ["added.txt", "file1.txt", "new.txt"]) {
    const row = splitFileRow(splitFrame, path);
    await expect(row.locator(".splitFileRow")).not.toHaveClass(/splitExpandable/);
    await expect(row.locator(".splitHunk")).toHaveCount(0);
    await expect(row.locator("input.splitCheckbox")).toBeChecked();
  }

  const doomedRow = splitFileRow(splitFrame, "doomed.txt");
  await expect(doomedRow.locator(".splitFileRow")).toHaveClass(/splitExpandable/);
  await expect(doomedRow.locator(".splitFileRow input.splitCheckbox")).toBeChecked();
  await expect(doomedRow.locator(".splitLeafDetail")).toHaveText("File Deleted");
  await expect(doomedRow.locator(".splitHunk")).toHaveCount(1);
  await expect(doomedRow.locator(".splitLineRow")).toHaveCount(2);

  await expect(splitFileRow(splitFrame, "file1.txt").locator(".splitConflict")).toContainText("conflicted");
  await expect(splitFileRow(splitFrame, "new.txt").locator(".splitLeafDetail")).toContainText("← old.txt");

  // Split off the added file; conflict, rename and deletion stay in the first commit.
  const addedCheckbox = splitFileRow(splitFrame, "added.txt").locator("input.splitCheckbox");
  await addedCheckbox.click();
  await expect(addedCheckbox).not.toBeChecked();

  await splitFrame.locator(".splitPrimaryButton").click();

  await handleEditor(workbox, "", "Leaves first");
  await handleEditor(workbox, "", "Leaves rest");

  await expect(nodes).toHaveCount(6);

  await expect(async () => {
    const logEntries = await testRepo.log();
    expect(getParents(logEntries, "Leaves first")).toEqual(["B"]);
    expect(getParents(logEntries, "Leaves rest")).toEqual(["Leaves first"]);
    expect(getParents(logEntries, "@")).toEqual(["Leaves rest"]);
  }).toPass();

  const first = (await testRepo.log()).find((e) => e.description.trim() === "Leaves first");
  expect(first).toBeDefined();
  expect(first!.conflict).toBe(true);
  expect(await diffSummary(testRepo, first!.change_id)).toBe("D doomed.txt\nM file1.txt\nR {old.txt => new.txt}");

  expect(await diffSummary(testRepo, await changeIdFor(testRepo, "Leaves rest"))).toBe("A added.txt");
});

test("deleted text files split their deletion via the File Deleted checkbox", async ({
  graphFrame,
  testRepo,
  workbox,
}) => {
  await testRepo.commitFile("base.txt", "base\n", "Base");
  await testRepo.commitFile("doomed.txt", "d1\nd2\nd3\n", "Add doomed");
  await testRepo.deleteFile("doomed.txt");
  await testRepo.writeFile("keep.txt", "kept\n");
  await testRepo.commit("Split me");

  const nodes = graphFrame.locator("#nodes > div");
  await expect(nodes).toHaveCount(5);

  const splitFrame = await openSplitView(workbox, graphFrame, nodes.nth(1));
  await expect(splitFrame.locator(".splitFile")).toHaveCount(2);

  // The deleted file shows a "File Deleted" checkbox and a single hunk removing all lines.
  const doomedRow = splitFileRow(splitFrame, "doomed.txt");
  await expect(doomedRow.locator(".splitFileRow")).toHaveClass(/splitExpandable/);
  const fileDeletedCheckbox = doomedRow.locator(".splitFileRow input.splitCheckbox");
  await expect(fileDeletedCheckbox).toBeChecked();
  await expect(doomedRow.locator(".splitLeafDetail")).toHaveText("File Deleted");

  const hunk = doomedRow.locator(".splitHunk");
  await expect(hunk).toHaveCount(1);
  const hunkCheckbox = hunk.locator(".splitHunkRow input.splitCheckbox");
  await expect(hunkCheckbox).toBeChecked();
  await expect(hunk.locator(".splitLineRow")).toHaveCount(3);
  await expect(hunk.locator(".splitLineRow").first()).toContainText("d1");

  // Unchecking "File Deleted" unchecks the full hunk with it.
  await fileDeletedCheckbox.click();
  await expect(fileDeletedCheckbox).not.toBeChecked();
  await expect(hunkCheckbox).not.toBeChecked();

  // Re-checking the hunk re-checks "File Deleted": the two cannot diverge.
  await hunkCheckbox.click();
  await expect(hunkCheckbox).toBeChecked();
  await expect(fileDeletedCheckbox).toBeChecked();

  // Keep the deletion out of the first commit: only keep.txt is split off.
  await fileDeletedCheckbox.click();
  await expect(fileDeletedCheckbox).not.toBeChecked();
  await splitFrame.locator(".splitPrimaryButton").click();

  await handleEditor(workbox, "", "Keep add");
  await handleEditor(workbox, "", "Keep deletion");

  await expect(nodes).toHaveCount(6);

  await expect(async () => {
    const logEntries = await testRepo.log();
    expect(getParents(logEntries, "Keep add")).toEqual(["Add doomed"]);
    expect(getParents(logEntries, "Keep deletion")).toEqual(["Keep add"]);
    expect(getParents(logEntries, "@")).toEqual(["Keep deletion"]);
  }).toPass();

  const keepAdd = await changeIdFor(testRepo, "Keep add");
  const keepDeletion = await changeIdFor(testRepo, "Keep deletion");

  // The file survives in the first commit and is deleted in the second.
  expect(await diffSummary(testRepo, keepAdd)).toBe("A keep.txt");
  expect(await fileContent(testRepo, keepAdd, "doomed.txt")).toBe("d1\nd2\nd3\n");
  expect(await diffSummary(testRepo, keepDeletion)).toBe("D doomed.txt");
});
