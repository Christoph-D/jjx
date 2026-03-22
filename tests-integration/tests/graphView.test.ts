import { test, expect } from "./baseTest";

test("jj graph view loads and contains root commit", async ({ graphFrame }) => {
  const rootCommit = graphFrame.getByText("root()");
  await expect(rootCommit).toBeVisible({ timeout: 10000 });
});

test("graph view shows new commits", async ({ graphFrame, testRepo }) => {
  const nodes = graphFrame.locator("#nodes > div");
  await expect(nodes).toHaveCount(2, { timeout: 10000 });

  await testRepo.writeFile("a.txt", "content a");
  await testRepo.commit("commit 1");
  await testRepo.writeFile("b.txt", "content b");
  await testRepo.commit("commit 2");
  await testRepo.writeFile("c.txt", "content c");
  await testRepo.commit("commit 3");

  await expect(nodes).toHaveCount(5, { timeout: 10000 });

  await expect(graphFrame.getByText("commit 1")).toBeVisible();
  await expect(graphFrame.getByText("commit 2")).toBeVisible();
  await expect(graphFrame.getByText("commit 3")).toBeVisible();
});

test("create bookmark from context menu", async ({ graphFrame, testRepo, workbox }) => {
  await testRepo.writeFile("test.txt", "content");
  await testRepo.commit("test commit");

  const nodes = graphFrame.locator("#nodes > div");
  await expect(nodes).toHaveCount(3, { timeout: 10000 });

  const commitNode = nodes.nth(0);
  await commitNode.click({ button: "right" });

  const createBookmarkItem = graphFrame.locator('.context-menu-item[data-action="createBookmark"]');
  await createBookmarkItem.click();

  const input = workbox.locator("input").first();
  await input.waitFor({ state: "visible", timeout: 5000 });
  await input.fill("foo");
  await workbox.keyboard.press("Enter");

  const bookmarkPill = graphFrame.locator('.bookmark-pill[data-bookmark="foo"]');
  await expect(bookmarkPill).toBeVisible({ timeout: 10000 });

  const result = await testRepo.jjCommand(["bookmark", "list", "-T", "name", "foo"]);
  expect(result.stdout.trim()).toBe("foo");
  expect(result.exitCode).toBe(0);

  await commitNode.click({ button: "right" });

  const deleteBookmarkItem = graphFrame.locator('.context-menu-item[data-action="deleteBookmark"]');
  await deleteBookmarkItem.hover();

  const deleteBookmarkSubmenuItem = graphFrame.locator('.context-submenu-item[data-delete-bookmark="foo"]');
  await deleteBookmarkSubmenuItem.click();

  await expect(bookmarkPill).not.toBeVisible({ timeout: 10000 });

  const deleteResult = await testRepo.jjCommand(["bookmark", "list", "-T", "name", "foo"]);
  expect(deleteResult.stdout.trim()).toBe("");
});

test("move bookmark forward and backward with confirmation", async ({ graphFrame, testRepo, workbox }) => {
  await testRepo.writeFile("a.txt", "content a");
  await testRepo.commit("commit 1");
  await testRepo.writeFile("b.txt", "content b");
  await testRepo.commit("commit 2");

  const nodes = graphFrame.locator("#nodes > div");
  await expect(nodes).toHaveCount(4, { timeout: 10000 });

  const commit1Node = nodes.nth(2);
  await commit1Node.click({ button: "right" });

  const createBookmarkItem = graphFrame.locator('.context-menu-item[data-action="createBookmark"]');
  await createBookmarkItem.click();

  const input = workbox.locator("input").first();
  await input.waitFor({ state: "visible", timeout: 5000 });
  await input.fill("test-bookmark");
  await workbox.keyboard.press("Enter");

  const bookmarkPill = graphFrame.locator('.bookmark-pill[data-bookmark="test-bookmark"]');
  await expect(bookmarkPill).toBeVisible({ timeout: 10000 });

  let result = await testRepo.jjCommand([
    "bookmark",
    "list",
    "-T",
    'name ++ " " ++ self.normal_target().description()',
    "test-bookmark",
  ]);
  expect(result.stdout.trim()).toContain("commit 1");
  expect(result.exitCode).toBe(0);

  const commit2Node = nodes.nth(1);
  await commit2Node.click({ button: "right" });

  const moveBookmarkItem = graphFrame.locator('.context-menu-item[data-action="moveBookmark"]');
  await moveBookmarkItem.hover();

  const bookmarkSubmenuItem = graphFrame.locator('.context-submenu-item[data-bookmark="test-bookmark"]');
  await bookmarkSubmenuItem.click();

  await expect(commit2Node.locator('.bookmark-pill[data-bookmark="test-bookmark"]')).toBeVisible({ timeout: 10000 });

  result = await testRepo.jjCommand([
    "bookmark",
    "list",
    "-T",
    'name ++ " " ++ self.normal_target().description()',
    "test-bookmark",
  ]);
  expect(result.stdout.trim()).toContain("commit 2");
  expect(result.exitCode).toBe(0);

  await commit1Node.click({ button: "right" });
  await moveBookmarkItem.hover();
  await bookmarkSubmenuItem.click();

  const quickPickContinue = workbox.getByRole("option", { name: "Continue" });
  await quickPickContinue.waitFor({ state: "visible", timeout: 10000 });
  await quickPickContinue.click();

  await expect(commit1Node.locator('.bookmark-pill[data-bookmark="test-bookmark"]')).toBeVisible({ timeout: 10000 });

  result = await testRepo.jjCommand([
    "bookmark",
    "list",
    "-T",
    'name ++ " " ++ self.normal_target().description()',
    "test-bookmark",
  ]);
  expect(result.stdout.trim()).toContain("commit 1");
  expect(result.exitCode).toBe(0);
});
