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

  // The hunks are numbered per file as sections.
  await expect(hunk1.locator(".splitHunkHeader")).toHaveText("Section 1");
  await expect(hunk2.locator(".splitHunkHeader")).toHaveText("Section 2");
  await expect(hunk1.locator(".splitHunkRow .splitLeafDetail")).toHaveText("+2 -2");
  await expect(hunk2.locator(".splitHunkRow .splitLeafDetail")).toHaveText("+1 -1");

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

test("vertical collapse lines collapse and expand files and hunks", async ({ graphFrame, testRepo, workbox }) => {
  await testRepo.commitFile("f1.txt", "line1\nline2\nline3\n", "Base");
  await testRepo.writeFile("f1.txt", "line1\nchanged\nline3\n");
  await testRepo.commit("Split me");

  const nodes = graphFrame.locator("#nodes > div");
  await expect(nodes).toHaveCount(4);

  const splitFrame = await openSplitView(workbox, graphFrame, nodes.nth(1));
  const f1Row = splitFileRow(splitFrame, "f1.txt");
  await expandSplitFile(f1Row);

  const hunk = f1Row.locator(".splitHunk");
  await expect(hunk).toHaveCount(1);
  const lines = hunk.locator(".splitLineRow");
  await expect(lines).toHaveCount(2);

  // Each collapse line is horizontally centered under its section's chevron: the file line
  // under the file row's chevron, the hunk line under the hunk row's chevron.
  const fileLine = f1Row.locator(".splitHunks > .splitCollapseLine");
  const hunkLine = hunk.locator(".splitCollapseLine");
  const centerXOf = async (locator: Locator): Promise<number> => {
    const box = await locator.boundingBox();
    expect(box).toBeDefined();
    return box!.x + box!.width / 2;
  };
  expect(await centerXOf(fileLine)).toBeCloseTo(await centerXOf(f1Row.locator(".splitFileRow > i.codicon")), 0);
  expect(await centerXOf(hunkLine)).toBeCloseTo(await centerXOf(hunk.locator(".splitHunkRow > i.codicon")), 0);

  // The hunk line starts under the hunk row's chevron (below the header row) and spans the
  // hunk's lines; the file line starts under the file row and spans the file's contents.
  const hunkRowBox = (await hunk.locator(".splitHunkRow").boundingBox())!;
  const hunkLineBox = (await hunkLine.boundingBox())!;
  expect(hunkLineBox.y).toBeGreaterThanOrEqual(hunkRowBox.y + hunkRowBox.height - 0.5);
  const lastLineBox = (await lines.last().boundingBox())!;
  expect(hunkLineBox.y + hunkLineBox.height).toBeCloseTo(lastLineBox.y + lastLineBox.height, 0);
  const fileRowBox = (await f1Row.locator(".splitFileRow").boundingBox())!;
  const fileLineBox = (await fileLine.boundingBox())!;
  expect(fileLineBox.y).toBeGreaterThanOrEqual(fileRowBox.y + fileRowBox.height - 0.5);

  // The file's gutter pushes the line checkboxes right of the hunk checkbox.
  const hunkCheckbox = hunk.locator(".splitHunkRow input.splitCheckbox");
  const lineCheckbox = lines.first().locator("input.splitCheckbox");
  expect((await lineCheckbox.boundingBox())!.x).toBeGreaterThan((await hunkCheckbox.boundingBox())!.x);

  // Clicking the hunk's line collapses just the hunk's lines; the line spans only those
  // lines, so it disappears with them and the chevron expands the hunk again.
  await hunkLine.click();
  await expect(lines).toHaveCount(0);
  await expect(hunkLine).toHaveCount(0);
  await hunk.locator(".splitHunkRow > i.codicon-chevron-right").click();
  await expect(lines).toHaveCount(2);
  await expect(hunkLine).toHaveCount(1);

  // Unlike the chevrons, the collapse line is a real button and works with the keyboard.
  await hunkLine.focus();
  await workbox.keyboard.press("Enter");
  await expect(lines).toHaveCount(0);

  // Clicking the file's line collapses the whole file contents; the chevron re-expands them.
  await fileLine.click();
  await expect(f1Row.locator(".splitHunks")).toHaveCount(0);
  await expandSplitFile(f1Row);
  await expect(hunk).toHaveCount(1);
});

