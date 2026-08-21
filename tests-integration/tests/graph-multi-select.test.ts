import { test, expect, mod } from "./base-test";

test("multi-select in the graph", async ({ graphFrame, testRepo, workbox }) => {
  await testRepo.commitFile("a.txt", "content a", "commit A");
  await testRepo.commitFile("b.txt", "content b", "commit B");
  await testRepo.commitFile("c.txt", "content c", "commit C");

  const nodes = graphFrame.locator("#nodes > div");
  await expect(nodes).toHaveCount(5); // @, commit C, commit B, commit A, root

  await test.step("shift+click selects a range and ctrl+click toggles a single change", async () => {
    // Plain click selects a single change and sets the selection anchor.
    await nodes.nth(3).click();
    await expect(nodes.nth(3)).toHaveAttribute("data-selected");

    // Shift+click extends the selection to the contiguous range between the
    // anchor (commit A) and the clicked change (commit C).
    await nodes.nth(1).click({ modifiers: ["Shift"] });
    await expect(nodes.nth(1)).toHaveAttribute("data-selected");
    await expect(nodes.nth(2)).toHaveAttribute("data-selected");
    await expect(nodes.nth(3)).toHaveAttribute("data-selected");
    await expect(nodes.nth(0)).not.toHaveAttribute("data-selected");
    await expect(nodes.nth(4)).not.toHaveAttribute("data-selected");

    // Ctrl/Cmd+click toggles a single change out of the selection.
    await nodes.nth(2).click({ modifiers: [mod] });
    await expect(nodes.nth(1)).toHaveAttribute("data-selected");
    await expect(nodes.nth(2)).not.toHaveAttribute("data-selected");
    await expect(nodes.nth(3)).toHaveAttribute("data-selected");

    // Ctrl/Cmd+click toggles it back in.
    await nodes.nth(2).click({ modifiers: [mod] });
    await expect(nodes.nth(2)).toHaveAttribute("data-selected");
  });

  await test.step("shift+click over elided commits leaves the selection unchanged and warns", async () => {
    // Tagging @- makes its ancestors immutable, which elides them.
    await testRepo.createTag("test-tag", "@-");

    await expect(nodes).toHaveCount(3); // @, commit C, elided

    const elidedNode = graphFrame.locator('#nodes > div[data-change-id^="~"]');
    await expect(elidedNode).toBeVisible();

    // Select @ and commit C (a range without elided changes).
    await nodes.nth(0).click();
    await nodes.nth(1).click({ modifiers: ["Shift"] });
    await expect(nodes.nth(0)).toHaveAttribute("data-selected");
    await expect(nodes.nth(1)).toHaveAttribute("data-selected");

    // Shift+clicking across the elided change warns and keeps the selection.
    await elidedNode.click({ modifiers: ["Shift"] });

    const warningToast = workbox
      .locator(".notifications-toasts .notification-list-item")
      .filter({ hasText: "Shift+click doesn't support selecting a range that includes elided commits." });
    await expect(warningToast).toBeVisible();

    await expect(nodes.nth(0)).toHaveAttribute("data-selected");
    await expect(nodes.nth(1)).toHaveAttribute("data-selected");
    await expect(elidedNode).not.toHaveAttribute("data-selected");
  });
});
