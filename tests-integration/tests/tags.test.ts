import { test, expect } from "./baseTest";

test("create and delete tag from context menu", async ({ graphFrame, testRepo, workbox }) => {
  await testRepo.commitFile("test.txt", "content", "test commit");

  const nodes = graphFrame.locator("#nodes > div");
  await expect(nodes).toHaveCount(3);

  const commitNode = nodes.nth(1);
  await commitNode.click({ button: "right" });

  const createTagItem = graphFrame.locator('.context-menu-item[data-action="createTag"]');
  await createTagItem.click();

  const input = workbox.locator("input").first();
  await input.waitFor({ state: "visible" });
  await input.fill("test-tag");
  await workbox.keyboard.press("Enter");

  const tagPill = graphFrame.locator('.tag-pill[data-tag="test-tag"]');
  await expect(tagPill).toBeVisible();

  const tag = await testRepo.getTag("test-tag");
  expect(tag).toBeDefined();

  await commitNode.click({ button: "right" });

  const deleteTagItem = graphFrame.locator('.context-menu-item[data-action="deleteTag"]');
  await deleteTagItem.hover();

  const deleteTagSubmenuItem = graphFrame.locator('.context-submenu-item[data-delete-tag="test-tag"]');
  await deleteTagSubmenuItem.click();

  await expect(tagPill).not.toBeVisible();

  expect(await testRepo.getTag("test-tag")).toBeUndefined();
});
