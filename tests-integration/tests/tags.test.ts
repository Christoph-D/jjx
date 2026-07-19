import { test, expect } from "./baseTest";

test("create and delete tag from context menu", async ({ graphFrame, testRepo, workbox }) => {
  await testRepo.commitFile("test.txt", "content", "test commit");

  const nodes = graphFrame.locator("#nodes > div");
  await expect(nodes).toHaveCount(3);

  const commitNode = nodes.nth(1);
  await commitNode.click({ button: "right" });

  const createTagItem = graphFrame.locator('[data-action="createTag"]');
  await createTagItem.click();

  const input = workbox.locator("input").first();
  await input.waitFor({ state: "visible" });
  await input.fill("test-tag");
  await workbox.keyboard.press("Enter");

  const tagPill = graphFrame.locator('[data-tag="test-tag"]');
  await expect(tagPill).toBeVisible();

  const tag = await testRepo.getTag("test-tag");
  expect(tag).toBeDefined();

  await tagPill.click({ button: "right" });

  const pillContextMenu = graphFrame.locator("#pill-context-menu");
  await expect(pillContextMenu).toBeVisible();
  await pillContextMenu.locator("[data-action]").click();

  const dialog = workbox.locator(".monaco-dialog-box");
  await expect(dialog).toContainText("test-tag");

  const modalDelete = dialog.getByRole("button", { name: "Delete" });
  await modalDelete.waitFor();
  await modalDelete.click();

  await expect(tagPill).not.toBeVisible();

  expect(await testRepo.getTag("test-tag")).toBeUndefined();
});
