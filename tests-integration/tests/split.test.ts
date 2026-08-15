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

/** Expands a file's hunk list by clicking its chevron; files start collapsed in the split view. */
async function expandSplitFile(row: Locator): Promise<void> {
  await row.locator(".splitFileRow > i.codicon-chevron-right").click();
}

/**
 * The close (X) button of an editor tab. Since VS Code 1.114 the button is a "Tab actions"
 * toolbar item whose only stable handle is its accessible name ("Close (Ctrl+W)", with a
 * platform-specific keybinding); older builds render an element with class `tab-close`.
 */
function tabCloseButton(tab: Locator): Locator {
  return tab.getByRole("button", { name: /^Close/ }).or(tab.locator(".tab-close"));
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

  // The modified f1.txt expands into two hunks; files start collapsed, so expand it first.
  // Everything starts checked initially.
  const f1Row = splitFileRow(splitFrame, "f1.txt");
  await expandSplitFile(f1Row);
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

  // Toggling a partially checked hunk unchecks all of its lines; with the second hunk already
  // unchecked, the file checkbox goes fully unchecked as well.
  await hunk1Checkbox.click();
  await expect(changed1bLine.locator("input.splitCheckbox")).not.toBeChecked();
  await expect(hunk1Checkbox).not.toBeChecked();
  await expect(f1Checkbox).not.toBeChecked();

  // Toggling the fully unchecked file propagates down and re-checks its hunks.
  await f1Checkbox.click();
  await expect(changed1bLine.locator("input.splitCheckbox")).toBeChecked();
  await expect(hunk1Checkbox).toBeChecked();
  await expect(hunk2Checkbox).toBeChecked();
  await expect(f1Checkbox).toBeChecked();

  // Final selection for the first commit: only the first hunk of f1.txt. Clicking the hunk row
  // itself (not just its checkbox) toggles every line of the hunk.
  await hunk2.locator(".splitHunkRow").click();
  await expect(hunk2Checkbox).not.toBeChecked();
  const f2Row = splitFileRow(splitFrame, "f2.txt");
  const f2Checkbox = f2Row.locator(".splitFileRow input.splitCheckbox");
  // Clicking the file row itself (not just its checkbox) toggles the whole file.
  await f2Row.locator(".splitFileRow").click();
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
    const checkbox = splitFileRow(splitFrame, path).locator(".splitFileRow input.splitCheckbox");
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
  const f2Checkbox = splitFileRow(splitFrame, "f2.txt").locator(".splitFileRow input.splitCheckbox");
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
  await tabCloseButton(splitTab).click();
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

    await tabCloseButton(splitTab).click();
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

    await tabCloseButton(splitTab).click();
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

test("renamed and conflicted files only offer whole-file checkboxes", async ({ graphFrame, testRepo, workbox }) => {
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
  // added.txt is added text, so it expands into a single hunk adding all of its lines.
  for (const path of ["file1.txt", "new.txt"]) {
    const row = splitFileRow(splitFrame, path);
    await expect(row.locator(".splitFileRow")).not.toHaveClass(/splitExpandable/);
    await expect(row.locator(".splitHunk")).toHaveCount(0);
    await expect(row.locator("input.splitCheckbox")).toBeChecked();
  }

  const doomedRow = splitFileRow(splitFrame, "doomed.txt");
  await expect(doomedRow.locator(".splitFileRow")).toHaveClass(/splitExpandable/);
  await expandSplitFile(doomedRow);
  await expect(doomedRow.locator(".splitFileRow input.splitCheckbox")).toBeChecked();
  await expect(doomedRow.locator(".splitLeafDetail")).toHaveText("File Deleted");
  await expect(doomedRow.locator(".splitHunk")).toHaveCount(1);
  await expect(doomedRow.locator(".splitLineRow")).toHaveCount(2);

  const addedRow = splitFileRow(splitFrame, "added.txt");
  await expect(addedRow.locator(".splitFileRow")).toHaveClass(/splitExpandable/);
  await expandSplitFile(addedRow);
  await expect(addedRow.locator(".splitHunk")).toHaveCount(1);
  await expect(addedRow.locator(".splitHunkHeader")).toHaveText("@@ +1 -0");
  await expect(addedRow.locator(".splitLineRow")).toHaveCount(1);
  await expect(addedRow.locator(".splitLineRow")).toContainText("added");

  await expect(splitFileRow(splitFrame, "file1.txt").locator(".splitConflict")).toContainText("conflicted");
  // A pure rename has no content hunks, so it stays a leaf whose whole-file checkbox is the
  // "File Renamed" checkbox.
  const renamedRow = splitFileRow(splitFrame, "new.txt");
  await expect(renamedRow.locator(".splitLeafDetail", { hasText: "←" })).toContainText("← old.txt");
  await expect(renamedRow.locator(".splitLeafDetail", { hasText: "File Renamed" })).toHaveCount(1);
  await expect(renamedRow.locator(".splitFileRow input.splitCheckbox")).toHaveAttribute("title", "File Renamed");

  // Split off the added file; conflict, rename and deletion stay in the first commit.
  const addedCheckbox = splitFileRow(splitFrame, "added.txt").locator(".splitFileRow input.splitCheckbox");
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
  await expandSplitFile(doomedRow);
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

test("added text files split their addition via a full-addition hunk", async ({ graphFrame, testRepo, workbox }) => {
  await testRepo.commitFile("base.txt", "base\n", "Base");
  await testRepo.writeFile("keep.txt", "kept\n");
  await testRepo.writeFile("new.txt", "n1\nn2\nn3\n");
  await testRepo.commit("Split me");

  const nodes = graphFrame.locator("#nodes > div");
  await expect(nodes).toHaveCount(4);

  const splitFrame = await openSplitView(workbox, graphFrame, nodes.nth(1));
  await expect(splitFrame.locator(".splitFile")).toHaveCount(2);

  // The added file shows a single hunk adding all of its lines.
  const newRow = splitFileRow(splitFrame, "new.txt");
  await expect(newRow.locator(".splitFileRow")).toHaveClass(/splitExpandable/);
  await expandSplitFile(newRow);
  const fileCheckbox = newRow.locator(".splitFileRow input.splitCheckbox");
  await expect(fileCheckbox).toBeChecked();

  const hunk = newRow.locator(".splitHunk");
  await expect(hunk).toHaveCount(1);
  await expect(hunk.locator(".splitHunkHeader")).toHaveText("@@ +3 -0");
  const hunkCheckbox = hunk.locator(".splitHunkRow input.splitCheckbox");
  await expect(hunkCheckbox).toBeChecked();
  await expect(hunk.locator(".splitLineRow")).toHaveCount(3);
  await expect(hunk.locator(".splitLineRow").first()).toContainText("n1");

  // Unchecking the file unchecks the full hunk with it.
  await fileCheckbox.click();
  await expect(fileCheckbox).not.toBeChecked();
  await expect(hunkCheckbox).not.toBeChecked();

  // Re-checking the hunk re-checks the file: the two cannot diverge.
  await hunkCheckbox.click();
  await expect(hunkCheckbox).toBeChecked();
  await expect(fileCheckbox).toBeChecked();

  // Keep the first line of the addition out of the first commit.
  const n1Line = hunk.locator(".splitLineRow").filter({ hasText: "n1" });
  await n1Line.locator("input.splitCheckbox").click();
  await expect(n1Line.locator("input.splitCheckbox")).not.toBeChecked();
  await expect(hunkCheckbox).toBeChecked({ indeterminate: true });
  await expect(fileCheckbox).toBeChecked({ indeterminate: true });

  await splitFrame.locator(".splitPrimaryButton").click();

  await handleEditor(workbox, "", "Keep all but n1");
  await handleEditor(workbox, "", "Add n1");

  await expect(nodes).toHaveCount(5);

  await expect(async () => {
    const logEntries = await testRepo.log();
    expect(getParents(logEntries, "Keep all but n1")).toEqual(["Base"]);
    expect(getParents(logEntries, "Add n1")).toEqual(["Keep all but n1"]);
    expect(getParents(logEntries, "@")).toEqual(["Add n1"]);
  }).toPass();

  const withoutN1 = await changeIdFor(testRepo, "Keep all but n1");
  const withN1 = await changeIdFor(testRepo, "Add n1");

  // The first commit adds keep.txt and new.txt without its first line; the second completes new.txt.
  expect(await diffSummary(testRepo, withoutN1)).toBe("A keep.txt\nA new.txt");
  expect(await fileContent(testRepo, withoutN1, "new.txt")).toBe("n2\nn3\n");
  expect(await diffSummary(testRepo, withN1)).toBe("M new.txt");
  expect(await fileContent(testRepo, withN1, "new.txt")).toBe("n1\nn2\nn3\n");
});

test("renamed files split their rename via the File Renamed checkbox", async ({ graphFrame, testRepo, workbox }) => {
  await testRepo.commitFile("base.txt", "base\n", "Base");
  await testRepo.commitFile("old.txt", "r1\nr2\nr3\n", "Add old");
  // Rename with a content edit: jj reports it as a rename whose sides differ.
  await testRepo.deleteFile("old.txt");
  await testRepo.writeFile("new.txt", "r1\nR2\nr3\n");
  await testRepo.writeFile("keep.txt", "kept\n");
  await testRepo.commit("Split me");

  const nodes = graphFrame.locator("#nodes > div");
  await expect(nodes).toHaveCount(5);

  const splitFrame = await openSplitView(workbox, graphFrame, nodes.nth(1));
  await expect(splitFrame.locator(".splitFile")).toHaveCount(2);

  // The renamed file is expandable: a "File Renamed" checkbox above the content hunks.
  const renamedRow = splitFileRow(splitFrame, "new.txt");
  await expect(renamedRow.locator(".splitFileRow")).toHaveClass(/splitExpandable/);
  await expandSplitFile(renamedRow);
  const renameRow = renamedRow.locator(".splitRename");
  await expect(renameRow).toHaveCount(1);
  await expect(renameRow).toContainText("File Renamed");
  await expect(renameRow).toContainText("← old.txt");
  const renameCheckbox = renameRow.locator("input.splitCheckbox");
  await expect(renameCheckbox).toBeChecked();

  // The content edit shows as a single hunk next to the rename.
  const hunk = renamedRow.locator(".splitHunk");
  await expect(hunk).toHaveCount(1);
  const hunkCheckbox = hunk.locator(".splitHunkRow input.splitCheckbox");
  await expect(hunkCheckbox).toBeChecked();
  await expect(hunk.locator(".splitLineRow").first()).toContainText("r2");
  await expect(hunk.locator(".splitLineAdded")).toContainText("R2");

  // The content hunk can be picked independently of the rename.
  await hunkCheckbox.click();
  await expect(hunkCheckbox).not.toBeChecked();
  await expect(renameCheckbox).toBeChecked();
  await hunkCheckbox.click();
  await expect(hunkCheckbox).toBeChecked();

  // Keep the rename out of the first commit: only the content edit and keep.txt are split off.
  await renameCheckbox.click();
  await expect(renameCheckbox).not.toBeChecked();
  await expect(hunkCheckbox).toBeChecked();
  await splitFrame.locator(".splitPrimaryButton").click();

  await handleEditor(workbox, "", "Edit only");
  await handleEditor(workbox, "", "Rename rest");

  await expect(nodes).toHaveCount(6);

  await expect(async () => {
    const logEntries = await testRepo.log();
    expect(getParents(logEntries, "Edit only")).toEqual(["Add old"]);
    expect(getParents(logEntries, "Rename rest")).toEqual(["Edit only"]);
    expect(getParents(logEntries, "@")).toEqual(["Rename rest"]);
  }).toPass();

  const editOnly = await changeIdFor(testRepo, "Edit only");
  const renameRest = await changeIdFor(testRepo, "Rename rest");

  // The first commit applies the content edit at the old path; the rename itself is deferred.
  expect(await diffSummary(testRepo, editOnly)).toBe("A keep.txt\nM old.txt");
  expect(await fileContent(testRepo, editOnly, "old.txt")).toBe("r1\nR2\nr3\n");

  // The second commit performs the rename of the already-edited file.
  expect(await diffSummary(testRepo, renameRest)).toBe("R {old.txt => new.txt}");
});

/** The `jj diff --git` output of a change, which spells out mode changes as old/new mode lines. */
async function gitDiff(testRepo: TestRepo, changeId: string): Promise<string> {
  return (await testRepo.jjCommand(["diff", "--git", "-r", changeId])).stdout;
}

test("file mode changes split via the File mode changed checkbox", async ({ graphFrame, testRepo, workbox }) => {
  test.skip(process.platform === "win32", "Windows file systems do not track the executable bit");

  await testRepo.commitFile("base.txt", "base\n", "Base");
  await testRepo.commitFile("f.sh", "one\ntwo\n", "Add script");
  await testRepo.jjCommand(["file", "chmod", "x", "f.sh"]);
  await testRepo.writeFile("keep.txt", "kept\n");
  await testRepo.commit("Split me");

  const nodes = graphFrame.locator("#nodes > div");
  await expect(nodes).toHaveCount(5);

  const splitFrame = await openSplitView(workbox, graphFrame, nodes.nth(1));
  await expect(splitFrame.locator(".splitFile")).toHaveCount(2);

  // The mode change is the file's only entry: the unchanged content yields no hunks, so the
  // file would stay a leaf without it.
  const fRow = splitFileRow(splitFrame, "f.sh");
  await expect(fRow.locator(".splitFileRow")).toHaveClass(/splitExpandable/);
  await expandSplitFile(fRow);
  const modeRow = fRow.locator(".splitRename");
  await expect(modeRow).toHaveCount(1);
  await expect(modeRow).toContainText("File mode changed to 100755");
  await expect(fRow.locator(".splitHunk")).toHaveCount(0);
  const modeCheckbox = modeRow.locator("input.splitCheckbox");
  await expect(modeCheckbox).toBeChecked();

  // The mode entry is the file's only checkable, so the file checkbox mirrors it (like the
  // "File Deleted" checkbox of a deleted file mirrors its full-removal hunk).
  const fCheckbox = fRow.locator(".splitFileRow input.splitCheckbox");
  await modeCheckbox.click();
  await expect(modeCheckbox).not.toBeChecked();
  await expect(fCheckbox).not.toBeChecked();
  await modeCheckbox.click();
  await expect(modeCheckbox).toBeChecked();
  await expect(fCheckbox).toBeChecked();

  // Keep the mode change out of the first commit: only keep.txt is split off.
  await modeCheckbox.click();
  await splitFrame.locator(".splitPrimaryButton").click();

  await handleEditor(workbox, "", "Keep mode");
  await handleEditor(workbox, "", "Mode change");

  await expect(nodes).toHaveCount(6);

  await expect(async () => {
    const logEntries = await testRepo.log();
    expect(getParents(logEntries, "Keep mode")).toEqual(["Add script"]);
    expect(getParents(logEntries, "Mode change")).toEqual(["Keep mode"]);
    expect(getParents(logEntries, "@")).toEqual(["Mode change"]);
  }).toPass();

  const keepMode = await changeIdFor(testRepo, "Keep mode");
  const modeChange = await changeIdFor(testRepo, "Mode change");

  // The first commit keeps the old mode; the second applies the mode change.
  expect(await diffSummary(testRepo, keepMode)).toBe("A keep.txt");
  expect(await gitDiff(testRepo, keepMode)).not.toContain("mode 100755");
  expect(await diffSummary(testRepo, modeChange)).toBe("M f.sh");
  expect(await gitDiff(testRepo, modeChange)).toContain("old mode 100644");
  expect(await gitDiff(testRepo, modeChange)).toContain("new mode 100755");
});

test("a selected mode change lands in the first split commit", async ({ graphFrame, testRepo, workbox }) => {
  test.skip(process.platform === "win32", "Windows file systems do not track the executable bit");

  await testRepo.commitFile("base.txt", "base\n", "Base");
  await testRepo.commitFile("f.sh", "one\ntwo\n", "Add script");
  await testRepo.jjCommand(["file", "chmod", "x", "f.sh"]);
  await testRepo.writeFile("f.sh", "one\ntwo\nthree\n");
  await testRepo.commit("Split me");

  const nodes = graphFrame.locator("#nodes > div");
  await expect(nodes).toHaveCount(5);

  const splitFrame = await openSplitView(workbox, graphFrame, nodes.nth(1));
  await expect(splitFrame.locator(".splitFile")).toHaveCount(1);

  // The mode change entry sits at the top, above the content hunk.
  const fRow = splitFileRow(splitFrame, "f.sh");
  await expandSplitFile(fRow);
  await expect(fRow.locator(".splitRename")).toContainText("File mode changed to 100755");
  await expect(fRow.locator(".splitHunk")).toHaveCount(1);

  // Everything stays selected, so the mode change and the edit both go into the first commit.
  await splitFrame.locator(".splitPrimaryButton").click();

  await handleEditor(workbox, "", "All selected");
  await handleEditor(workbox, "", "All remaining");

  await expect(nodes).toHaveCount(6);

  const allSelected = await changeIdFor(testRepo, "All selected");
  const gitDiffs = await gitDiff(testRepo, allSelected);
  expect(gitDiffs).toContain("old mode 100644");
  expect(gitDiffs).toContain("new mode 100755");
  expect(await fileContent(testRepo, allSelected, "f.sh")).toBe("one\ntwo\nthree\n");
});
