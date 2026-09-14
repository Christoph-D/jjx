import { test, expect, mod } from "./base-test";
import type { Frame, Page } from "@playwright/test";
import { changeIdFromLogEntry, formatChangeIdShort, maxChangeIdPrefixLength } from "../../src/utils.js";

async function findDetailsFrame(workbox: Page): Promise<Frame> {
  let detailsFrame: Frame | undefined;
  await expect(async () => {
    for (const frame of workbox.frames()) {
      try {
        const content = await frame.content();
        if (content.includes('id="details"')) {
          detailsFrame = frame;
          return;
        }
      } catch {
        // The frame can be mid-navigation while the webview (re)loads; the
        // content read throws while it is settling, so just try the next.
      }
    }
    throw new Error("Details frame not ready");
  }).toPass();
  return detailsFrame!;
}

test("details view shows the selected change and follows the graph selection", async ({
  scmView,
  graphFrame,
  testRepo,
  workbox,
  electronApp,
}) => {
  await testRepo.commitFile("a.txt", "content a", "commit A");
  await testRepo.commitFile("b.txt", "content b", "commit B");

  const nodes = graphFrame.locator("#nodes > div");
  await expect(nodes).toHaveCount(4); // @, commit B, commit A, root

  const graphPaneHeader = scmView.locator(".pane-header", { hasText: "JJ Graph" }).first();
  const detailsButton = graphPaneHeader.getByRole("button", { name: "Show Details of Selected Change" });
  const fetchButton = graphPaneHeader.getByRole("button", { name: /Fetch from Default Remote/ });
  const undoButton = graphPaneHeader.getByRole("button", { name: "Undo", exact: true });

  await test.step("info button is the left-most button in the graph toolbar", async () => {
    const detailsBox = await detailsButton.boundingBox();
    const fetchBox = await fetchButton.boundingBox();
    const undoBox = await undoButton.boundingBox();
    expect(detailsBox).not.toBeNull();
    expect(fetchBox).not.toBeNull();
    expect(undoBox).not.toBeNull();
    expect(detailsBox!.x).toBeLessThan(fetchBox!.x);
    expect(detailsBox!.x).toBeLessThan(undoBox!.x);
  });

  await detailsButton.click();
  const detailsFrame = await findDetailsFrame(workbox);

  await test.step("no selection prompts to select a change", async () => {
    await expect(detailsFrame.getByText("Select a change in the graph")).toBeVisible();
  });

  const commitB = (await testRepo.log("@-"))[0];
  const expectedShortChangeId = formatChangeIdShort(
    changeIdFromLogEntry(commitB, maxChangeIdPrefixLength([commitB.change_id_shortest])),
  );

  await test.step("single selection shows the change's details", async () => {
    await nodes.nth(1).click();
    await expect(nodes.nth(1)).toHaveAttribute("data-selected");

    // The Change ID row omits the offset suffix for this non-divergent change, even though jj
    // reports one.
    const changeId = detailsFrame.locator(".detailsId").filter({ hasText: commitB.change_id });
    await expect(changeId).toHaveText(commitB.change_id);
    const commitId = detailsFrame.locator(".detailsId").filter({ hasText: commitB.commit_id });
    await expect(commitId).toHaveText(commitB.commit_id);
    await expect(detailsFrame.locator(".detailsDescription")).toHaveText("commit B");
    await expect(detailsFrame.getByText("Test User <test@example.com>").first()).toBeVisible();

    const changedFile = detailsFrame.locator('[data-role="changed-file"][data-path="b.txt"]');
    await expect(changedFile).toBeVisible();
    await expect(changedFile.locator(".detailsAdded")).toHaveText("+1");
    await expect(changedFile.locator(".detailsRemoved")).toHaveCount(0);
  });

  await test.step("bookmarks and tags rows appear only when populated", async () => {
    await expect(detailsFrame.locator(".detailsFieldRow").filter({ hasText: "Bookmarks" })).toHaveCount(0);
    await expect(detailsFrame.locator(".detailsFieldRow").filter({ hasText: "Tags" })).toHaveCount(0);

    // A bookmark on the selected commit adds only the Bookmarks row.
    await testRepo.jjCommand(["bookmark", "set", "-r", commitB.change_id, "topic"]);
    const bookmarksRow = detailsFrame.locator(".detailsFieldRow").filter({ hasText: "Bookmarks" });
    await expect(bookmarksRow).toBeVisible();
    await expect(bookmarksRow.locator(".detailsPill")).toHaveText("topic");
    await expect(detailsFrame.locator(".detailsFieldRow").filter({ hasText: "Tags" })).toHaveCount(0);

    // A tag on the root commit adds only the Tags row. The root is an immutable head either
    // way, so tagging it keeps the graph revset (and the node indices below) unchanged.
    await testRepo.createTag("v1", "root()");
    const rootNode = nodes.nth(3);
    await rootNode.click();
    await expect(rootNode).toHaveAttribute("data-selected");
    const tagsRow = detailsFrame.locator(".detailsFieldRow").filter({ hasText: "Tags" });
    await expect(tagsRow).toBeVisible();
    await expect(tagsRow.locator(".detailsPill")).toHaveText("v1");
    await expect(detailsFrame.locator(".detailsFieldRow").filter({ hasText: "Bookmarks" })).toHaveCount(0);

    // Restore the commit B selection the later steps build on.
    await nodes.nth(1).click();
    await expect(detailsFrame.locator(".detailsId").filter({ hasText: commitB.change_id })).toHaveText(
      commitB.change_id,
    );
  });

  await test.step("copy buttons copy the full change and commit IDs", async () => {
    const changeIdCopy = detailsFrame
      .locator(".detailsFieldRow")
      .filter({ hasText: "Change ID" })
      .locator('[data-role="copy-id"]');
    const commitIdCopy = detailsFrame
      .locator(".detailsFieldRow")
      .filter({ hasText: "Commit ID" })
      .locator('[data-role="copy-id"]');

    await changeIdCopy.click();
    await expect(changeIdCopy.locator(".codicon")).toHaveClass(/codicon-check/);
    // The copied full change ID omits the offset jj still reports for this non-divergent
    // change, matching the ID shown in the row.
    await expect
      .poll(() =>
        electronApp.evaluate(({ clipboard }: { clipboard: { readText: () => string } }) => clipboard.readText()),
      )
      .toBe(commitB.change_id);

    await commitIdCopy.click();
    await expect
      .poll(() =>
        electronApp.evaluate(({ clipboard }: { clipboard: { readText: () => string } }) => clipboard.readText()),
      )
      .toBe(commitB.commit_id);
  });

  await test.step("right-clicking an ID value offers Copy and Copy Short ID", async () => {
    const menu = detailsFrame.locator("#id-context-menu");

    // The Change ID menu copies the full ID (without the unneeded offset, like the copy
    // button) and the short change ID as the graph view shows it.
    const changeIdValue = detailsFrame
      .locator(".detailsFieldRow")
      .filter({ hasText: "Change ID" })
      .locator(".detailsId");
    await changeIdValue.click({ button: "right" });
    await expect(menu).toBeVisible();
    await expect(menu.locator("[data-action]")).toHaveText(["Copy", "Copy Short Change ID"]);
    await menu.locator('[data-action="copyShortId"]').click();
    await expect(menu).not.toBeVisible();
    await expect
      .poll(() =>
        electronApp.evaluate(({ clipboard }: { clipboard: { readText: () => string } }) => clipboard.readText()),
      )
      .toBe(expectedShortChangeId);

    await changeIdValue.click({ button: "right" });
    await menu.locator('[data-action="copyId"]').click();
    await expect
      .poll(() =>
        electronApp.evaluate(({ clipboard }: { clipboard: { readText: () => string } }) => clipboard.readText()),
      )
      .toBe(commitB.change_id);

    // The Commit ID menu copies the full ID and the shortest unique ID (minimum 7 chars).
    const commitIdValue = detailsFrame
      .locator(".detailsFieldRow")
      .filter({ hasText: "Commit ID" })
      .locator(".detailsId");
    await commitIdValue.click({ button: "right" });
    await expect(menu).toBeVisible();
    await expect(menu.locator("[data-action]")).toHaveText(["Copy", "Copy Short Commit ID"]);
    await menu.locator('[data-action="copyShortId"]').click();
    await expect
      .poll(() =>
        electronApp.evaluate(({ clipboard }: { clipboard: { readText: () => string } }) => clipboard.readText()),
      )
      .toBe(commitB.commit_id_short);
    expect(commitB.commit_id_short.length).toBeGreaterThanOrEqual(7);
    expect(commitB.commit_id.startsWith(commitB.commit_id_short)).toBe(true);

    await commitIdValue.click({ button: "right" });
    await menu.locator('[data-action="copyId"]').click();
    await expect
      .poll(() =>
        electronApp.evaluate(({ clipboard }: { clipboard: { readText: () => string } }) => clipboard.readText()),
      )
      .toBe(commitB.commit_id);
  });

  await test.step("right-clicking never deselects the current text selection", async () => {
    const textMenu = detailsFrame.locator("#text-context-menu");
    const description = detailsFrame.locator(".detailsDescriptionSection");
    const selectionText = () => detailsFrame.evaluate(() => window.getSelection()?.toString() ?? "");

    // Right-clicking inside the selection keeps it and offers to copy it.
    await description.selectText();
    await expect.poll(selectionText).toBe("commit B");
    await description.click({ button: "right" });
    await expect(textMenu).toBeVisible();
    await expect(textMenu.locator("[data-action]")).toHaveText(["Copy"]);
    expect(await selectionText()).toBe("commit B");
    await textMenu.locator('[data-action="copyText"]').click();
    await expect(textMenu).not.toBeVisible();
    await expect
      .poll(() =>
        electronApp.evaluate(({ clipboard }: { clipboard: { readText: () => string } }) => clipboard.readText()),
      )
      .toBe("commit B");

    // Right-clicking on a selectable region outside the selection keeps it too, without
    // showing any menu (the browser default would collapse the selection onto the caret).
    await description.selectText();
    const authorValue = detailsFrame
      .locator(".detailsFieldRow")
      .filter({ hasText: "Author" })
      .locator(".detailsFieldValue");
    await authorValue.click({ button: "right" });
    await expect(textMenu).not.toBeVisible();
    expect(await selectionText()).toBe("commit B");
  });

  await test.step("clicking a changed file opens its diff", async () => {
    await detailsFrame.locator('[data-role="changed-file"][data-path="b.txt"]').click();

    const diffEditor = workbox.locator(".editor-instance");
    await expect(diffEditor).toBeVisible();
    // b.txt is added in commit B: original is empty, modified contains the content.
    const original = workbox.locator(".editor.original .view-lines");
    const modified = workbox.locator(".editor.modified .view-lines");
    await expect(original).toHaveText(/^\s*$/);
    await expect(modified.getByText("content b", { exact: true }).first()).toBeVisible();

    // The diff replaced the Details tab in the editor group; bring it back.
    await workbox.getByRole("tab", { name: "JJ Commit Details", exact: true }).click();
  });

  await test.step("changed files have the same context menu as the graph view", async () => {
    const changedFile = detailsFrame.locator('[data-role="changed-file"][data-path="b.txt"]');
    await changedFile.click({ button: "right" });
    const menu = detailsFrame.locator("#file-context-menu");
    await expect(menu).toBeVisible();
    // commit B is not the working copy, so it also offers "Open File in Working Copy".
    await expect(menu.locator("[data-action]")).toHaveText([
      "View as Diff",
      "Open File",
      "Open File in Working Copy",
      "Copy Path",
      "Copy Relative Path",
    ]);
    await detailsFrame.locator('[data-role="changed-file"][data-path="b.txt"]').click();
    await expect(menu).not.toBeVisible();
  });

  await test.step("multiple selections show the last selected change", async () => {
    // Ctrl/Cmd+click appends the clicked change to the selection, so commit B is the
    // most recently added member and its details are shown.
    await nodes.nth(0).click();
    await nodes.nth(1).click({ modifiers: [mod] });
    await expect(nodes.nth(0)).toHaveAttribute("data-selected");
    await expect(nodes.nth(1)).toHaveAttribute("data-selected");

    await expect(detailsFrame.getByText("Multiple changes selected")).toHaveCount(0);
    await expect(detailsFrame.locator(".detailsDescription")).toHaveText("commit B");

    // Shift+click orders the range from the anchor toward the clicked change, so clicking
    // the working copy last makes it the last selected change.
    await nodes.nth(1).click();
    await nodes.nth(0).click({ modifiers: ["Shift"] });
    await expect(nodes.nth(0)).toHaveAttribute("data-selected");
    await expect(nodes.nth(1)).toHaveAttribute("data-selected");

    await expect(detailsFrame.getByText("(no description set)")).toBeVisible();
  });

  await test.step("changing the selection updates the details view", async () => {
    await nodes.nth(2).click();
    await expect(nodes.nth(2)).toHaveAttribute("data-selected");

    await expect(detailsFrame.locator(".detailsDescription")).toHaveText("commit A");
    const changedFileA = detailsFrame.locator('[data-role="changed-file"][data-path="a.txt"]');
    await expect(changedFileA).toBeVisible();
    await expect(changedFileA.locator(".detailsAdded")).toHaveText("+1");
  });

  await test.step("change ID row keeps the offset only for divergent changes", async () => {
    // Build on commit B's pre-commit version (at offset 1), resurrecting it and making the change
    // divergent: two visible commits now share the change ID.
    await testRepo.jjCommand(["new", `${commitB.change_id}/1`]);
    await expect(nodes).toHaveCount(5);

    const divergentSibling = graphFrame.locator(`#nodes > [data-change-id="${commitB.change_id}/1"]`);
    await divergentSibling.click();
    await expect(divergentSibling).toHaveAttribute("data-selected");

    const changeIdRow = detailsFrame.locator(".detailsId").filter({ hasText: commitB.change_id });
    await expect(changeIdRow).toHaveText(`${commitB.change_id}/1`);

    // The diff opened by the context-menu step replaced the Details tab in the editor group;
    // bring it back so the copy button is clickable.
    await workbox.getByRole("tab", { name: "JJ Commit Details", exact: true }).click();

    // Copying keeps the offset because it is needed to disambiguate the divergent change.
    const changeIdCopy = detailsFrame
      .locator(".detailsFieldRow")
      .filter({ hasText: "Change ID" })
      .locator('[data-role="copy-id"]');
    await changeIdCopy.click();
    await expect
      .poll(() =>
        electronApp.evaluate(({ clipboard }: { clipboard: { readText: () => string } }) => clipboard.readText()),
      )
      .toBe(`${commitB.change_id}/1`);

    // Once the divergent sibling is abandoned, the change is no longer divergent, but jj keeps
    // reporting a change offset (e.g. "0") that must not leak into the Change ID row.
    await testRepo.jjCommand(["abandon", `${commitB.change_id}/1`]);
    await expect(nodes).toHaveCount(4);

    const commitBAfter = (await testRepo.log()).find((e) => e.change_id === commitB.change_id)!;
    expect(commitBAfter.divergent).toBe(false);
    expect(commitBAfter.change_offset).toBeTruthy();

    const commitBNode = graphFrame.locator(`#nodes > [data-change-id^="${commitB.change_id}"]`);
    await commitBNode.click();
    await expect(commitBNode).toHaveAttribute("data-selected");
    await expect(changeIdRow).toHaveText(commitB.change_id);

    // The offset jj keeps reporting must not leak into the copied full change ID either.
    await changeIdCopy.click();
    await expect
      .poll(() =>
        electronApp.evaluate(({ clipboard }: { clipboard: { readText: () => string } }) => clipboard.readText()),
      )
      .toBe(commitB.change_id);
  });
});
