import { test, expect, handleEditor } from "./base-test";

test("update change description via graph context menu", async ({ graphFrame, testRepo, workbox }) => {
  await testRepo.commitFile("a.txt", "content a", "Original A");
  await testRepo.commitFile("b.txt", "content b", "Original B");

  const nodes = graphFrame.locator("#nodes > div");
  await expect(nodes).toHaveCount(4);

  const commitB = nodes.nth(1);
  await commitB.click({ button: "right" });

  const describeItem = graphFrame.locator('[data-action="describe"]');
  await expect(describeItem).toBeVisible();
  await describeItem.click();

  await handleEditor(workbox, "", "Updated B");

  await expect(async () => {
    const logEntries = await testRepo.log();
    const commit = logEntries.find((e) => e.description.trim() === "Updated B");
    expect(commit).toBeDefined();
  }).toPass();
});
