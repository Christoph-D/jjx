import { test, expect } from "./baseTest";

test("create and delete bookmark from context menu", async ({ graphFrame, testRepo, workbox }) => {
  await testRepo.commitFile("test.txt", "content", "test commit");

  const nodes = graphFrame.locator("#nodes > div");
  await expect(nodes).toHaveCount(3);

  const commitNode = nodes.nth(0);
  await commitNode.click({ button: "right" });

  const createBookmarkItem = graphFrame.locator('.context-menu-item[data-action="createBookmark"]');
  await createBookmarkItem.click();

  const input = workbox.locator("input").first();
  await input.waitFor({ state: "visible" });
  await input.fill("test-bookmark");
  await workbox.keyboard.press("Enter");

  const bookmarkPill = graphFrame.locator('.bookmark-pill[data-bookmark="test-bookmark"]');
  await expect(bookmarkPill).toBeVisible();

  const bookmark = await testRepo.getBookmark("test-bookmark");
  expect(bookmark).toBeDefined();

  await commitNode.click({ button: "right" });

  const deleteBookmarkItem = graphFrame.locator('.context-menu-item[data-action="deleteBookmark"]');
  await deleteBookmarkItem.hover();

  const deleteBookmarkSubmenuItem = graphFrame.locator('.context-submenu-item[data-delete-bookmark="test-bookmark"]');
  await deleteBookmarkSubmenuItem.click();

  await expect(bookmarkPill).not.toBeVisible();

  expect(await testRepo.getBookmark("test-bookmark")).toBeUndefined();
});

test("move bookmark forward and backward with confirmation", async ({ graphFrame, testRepo, workbox }) => {
  await testRepo.commitFile("a.txt", "content a", "commit 1");
  await testRepo.commitFile("b.txt", "content b", "commit 2");

  const nodes = graphFrame.locator("#nodes > div");
  await expect(nodes).toHaveCount(4);

  const commit1Node = nodes.nth(2);
  await commit1Node.click({ button: "right" });

  const createBookmarkItem = graphFrame.locator('.context-menu-item[data-action="createBookmark"]');
  await createBookmarkItem.click();

  const input = workbox.locator("input").first();
  await input.waitFor({ state: "visible" });
  await input.fill("test-bookmark");
  await workbox.keyboard.press("Enter");

  const bookmarkPill = graphFrame.locator('.bookmark-pill[data-bookmark="test-bookmark"]');
  await expect(bookmarkPill).toBeVisible();

  let bookmark = await testRepo.getBookmark("test-bookmark");
  expect(bookmark?.description).toBe("commit 1");

  const commit2Node = nodes.nth(1);
  await commit2Node.click({ button: "right" });

  const moveBookmarkItem = graphFrame.locator('.context-menu-item[data-action="moveBookmark"]');
  await moveBookmarkItem.hover();

  const bookmarkSubmenuItem = graphFrame.locator('.context-submenu-item[data-bookmark="test-bookmark"]');
  await bookmarkSubmenuItem.click();

  await expect(commit2Node.locator('.bookmark-pill[data-bookmark="test-bookmark"]')).toBeVisible();

  bookmark = await testRepo.getBookmark("test-bookmark");
  expect(bookmark?.description).toBe("commit 2");

  await commit1Node.click({ button: "right" });
  await moveBookmarkItem.hover();
  await bookmarkSubmenuItem.click();

  const quickPickContinue = workbox.getByRole("option", { name: "Continue" });
  await quickPickContinue.waitFor({ state: "visible" });
  await quickPickContinue.click();

  await expect(commit1Node.locator('.bookmark-pill[data-bookmark="test-bookmark"]')).toBeVisible();

  bookmark = await testRepo.getBookmark("test-bookmark");
  expect(bookmark?.description).toBe("commit 1");
});
