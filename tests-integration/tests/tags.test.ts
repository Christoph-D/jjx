import { test, expect, clickPillMenuItem } from "./base-test";

test("create and delete tag from context menu", async ({ graphFrame, testRepo, workbox }) => {
  await testRepo.commitFile("test.txt", "content", "test commit");

  const nodes = graphFrame.locator("#nodes > div");
  await expect(nodes).toHaveCount(3);

  const commitNode = nodes.nth(1);

  const createTagViaContextMenu = async (name: string) => {
    await commitNode.locator('[data-role="change-id"]').click({ button: "right" });

    const createTagItem = graphFrame.locator('[data-action="createTag"]');
    await createTagItem.click();

    const input = workbox.locator("input").first();
    await input.waitFor({ state: "visible" });
    await input.fill(name);
    await workbox.keyboard.press("Enter");
  };

  await createTagViaContextMenu("test-tag");

  const tagPill = graphFrame.locator('[data-tag="test-tag"]');
  await expect(tagPill).toBeVisible();

  const tag = await testRepo.getTag("test-tag");
  expect(tag).toBeDefined();

  await createTagViaContextMenu("#special");

  const specialTagPill = graphFrame.locator('[data-tag="#special"]');
  await expect(specialTagPill).toBeVisible();

  expect(await testRepo.getTag("#special")).toBeDefined();

  await clickPillMenuItem(graphFrame, tagPill, "Delete Tag");

  const dialog = workbox.locator(".monaco-dialog-box");
  await expect(dialog).toContainText("test-tag");
  await dialog.getByRole("button", { name: "Delete Tag" }).click();

  await expect(tagPill).not.toBeVisible();

  expect(await testRepo.getTag("test-tag")).toBeUndefined();

  await clickPillMenuItem(graphFrame, specialTagPill, "Delete Tag");

  await expect(dialog).toContainText("#special");
  await dialog.getByRole("button", { name: "Delete Tag" }).click();

  await expect(specialTagPill).not.toBeVisible();

  expect(await testRepo.getTag("#special")).toBeUndefined();
});
