import { test, expect } from "./baseTest";

test("undo and redo a commit", async ({ graphFrame, testRepo, workbox }) => {
  await testRepo.commitFile("a.txt", "content a", "A");

  const nodes = graphFrame.locator("#nodes > div");
  await expect(nodes).toHaveCount(3);

  await workbox.keyboard.press("Control+Shift+P");
  await workbox.keyboard.type("Jujutsu: Undo");
  await workbox.keyboard.press("Enter");

  await expect(nodes).toHaveCount(2);

  await expect(async () => {
    const logEntries = await testRepo.log();
    const commitA = logEntries.find((e) => e.description.trim() === "A");
    expect(commitA).toBeUndefined();
  }).toPass();

  await workbox.keyboard.press("Control+Shift+P");
  await workbox.keyboard.type("Jujutsu: Redo");
  await workbox.keyboard.press("Enter");

  await expect(nodes).toHaveCount(3);

  await expect(async () => {
    const logEntries = await testRepo.log();
    const commitA = logEntries.find((e) => e.description.trim() === "A");
    expect(commitA).toBeDefined();
  }).toPass();
});
