import { test, expect, mod } from "./base-test";
import { getParents } from "../test-repo";
import { changeIdFromLogEntry, formatChangeIdShort, maxChangeIdPrefixLength } from "../../src/utils.js";

test("arrow keys move the selection in the graph", async ({ graphFrame, testRepo, workbox }) => {
  await testRepo.commitFile("a.txt", "content a", "commit A");
  await testRepo.commitFile("b.txt", "content b", "commit B");
  await testRepo.commitFile("c.txt", "content c", "commit C");

  // Tagging @- makes its ancestors immutable, which elides them below commit C.
  await testRepo.createTag("test-tag", "@-");

  const nodes = graphFrame.locator("#nodes > div");
  await expect(nodes).toHaveCount(3); // @, commit C, elided

  const elidedNode = graphFrame.locator('#nodes > div[data-change-id^="~"]');
  await expect(elidedNode).toBeVisible();

  // The rows are not focusable; clicking the elided row gives the webview itself focus
  // without changing the selection (plain clicks on elided rows are ignored).
  await elidedNode.click();
  await expect(nodes.locator("[data-selected]")).toHaveCount(0);

  await test.step("ArrowDown from an empty selection starts at the top change", async () => {
    await workbox.keyboard.press("ArrowDown");
    await expect(nodes.nth(0)).toHaveAttribute("data-selected");
    await expect(nodes.nth(1)).not.toHaveAttribute("data-selected");
  });

  await test.step("ArrowDown moves the selection down one row", async () => {
    await workbox.keyboard.press("ArrowDown");
    await expect(nodes.nth(0)).not.toHaveAttribute("data-selected");
    await expect(nodes.nth(1)).toHaveAttribute("data-selected");
  });

  await test.step("ArrowDown at the last change does nothing (no wrap, elided rows skipped)", async () => {
    await workbox.keyboard.press("ArrowDown");
    await expect(nodes.nth(1)).toHaveAttribute("data-selected");
    await expect(elidedNode).not.toHaveAttribute("data-selected");
  });

  await test.step("ArrowUp moves the selection up one row", async () => {
    await workbox.keyboard.press("ArrowUp");
    await expect(nodes.nth(0)).toHaveAttribute("data-selected");
    await expect(nodes.nth(1)).not.toHaveAttribute("data-selected");
  });

  await test.step("ArrowUp at the top-most change does nothing", async () => {
    await workbox.keyboard.press("ArrowUp");
    await expect(nodes.nth(0)).toHaveAttribute("data-selected");
  });

  await test.step("ArrowUp from an empty selection starts at the bottom-most selectable change", async () => {
    // Ctrl/Cmd+click toggles the selected change back out of the selection.
    await nodes.nth(0).click({ modifiers: [mod] });
    await expect(nodes.locator("[data-selected]")).toHaveCount(0);

    await workbox.keyboard.press("ArrowUp");
    await expect(nodes.nth(1)).toHaveAttribute("data-selected");
    await expect(nodes.nth(0)).not.toHaveAttribute("data-selected");
  });

  await test.step("arrows treat a multi-selection as its last selected change", async () => {
    // Plain click on @ sets the anchor, shift+click extends to commit C.
    await nodes.nth(0).click();
    await nodes.nth(1).click({ modifiers: ["Shift"] });
    await expect(nodes.nth(0)).toHaveAttribute("data-selected");
    await expect(nodes.nth(1)).toHaveAttribute("data-selected");

    // The last selected change (commit C) is the reference, so ArrowUp selects
    // the single change above it.
    await workbox.keyboard.press("ArrowUp");
    await expect(nodes.nth(0)).toHaveAttribute("data-selected");
    await expect(nodes.nth(1)).not.toHaveAttribute("data-selected");
  });
});

test("Delete abandons the selected changes like the context menu", async ({ graphFrame, testRepo, workbox }) => {
  await testRepo.commitFile("a.txt", "content a", "A");
  await testRepo.commitFile("b.txt", "content b", "Second commit");
  await testRepo.commitFile("c.txt", "content c", "C");

  const entries = await testRepo.log();
  const changeB = entries.find((e) => e.description.trim() === "Second commit")!;
  const changeBShort = formatChangeIdShort(
    changeIdFromLogEntry(changeB, maxChangeIdPrefixLength(entries.map((e) => e.change_id_shortest))),
  );

  const nodes = graphFrame.locator("#nodes > div");
  await expect(nodes).toHaveCount(5); // @, C, Second commit, A, root

  await test.step("Delete with a single selection opens the single-change prompt", async () => {
    // Clicking the row both selects it and gives the webview keyboard focus.
    const commitB = nodes.nth(2);
    await commitB.click();
    await expect(commitB).toHaveAttribute("data-selected");

    await workbox.keyboard.press("Delete");

    const dialog = workbox.locator(".monaco-dialog-box");
    await expect(dialog).toBeVisible();
    await expect(dialog).toContainText(`Are you sure you want to abandon change "${changeBShort}"?`);
    await expect(dialog).toContainText("→ Second commit");

    // Cancelling keeps the change (and the selection).
    await workbox.keyboard.press("Escape");
    await expect(dialog).not.toBeVisible();
    await expect(commitB).toHaveAttribute("data-selected");
    await expect(nodes).toHaveCount(5);

    // Confirming abandons it. Closing the dialog moved the keyboard focus back
    // to the workbench, so click the row again to refocus the webview first.
    await commitB.click();
    await expect(commitB).toHaveAttribute("data-selected");
    await workbox.keyboard.press("Delete");
    await expect(dialog).toBeVisible();
    await dialog.getByRole("button", { name: "Abandon" }).click();
    await expect(dialog).not.toBeVisible();

    await expect(nodes).toHaveCount(4);
    await expect(async () => {
      const logEntries = await testRepo.log();
      expect(logEntries.find((e) => e.description.trim() === "Second commit")).toBeUndefined();
      expect(getParents(logEntries, "C")).toEqual(["A"]);
    }).toPass();
  });

  await test.step("Delete with a multi-selection opens the multi-change prompt", async () => {
    // @, C, A, root are left; select C and A as a range.
    const commitC = nodes.nth(1);
    const commitA = nodes.nth(2);
    await commitC.click();
    await commitA.click({ modifiers: ["Shift"] });
    await expect(commitC).toHaveAttribute("data-selected");
    await expect(commitA).toHaveAttribute("data-selected");

    await workbox.keyboard.press("Delete");

    const dialog = workbox.locator(".monaco-dialog-box");
    await expect(dialog).toBeVisible();
    await expect(dialog).toContainText("Are you sure you want to abandon 2 changes?");
    await dialog.getByRole("button", { name: "Abandon" }).click();
    await expect(dialog).not.toBeVisible();

    await expect(nodes).toHaveCount(2); // @, root
    await expect(async () => {
      const logEntries = await testRepo.log();
      expect(logEntries.find((e) => e.description.trim() === "C")).toBeUndefined();
      expect(logEntries.find((e) => e.description.trim() === "A")).toBeUndefined();
      // The working copy's only remaining parent is the (descriptionless) root.
      expect(getParents(logEntries, "@")).toEqual([""]);
    }).toPass();
  });
});