test("splitting with an empty selection creates an empty commit on either side", async ({
  graphFrame,
  testRepo,
  workbox,
}) => {
  test.slow();
  await testRepo.commitFile("base.txt", "base\n", "Base");
  const nodes = graphFrame.locator("#nodes > div");
  await expect(nodes).toHaveCount(3);

  await test.step("split with nothing selected creates an empty first commit", async () => {
    await testRepo.writeFile("a.txt", "a\n");
    await testRepo.writeFile("b.txt", "b\n");
    await testRepo.commit("Split all");

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

  await test.step("split with everything selected creates an empty second commit", async () => {
    await testRepo.writeFile("solo.txt", "solo\n");
    await testRepo.commit("Split all");

    await expect(nodes).toHaveCount(6);

    const splitFrame = await openSplitView(workbox, graphFrame, nodes.nth(1));
    await expect(splitFrame.locator(".splitFile")).toHaveCount(1);
    await expect(splitFrame.locator("input.splitCheckbox").first()).toBeChecked();

    await splitFrame.locator(".splitPrimaryButton").click();

    await handleEditor(workbox, "", "All selected");
    await handleEditor(workbox, "", "All remaining");

    await expect(nodes).toHaveCount(7);

    // This step's commit sits on top of the previous step's split result, so its
    // parent is "Everything remaining" rather than "Base".
    await expect(async () => {
      const logEntries = await testRepo.log();
      expect(getParents(logEntries, "All selected")).toEqual(["Everything remaining"]);
      expect(getParents(logEntries, "All remaining")).toEqual(["All selected"]);
      expect(getParents(logEntries, "@")).toEqual(["All remaining"]);
    }).toPass();

    const emptySecond = (await testRepo.log()).find((e) => e.description.trim() === "All remaining");
    expect(emptySecond).toBeDefined();
    expect(emptySecond!.empty).toBe(true);

    expect(await diffSummary(testRepo, await changeIdFor(testRepo, "All selected"))).toBe("A solo.txt");
  });
});

test("closing and cancelling the split view", async ({ graphFrame, testRepo, workbox }) => {
  test.slow();
  await testRepo.commitFile("f1.txt", "one\ntwo\nthree\n", "Base");
  await testRepo.writeFile("f1.txt", "one\nTWO\nthree\n");
  await testRepo.writeFile("f2.txt", "added\n");
  await testRepo.commit("Close me");

  const nodes = graphFrame.locator("#nodes > div");
  await expect(nodes).toHaveCount(4);

  const splitTab = workbox.locator(".tab", { hasText: /^Split / });

  // Compares the full log against a snapshot: closing or cancelling must not touch the repo.
  const expectLogUnchanged = async (before: Awaited<ReturnType<typeof testRepo.log>>): Promise<void> => {
    const after = await testRepo.log();
    expect(after.map((e) => [e.change_id, e.commit_id, e.description])).toEqual(
      before.map((e) => [e.change_id, e.commit_id, e.description]),
    );
  };

  await test.step("cancelling the split view leaves the repository unchanged", async () => {
    const before = await testRepo.log();

    const splitFrame = await openSplitView(workbox, graphFrame, nodes.nth(1));
    await expect(splitFrame.locator(".splitFile")).toHaveCount(2);
    await expect(splitFrame.locator(".splitHeaderDescription")).toHaveText("Close me");
    await expect(splitTab).toBeVisible();

    // Toggling the selection must not matter when cancelling.
    const f2Checkbox = splitFileRow(splitFrame, "f2.txt").locator(".splitFileRow input.splitCheckbox");
    await f2Checkbox.click();
    await expect(f2Checkbox).not.toBeChecked();

    await splitFrame.getByRole("button", { name: "Cancel" }).click();

    await expect(splitTab).toBeHidden();

    await expectLogUnchanged(before);
    await expect(nodes).toHaveCount(4);
  });

  await test.step("closing the split view and discarding leaves the repository unchanged", async () => {
    const before = await testRepo.log();

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

    await expectLogUnchanged(before);
    await expect(nodes).toHaveCount(4);

    // Second close: dismissing the dialog with Escape aborts the split as well.
    {
      const splitFrame = await openSplitView(workbox, graphFrame, nodes.nth(1));
      await expect(splitFrame.locator(".splitFile")).toHaveCount(2);

      const f2Checkbox = splitFileRow(splitFrame, "f2.txt").locator("input.splitCheckbox");
      await f2Checkbox.click();
      await expect(f2Checkbox).not.toBeChecked();

      await tabCloseButton(splitTab).click();
      const dialog = workbox.locator(".monaco-dialog-box");
      await expect(dialog).toBeVisible();
      await workbox.keyboard.press("Escape");
      await expect(dialog).not.toBeVisible();
      await expect(splitTab).toBeHidden();
    }

    await expectLogUnchanged(before);
    await expect(nodes).toHaveCount(4);

    // Third close: an untouched selection is discarded without asking.
    {
      const splitFrame = await openSplitView(workbox, graphFrame, nodes.nth(1));
      await expect(splitFrame.locator(".splitFile")).toHaveCount(2);

      await tabCloseButton(splitTab).click();
      await expect(splitTab).toBeHidden();
      await expect(workbox.locator(".monaco-dialog-box")).toBeHidden();
    }

    await expectLogUnchanged(before);
    await expect(nodes).toHaveCount(4);
  });

  await test.step("closing the split view offers to apply the current selection", async () => {
    const splitFrame = await openSplitView(workbox, graphFrame, nodes.nth(1));
    await expect(splitFrame.locator(".splitFile")).toHaveCount(2);
    await expect(splitFrame.locator(".splitHeaderDescription")).toHaveText("Close me");
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
    expect(await fileContent(testRepo, await changeIdFor(testRepo, "Applied part"), "f1.txt")).toBe(
      "one\nTWO\nthree\n",
    );
  });
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
  // doomed.txt is deleted text, so it expands into a deletion checkbox plus one
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
  await expect(doomedRow.locator(".splitStatus")).toHaveText("D");
  await expect(doomedRow.locator(".splitFileRow .splitLeafDetail")).toHaveText("-2");
  await expect(doomedRow.locator(".splitHunk")).toHaveCount(1);
  await expect(doomedRow.locator(".splitLineRow")).toHaveCount(2);

  const addedRow = splitFileRow(splitFrame, "added.txt");
  await expect(addedRow.locator(".splitFileRow")).toHaveClass(/splitExpandable/);
  await expandSplitFile(addedRow);
  await expect(addedRow.locator(".splitHunk")).toHaveCount(1);
  await expect(addedRow.locator(".splitHunkHeader")).toHaveText("Section 1");
  await expect(addedRow.locator(".splitHunkRow .splitLeafDetail")).toHaveText("+1");
  await expect(addedRow.locator(".splitLineRow")).toHaveCount(1);
  await expect(addedRow.locator(".splitLineRow")).toContainText("added");

  await expect(splitFileRow(splitFrame, "file1.txt").locator(".splitConflict")).toContainText("conflicted");
  // A pure rename has no content hunks, so it stays a leaf whose whole-file checkbox is the
  // rename checkbox.
  const renamedRow = splitFileRow(splitFrame, "new.txt");
  await expect(renamedRow.locator(".splitStatus")).toHaveText("R");
  await expect(renamedRow.locator(".splitLeafDetail", { hasText: "←" })).toContainText("← old.txt");
  await expect(renamedRow.locator(".splitFileRow input.splitCheckbox")).not.toHaveAttribute("title");

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

test("special file entries split via their dedicated checkboxes", async ({ graphFrame, testRepo, workbox }) => {
  test.slow();

  const nodes = graphFrame.locator("#nodes > div");

  await test.step("deleted text files split their deletion via the deletion checkbox", async () => {
    await testRepo.commitFile("base.txt", "base\n", "Base");
    await testRepo.commitFile("doomed.txt", "d1\nd2\nd3\n", "Add doomed");
    await testRepo.deleteFile("doomed.txt");
    await testRepo.writeFile("keep.txt", "kept\n");
    await testRepo.commit("Split me");

    await expect(nodes).toHaveCount(5);

    const splitFrame = await openSplitView(workbox, graphFrame, nodes.nth(1));
    await expect(splitFrame.locator(".splitFile")).toHaveCount(2);

    // The deleted file shows a deletion checkbox and a single hunk removing all lines.
    const doomedRow = splitFileRow(splitFrame, "doomed.txt");
    await expect(doomedRow.locator(".splitFileRow")).toHaveClass(/splitExpandable/);
    await expandSplitFile(doomedRow);
    const fileDeletedCheckbox = doomedRow.locator(".splitFileRow input.splitCheckbox");
    await expect(fileDeletedCheckbox).toBeChecked();
    await expect(doomedRow.locator(".splitStatus")).toHaveText("D");
    await expect(doomedRow.locator(".splitFileRow .splitLeafDetail")).toHaveText("-3");

    const hunk = doomedRow.locator(".splitHunk");
    await expect(hunk).toHaveCount(1);
    const hunkCheckbox = hunk.locator(".splitHunkRow input.splitCheckbox");
    await expect(hunkCheckbox).toBeChecked();
    await expect(hunk.locator(".splitLineRow")).toHaveCount(3);
    await expect(hunk.locator(".splitLineRow").first()).toContainText("d1");

    // Unchecking the deletion unchecks the full hunk with it.
    await fileDeletedCheckbox.click();
    await expect(fileDeletedCheckbox).not.toBeChecked();
    await expect(hunkCheckbox).not.toBeChecked();

    // Re-checking the hunk re-checks the deletion: the two cannot diverge.
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

  await test.step("added text files split their addition via a full-addition hunk", async () => {
    // keep.txt already exists from the deleted-files step, so this commit adds its own keeper.
    await testRepo.writeFile("keep2.txt", "kept\n");
    await testRepo.writeFile("new.txt", "n1\nn2\nn3\n");
    await testRepo.commit("Split me");

    await expect(nodes).toHaveCount(7);

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
    await expect(hunk.locator(".splitHunkHeader")).toHaveText("Section 1");
    await expect(hunk.locator(".splitHunkRow .splitLeafDetail")).toHaveText("+3");
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

    await expect(nodes).toHaveCount(8);

    // This step's commit sits on top of the previous step's split result, so its
    // parent is "Keep deletion" rather than "Base".
    await expect(async () => {
      const logEntries = await testRepo.log();
      expect(getParents(logEntries, "Keep all but n1")).toEqual(["Keep deletion"]);
      expect(getParents(logEntries, "Add n1")).toEqual(["Keep all but n1"]);
      expect(getParents(logEntries, "@")).toEqual(["Add n1"]);
    }).toPass();

    const withoutN1 = await changeIdFor(testRepo, "Keep all but n1");
    const withN1 = await changeIdFor(testRepo, "Add n1");

    // The first commit adds keep2.txt and new.txt without its first line; the second completes new.txt.
    expect(await diffSummary(testRepo, withoutN1)).toBe("A keep2.txt\nA new.txt");
    expect(await fileContent(testRepo, withoutN1, "new.txt")).toBe("n2\nn3\n");
    expect(await diffSummary(testRepo, withN1)).toBe("M new.txt");
    expect(await fileContent(testRepo, withN1, "new.txt")).toBe("n1\nn2\nn3\n");
  });

  await test.step("renamed files split their rename via the File Renamed checkbox", async () => {
    // new.txt already exists from the added-files step, so the rename targets moved.txt.
    await testRepo.commitFile("old.txt", "r1\nr2\nr3\n", "Add old");
    // Rename with a content edit: jj reports it as a rename whose sides differ.
    await testRepo.deleteFile("old.txt");
    await testRepo.writeFile("moved.txt", "r1\nR2\nr3\n");
    await testRepo.writeFile("keep3.txt", "kept\n");
    await testRepo.commit("Split me");

    await expect(nodes).toHaveCount(10);

    const splitFrame = await openSplitView(workbox, graphFrame, nodes.nth(1));
    await expect(splitFrame.locator(".splitFile")).toHaveCount(2);

    // The renamed file is expandable: a "File Renamed" checkbox above the content hunks.
    const renamedRow = splitFileRow(splitFrame, "moved.txt");
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

    // Keep the rename out of the first commit: only the content edit and keep3.txt are split off.
    await renameCheckbox.click();
    await expect(renameCheckbox).not.toBeChecked();
    await expect(hunkCheckbox).toBeChecked();
    await splitFrame.locator(".splitPrimaryButton").click();

    await handleEditor(workbox, "", "Edit only");
    await handleEditor(workbox, "", "Rename rest");

    await expect(nodes).toHaveCount(11);

    await expect(async () => {
      const logEntries = await testRepo.log();
      expect(getParents(logEntries, "Edit only")).toEqual(["Add old"]);
      expect(getParents(logEntries, "Rename rest")).toEqual(["Edit only"]);
      expect(getParents(logEntries, "@")).toEqual(["Rename rest"]);
    }).toPass();

    const editOnly = await changeIdFor(testRepo, "Edit only");
    const renameRest = await changeIdFor(testRepo, "Rename rest");

    // The first commit applies the content edit at the old path; the rename itself is deferred.
    expect(await diffSummary(testRepo, editOnly)).toBe("A keep3.txt\nM old.txt");
    expect(await fileContent(testRepo, editOnly, "old.txt")).toBe("r1\nR2\nr3\n");

    // The second commit performs the rename of the already-edited file.
    expect(await diffSummary(testRepo, renameRest)).toBe("R {old.txt => moved.txt}");
  });
});

/** The `jj diff --git` output of a change, which spells out mode changes as old/new mode lines. */
async function gitDiff(testRepo: TestRepo, changeId: string): Promise<string> {
  return (await testRepo.jjCommand(["diff", "--git", "-r", changeId])).stdout;
}

test.describe("with immutable commits visible", () => {
  test.use({ customSettings: { "jjx.elideImmutableCommits": false } });

  test("splitting an immutable commit prompts for confirmation", async ({ graphFrame, testRepo, workbox }) => {
    test.slow();
    await testRepo.commitFile("base.txt", "base\n", "Base");
    await testRepo.writeFile("f1.txt", "one\n");
    await testRepo.writeFile("f2.txt", "two\n");
    const splitMe = await testRepo.commit("Split me");
    await testRepo.commitFile("child.txt", "child\n", "Child");

    // The tag makes "Split me" an immutable head, so splitting it needs confirmation.
    await testRepo.createTag("immutable-tag", splitMe);

    const nodes = graphFrame.locator("#nodes > div");
    await expect(nodes).toHaveCount(5);

    // @, Child, "Split me", Base and the root commit, newest first.
    const splitMeNode = nodes.nth(2);

    await test.step("cancelling the immutable warning leaves the repository unchanged", async () => {
      const before = await testRepo.log();

      const splitFrame = await openSplitView(workbox, graphFrame, splitMeNode);
      await expect(splitFrame.locator(".splitFile")).toHaveCount(2);
      await expect(splitFrame.locator(".splitHeaderDescription")).toHaveText("Split me");

      // Keep only f1.txt in the first commit.
      const f2Checkbox = splitFileRow(splitFrame, "f2.txt").locator(".splitFileRow input.splitCheckbox");
      await f2Checkbox.click();
      await expect(f2Checkbox).not.toBeChecked();

      await splitFrame.locator(".splitPrimaryButton").click();

      const dialog = workbox.locator(".monaco-dialog-box");
      await expect(dialog).toBeVisible();
      await expect(dialog).toContainText("is immutable, are you sure?");
      await workbox.keyboard.press("Escape");
      await expect(dialog).not.toBeVisible();

      const after = await testRepo.log();
      expect(after.map((e) => [e.change_id, e.commit_id, e.description])).toEqual(
        before.map((e) => [e.change_id, e.commit_id, e.description]),
      );
      await expect(nodes).toHaveCount(5);
    });

    await test.step("confirming retries the split with --ignore-immutable", async () => {
      const splitFrame = await openSplitView(workbox, graphFrame, splitMeNode);
      await expect(splitFrame.locator(".splitFile")).toHaveCount(2);

      const f2Checkbox = splitFileRow(splitFrame, "f2.txt").locator(".splitFileRow input.splitCheckbox");
      await f2Checkbox.click();
      await expect(f2Checkbox).not.toBeChecked();

      await splitFrame.locator(".splitPrimaryButton").click();

      const dialog = workbox.locator(".monaco-dialog-box");
      await expect(dialog).toBeVisible();
      await expect(dialog).toContainText("is immutable, are you sure?");
      await dialog.getByRole("button", { name: "Split Immutable Change" }).click();
      await expect(dialog).not.toBeVisible();

      await handleEditor(workbox, "", "Selected part");
      await handleEditor(workbox, "", "Remaining part");

      await expect(nodes).toHaveCount(6);

      await expect(async () => {
        const logEntries = await testRepo.log();
        expect(getParents(logEntries, "Selected part")).toEqual(["Base"]);
        expect(getParents(logEntries, "Remaining part")).toEqual(["Selected part"]);
        expect(getParents(logEntries, "Child")).toEqual(["Remaining part"]);
      }).toPass();

      expect(await diffSummary(testRepo, await changeIdFor(testRepo, "Selected part"))).toBe("A f1.txt");
      expect(await diffSummary(testRepo, await changeIdFor(testRepo, "Remaining part"))).toBe("A f2.txt");
    });
  });
});

test("file mode changes split between the resulting commits", async ({ graphFrame, testRepo, workbox }) => {
  test.skip(process.platform === "win32", "Windows file systems do not track the executable bit");
  test.slow();

  const nodes = graphFrame.locator("#nodes > div");
  await testRepo.commitFile("base.txt", "base\n", "Base");
  await testRepo.commitFile("f.sh", "one\ntwo\n", "Add script");

  await test.step("file mode changes split via the File mode changed checkbox", async () => {
    await testRepo.jjCommand(["file", "chmod", "x", "f.sh"]);
    await testRepo.writeFile("keep.txt", "kept\n");
    await testRepo.commit("Split me");

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
    // checkbox of a deleted file mirrors its full-removal hunk).
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

  await test.step("a selected mode change lands in the first split commit", async () => {
    // Mode changes only surface for modified files, and f.sh is already executable after the
    // previous step, so this step makes its own 644 script executable.
    await testRepo.commitFile("g.sh", "one\ntwo\n", "Add second script");
    await testRepo.jjCommand(["file", "chmod", "x", "g.sh"]);
    await testRepo.writeFile("g.sh", "one\ntwo\nthree\n");
    await testRepo.commit("Split me");

    await expect(nodes).toHaveCount(8);

    const splitFrame = await openSplitView(workbox, graphFrame, nodes.nth(1));
    await expect(splitFrame.locator(".splitFile")).toHaveCount(1);

    // The mode change entry sits at the top, above the content hunk.
    const gRow = splitFileRow(splitFrame, "g.sh");
    await expandSplitFile(gRow);
    await expect(gRow.locator(".splitRename")).toContainText("File mode changed to 100755");
    await expect(gRow.locator(".splitHunk")).toHaveCount(1);

    // Everything stays selected, so the mode change and the edit both go into the first commit.
    await splitFrame.locator(".splitPrimaryButton").click();

    await handleEditor(workbox, "", "All selected");
    await handleEditor(workbox, "", "All remaining");

    await expect(nodes).toHaveCount(9);

    const allSelected = await changeIdFor(testRepo, "All selected");
    const gitDiffs = await gitDiff(testRepo, allSelected);
    expect(gitDiffs).toContain("old mode 100644");
    expect(gitDiffs).toContain("new mode 100755");
    expect(await fileContent(testRepo, allSelected, "g.sh")).toBe("one\ntwo\nthree\n");
  });
});

test("file type changes to and from symlinks split between the resulting commits", async ({
  graphFrame,
  testRepo,
  workbox,
}) => {
  test.skip(process.platform === "win32", "Windows file systems do not support symlinks");
  test.slow();

  const nodes = graphFrame.locator("#nodes > div");
  await testRepo.commitFile("target.txt", "hello\n", "Base");
  await testRepo.commitFile("f.txt", "regular\n", "Add regular");

  await test.step("an unselected file-to-symlink change defers to the second commit", async () => {
    await testRepo.deleteFile("f.txt");
    await testRepo.createSymlink("f.txt", "target.txt");
    await testRepo.writeFile("keep.txt", "kept\n");
    await testRepo.commit("Split me");

    await expect(nodes).toHaveCount(5);

    const splitFrame = await openSplitView(workbox, graphFrame, nodes.nth(1));
    await expect(splitFrame.locator(".splitFile")).toHaveCount(2);

    const fRow = splitFileRow(splitFrame, "f.txt");
    await expandSplitFile(fRow);
    // The type change offers no "File mode changed to 120000" entry: only the link's target
    // string shows up, as plain content next to the old file's text.
    await expect(fRow.locator(".splitRename")).toHaveCount(0);
    await expect(fRow.locator(".splitHunk")).toHaveCount(1);
    await expect(fRow.locator(".splitLineRemoved")).toContainText("regular");
    await expect(fRow.locator(".splitLineAdded")).toContainText("target.txt");

    // Keep the type change out of the first commit: only keep.txt is split off.
    const fCheckbox = fRow.locator(".splitFileRow input.splitCheckbox");
    await fCheckbox.click();
    await expect(fCheckbox).not.toBeChecked();
    await splitFrame.locator(".splitPrimaryButton").click();

    await handleEditor(workbox, "", "Keep rest");
    await handleEditor(workbox, "", "Type change");

    await expect(nodes).toHaveCount(6);

    await expect(async () => {
      const logEntries = await testRepo.log();
      expect(getParents(logEntries, "Keep rest")).toEqual(["Add regular"]);
      expect(getParents(logEntries, "Type change")).toEqual(["Keep rest"]);
      expect(getParents(logEntries, "@")).toEqual(["Type change"]);
    }).toPass();

    // The first commit only adds keep.txt; the type change falls to the second commit.
    expect(await diffSummary(testRepo, await changeIdFor(testRepo, "Keep rest"))).toBe("A keep.txt");
    const typeChangeDiff = await gitDiff(testRepo, await changeIdFor(testRepo, "Type change"));
    expect(typeChangeDiff).toContain("old mode 100644");
    expect(typeChangeDiff).toContain("new mode 120000");
    expect(typeChangeDiff).toContain("-regular");
    expect(typeChangeDiff).toContain("+target.txt");
  });

  await test.step("a selected symlink-to-file change lands in the first split commit", async () => {
    await testRepo.deleteFile("f.txt");
    await testRepo.writeFile("f.txt", "now regular\n");
    await testRepo.commit("Split me");

    await expect(nodes).toHaveCount(7);

    const splitFrame = await openSplitView(workbox, graphFrame, nodes.nth(1));
    await expect(splitFrame.locator(".splitFile")).toHaveCount(1);

    const fRow = splitFileRow(splitFrame, "f.txt");
    await expandSplitFile(fRow);
    await expect(fRow.locator(".splitRename")).toHaveCount(0);
    await expect(fRow.locator(".splitHunk")).toHaveCount(1);
    await expect(fRow.locator(".splitLineRemoved")).toContainText("target.txt");
    await expect(fRow.locator(".splitLineAdded")).toContainText("now regular");

    // Everything stays selected, so the type change goes into the first commit.
    await splitFrame.locator(".splitPrimaryButton").click();

    await handleEditor(workbox, "", "To file");
    await handleEditor(workbox, "", "To file rest");

    await expect(nodes).toHaveCount(8);

    const toFile = await changeIdFor(testRepo, "To file");
    expect(await diffSummary(testRepo, toFile)).toBe("M f.txt");
    const toFileDiff = await gitDiff(testRepo, toFile);
    expect(toFileDiff).toContain("old mode 120000");
    expect(toFileDiff).toContain("new mode 100644");
    expect(await fileContent(testRepo, toFile, "f.txt")).toBe("now regular\n");
  });

  await test.step("a selected file-to-symlink change recreates the link in the first commit", async () => {
    await testRepo.deleteFile("f.txt");
    await testRepo.createSymlink("f.txt", "target.txt");
    await testRepo.commit("Split me");

    await expect(nodes).toHaveCount(9);

    const splitFrame = await openSplitView(workbox, graphFrame, nodes.nth(1));
    await expect(splitFrame.locator(".splitFile")).toHaveCount(1);

    const fRow = splitFileRow(splitFrame, "f.txt");
    await expandSplitFile(fRow);
    await expect(fRow.locator(".splitRename")).toHaveCount(0);
    await expect(fRow.locator(".splitHunk")).toHaveCount(1);

    // Everything stays selected, so the first commit must hold the actual link, not a regular
    // file with the target string (or 777 permissions) as content.
    await splitFrame.locator(".splitPrimaryButton").click();

    await handleEditor(workbox, "", "To link");
    await handleEditor(workbox, "", "To link rest");

    await expect(nodes).toHaveCount(10);

    const toLink = await changeIdFor(testRepo, "To link");
    expect(await diffSummary(testRepo, toLink)).toBe("M f.txt");
    const toLinkDiff = await gitDiff(testRepo, toLink);
    expect(toLinkDiff).toContain("old mode 100644");
    expect(toLinkDiff).toContain("new mode 120000");
  });
});
