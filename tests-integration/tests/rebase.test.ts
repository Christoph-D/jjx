import { test, expect } from "./baseTest";

test("rebase commit onto another via drag and drop", async ({ graphFrame, testRepo }) => {
  await testRepo.writeFile("a.txt", "content a");
  await testRepo.commit("A");
  await testRepo.writeFile("b.txt", "content b");
  await testRepo.commit("B");
  await testRepo.writeFile("c.txt", "content c");
  await testRepo.commit("C");

  const nodes = graphFrame.locator("#nodes > div");
  await expect(nodes).toHaveCount(5, { timeout: 10000 });

  const commitC = nodes.nth(1);
  const commitA = nodes.nth(3);

  await commitC.dragTo(commitA);

  const rebaseOntoItem = graphFrame.locator('.context-menu-item[data-action="rebaseOnto"]');
  await expect(rebaseOntoItem).toBeVisible({ timeout: 5000 });
  await rebaseOntoItem.click();

  await expect(nodes).toHaveCount(5, { timeout: 10000 });

  await expect(async () => {
    const logEntries = await testRepo.log();
    const commitCEntry = logEntries.find((e) => e.description.trim() === "C");
    expect(commitCEntry).toBeDefined();
    expect(commitCEntry!.parents).toHaveLength(1);

    const commitAParent = logEntries.find((e) => e.change_id === commitCEntry!.parents[0].change_id);
    expect(commitAParent).toBeDefined();
    expect(commitAParent!.description.trim()).toBe("A");
  }).toPass({ timeout: 10000 });
});
