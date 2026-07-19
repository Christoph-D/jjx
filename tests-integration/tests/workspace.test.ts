import path from "path";
import { test, expect, TestRepo } from "./baseTest";

test.describe("auto-update disabled", () => {
  test.use({ customSettings: { "jjx.autoUpdateStaleWorkspace": false } });

  test("workspace pills and stale workspace status appear in the graph view", async ({ graphFrame, testRepo }) => {
    await testRepo.commit("initial commit");

    const workspace2Path = path.join(testRepo.repoPath, "workspace2");
    await testRepo.jjCommand(["workspace", "add", workspace2Path]);

    const workspacePills = graphFrame.locator("[data-workspace]");
    await expect(workspacePills).toHaveCount(2);
    await expect(workspacePills).toHaveText(["default", "workspace2"]);

    const workspace2 = new TestRepo(workspace2Path);
    await workspace2.writeFile("new-file.txt", "hello from workspace2");
    const result = await workspace2.jjCommand(["squash"]);
    if (result.exitCode !== 0) {
      throw new Error(`Failed to squash in workspace2:\n\n${result.stdout}\n\n${result.stderr}`);
    }

    const staleMessage = graphFrame.locator('#stale-state [data-role="message"]');
    await expect(staleMessage).toHaveText("Working Copy Is Stale");

    const updateButton = graphFrame.locator("#update-stale-button");
    await updateButton.click();
    await expect(workspacePills).toHaveText(["default", "workspace2"]);
  });
});

test("stale workspace auto-updates if enabled", async ({ graphFrame, testRepo }) => {
  await testRepo.commit("initial commit");

  const workspace2Path = path.join(testRepo.repoPath, "workspace2");
  await testRepo.jjCommand(["workspace", "add", workspace2Path]);

  const nodes = graphFrame.locator("#nodes > div");
  await expect(nodes).toHaveCount(4);

  const workspace2 = new TestRepo(workspace2Path);
  await workspace2.writeFile("new-file.txt", "hello from workspace2");
  const result = await workspace2.jjCommand(["squash"]);
  if (result.exitCode !== 0) {
    throw new Error(`Failed to squash in workspace2:\n\n${result.stdout}\n\n${result.stderr}`);
  }

  // No "stale workspace" message should appear in the graph view.
  await expect(nodes).toHaveCount(4);
});
