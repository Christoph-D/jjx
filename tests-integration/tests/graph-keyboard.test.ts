import { test, expect, mod } from "./base-test";

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
