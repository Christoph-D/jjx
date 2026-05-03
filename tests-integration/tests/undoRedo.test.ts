import { test, expect, runCommand } from "./baseTest";

test("undo and redo a commit", async ({ graphFrame, testRepo, workbox }) => {
  await testRepo.commitFile("a.txt", "content a", "A");

  const nodes = graphFrame.locator("#nodes > div");
  await expect(nodes).toHaveCount(3);

  await runCommand(workbox, "Jujutsu: Undo");

  await expect(nodes).toHaveCount(2);

  await expect(async () => {
    const logEntries = await testRepo.log();
    const commitA = logEntries.find((e) => e.description.trim() === "A");
    expect(commitA).toBeUndefined();
  }).toPass();

  await runCommand(workbox, "Jujutsu: Redo");

  await expect(nodes).toHaveCount(3);

  await expect(async () => {
    const logEntries = await testRepo.log();
    const commitA = logEntries.find((e) => e.description.trim() === "A");
    expect(commitA).toBeDefined();
  }).toPass();
});

test("undo and redo via operation log toolbar buttons", async ({ graphFrame, opLog, testRepo }) => {
  await testRepo.commitFile("a.txt", "content a", "A");

  const nodes = graphFrame.locator("#nodes > div");
  await expect(nodes).toHaveCount(3);

  const opLogPaneHeader = opLog.locator(".pane-header");
  const undoButton = opLogPaneHeader.getByRole("button", { name: "Undo" });
  await undoButton.click();

  await expect(nodes).toHaveCount(2);

  await expect(async () => {
    const logEntries = await testRepo.log();
    const commitA = logEntries.find((e) => e.description.trim() === "A");
    expect(commitA).toBeUndefined();
  }).toPass();

  const redoButton = opLogPaneHeader.getByRole("button", { name: "Redo" });
  await redoButton.click();

  await expect(nodes).toHaveCount(3);

  await expect(async () => {
    const logEntries = await testRepo.log();
    const commitA = logEntries.find((e) => e.description.trim() === "A");
    expect(commitA).toBeDefined();
  }).toPass();
});
