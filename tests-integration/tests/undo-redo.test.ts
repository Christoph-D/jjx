import { test, expect, runCommand } from "./base-test";

test("undo and redo a commit via command palette and operation log toolbar", async ({
  graphFrame,
  opLog,
  testRepo,
  workbox,
}) => {
  await testRepo.commitFile("a.txt", "content a", "A");

  const nodes = graphFrame.locator("#nodes > div");
  await expect(nodes).toHaveCount(3);

  await test.step("undo and redo via command palette", async () => {
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

  await test.step("undo and redo via operation log toolbar buttons", async () => {
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
});
