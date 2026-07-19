import { test, expect, handleEditor } from "./baseTest";

test("squash commit into another via drag and drop", async ({ graphFrame, testRepo, workbox }) => {
  await testRepo.commitFile("a.txt", "content a", "A");
  await testRepo.commitFile("b.txt", "content b", "B");

  const nodes = graphFrame.locator("#nodes > div");
  await expect(nodes).toHaveCount(4);

  const commitB = nodes.nth(1);
  const commitA = nodes.nth(2);

  await commitB.dragTo(commitA);

  const squashIntoItem = graphFrame.locator('[data-action="squashInto"]');
  await expect(squashIntoItem).toBeVisible();
  await squashIntoItem.click();

  await handleEditor(workbox, "", "squashed");

  await expect(nodes).toHaveCount(3);

  await expect(async () => {
    const logEntries = await testRepo.log();
    const commitBEntry = logEntries.find((e) => e.description.trim() === "B");
    expect(commitBEntry).toBeUndefined();

    const squashedEntry = logEntries.find((e) => e.description.trim() === "squashed");
    expect(squashedEntry).toBeDefined();
  }).toPass();

  const diffResult = await testRepo.jjCommand(["diff", "--name-only", "-r", "@-"]);
  expect(diffResult.stdout).toBe("a.txt\nb.txt\n");
});
