import { test, expect } from "./baseTest";

test("edit this change via context menu", async ({ graphFrame, testRepo }) => {
  await testRepo.commitFile("a.txt", "content a", "A");
  await testRepo.commitFile("b.txt", "content b", "B");
  await testRepo.commitFile("c.txt", "content c", "C");

  const nodes = graphFrame.locator("#nodes > div");
  await expect(nodes).toHaveCount(5);

  const commitB = nodes.nth(2);
  await commitB.click({ button: "right" });

  const editItem = graphFrame.locator('.context-menu-item[data-action="edit"]');
  await expect(editItem).toBeVisible();
  await editItem.click();

  await expect(async () => {
    const logEntries = await testRepo.log();
    const wc = logEntries.find((e) => e.current_working_copy);
    expect(wc).toBeDefined();
    expect(wc!.description.trim()).toBe("B");
  }).toPass();

  const atNode = graphFrame.locator("#nodes > div").first();
  await expect(atNode).toBeVisible();
});
