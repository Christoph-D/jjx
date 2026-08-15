import path from "path";
import fs from "fs";
import { test, expect, TestRepo, clickPillMenuItem } from "./base-test";

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

test("workspace pill context menu", async ({ graphFrame, testRepo, workbox, electronApp }) => {
  test.slow();
  await testRepo.commit("initial commit");

  const workspace2Path = path.join(testRepo.repoPath, "workspace2");
  const addWorkspace2 = async () => {
    // A forgotten workspace leaves its (now stale) .jj directory behind, and
    // `jj workspace add` requires an empty destination.
    fs.rmSync(workspace2Path, { recursive: true, force: true });
    const result = await testRepo.jjCommand(["workspace", "add", workspace2Path]);
    if (result.exitCode !== 0) {
      throw new Error(`Failed to add workspace2:\n\n${result.stdout}\n\n${result.stderr}`);
    }
  };
  await addWorkspace2();

  const defaultPill = graphFrame.locator('[data-workspace="default"]');
  const workspace2Pill = graphFrame.locator('[data-workspace="workspace2"]');
  await expect(defaultPill).toBeVisible();
  await expect(workspace2Pill).toBeVisible();

  await test.step("current workspace pill shows no workspace menu", async () => {
    await defaultPill.click({ button: "right" });
    await expect(graphFrame.locator("#pill-context-menu")).not.toBeVisible();
    // Close the regular change context menu that the right-click bubbles to.
    await graphFrame.locator("body").click({ position: { x: 1, y: 1 } });
    await expect(graphFrame.locator("#context-menu")).not.toBeVisible();
  });

  await test.step("menu offers forget actions and copy path separated by a divider", async () => {
    await workspace2Pill.click({ button: "right" });
    const menu = graphFrame.locator("#pill-context-menu");
    await expect(menu).toBeVisible();
    await expect(menu.locator("[data-action='forgetAndDeleteWorkspace']")).toHaveText(
      "Forget Workspace and Delete Directory",
    );
    await expect(menu.locator("[data-action='forgetWorkspace']")).toHaveText("Forget Workspace");
    await expect(menu.locator("[data-action='copyWorkspacePath']")).toHaveText("Copy Workspace Path");
    const actions = await menu
      .locator("[data-action]")
      .evaluateAll((els) => els.map((el) => el.getAttribute("data-action")));
    expect(actions).toEqual(["forgetAndDeleteWorkspace", "forgetWorkspace", "copyWorkspacePath"]);
    // The only non-item child is the divider between the forget actions and the copy action.
    await expect(menu.locator(":scope > *:not([data-action])")).toHaveCount(1);
    await graphFrame.locator("body").click({ position: { x: 1, y: 1 } });
    await expect(menu).not.toBeVisible();
  });

  await test.step("forget workspace forgets it but keeps the directory", async () => {
    await clickPillMenuItem(graphFrame, workspace2Pill, "Forget Workspace");

    const dialog = workbox.locator(".monaco-dialog-box");
    await expect(dialog).toBeVisible();
    await expect(dialog).toContainText('forget the workspace "workspace2"');
    await dialog.getByRole("button", { name: "Forget Workspace" }).click();
    await expect(dialog).not.toBeVisible();

    await expect(workspace2Pill).not.toBeVisible();
    expect(fs.existsSync(workspace2Path)).toBe(true);
    const workspaces = await testRepo.jjCommand(["workspace", "list"]);
    expect(workspaces.stdout).not.toContain("workspace2");
  });

  await test.step("forget and delete workspace removes the directory", async () => {
    await addWorkspace2();
    await expect(workspace2Pill).toBeVisible();

    await clickPillMenuItem(graphFrame, workspace2Pill, "Forget Workspace and Delete Directory");

    const dialog = workbox.locator(".monaco-dialog-box");
    await expect(dialog).toBeVisible();
    await expect(dialog).toContainText(
      `forget the workspace "workspace2" and delete its directory "${workspace2Path}"`,
    );
    await expect(dialog).toContainText("The directory will be deleted, but all jj-recorded changes will be kept.");
    // Cancelling keeps the workspace.
    await workbox.keyboard.press("Escape");
    await expect(dialog).not.toBeVisible();
    await expect(workspace2Pill).toBeVisible();

    await clickPillMenuItem(graphFrame, workspace2Pill, "Forget Workspace and Delete Directory");
    await expect(dialog).toBeVisible();
    await dialog.getByRole("button", { name: "Forget and Delete" }).click();
    await expect(dialog).not.toBeVisible();

    await expect(() => {
      expect(fs.existsSync(workspace2Path)).toBe(false);
    }).toPass();
    await expect(workspace2Pill).not.toBeVisible();
  });

  await test.step("forget and delete workspace falls back to forget when the root cannot be determined", async () => {
    await addWorkspace2();
    await expect(workspace2Pill).toBeVisible();
    // Remove the workspace directory behind jj's back: its recorded root
    // becomes stale, so jj can no longer report it.
    fs.rmSync(workspace2Path, { recursive: true, force: true });

    await clickPillMenuItem(graphFrame, workspace2Pill, "Forget Workspace and Delete Directory");

    const dialog = workbox.locator(".monaco-dialog-box");
    await expect(dialog).toBeVisible();
    await expect(dialog).toContainText('The root path of workspace "workspace2" could not be determined');
    await dialog.getByRole("button", { name: "Forget Workspace" }).click();
    await expect(dialog).not.toBeVisible();

    await expect(workspace2Pill).not.toBeVisible();
    const workspaces = await testRepo.jjCommand(["workspace", "list"]);
    expect(workspaces.stdout).not.toContain("workspace2");
  });

  await test.step("copy workspace path copies the root to the clipboard", async () => {
    await addWorkspace2();
    await expect(workspace2Pill).toBeVisible();

    await clickPillMenuItem(graphFrame, workspace2Pill, "Copy Workspace Path");

    await expect
      .poll(() =>
        electronApp.evaluate(({ clipboard }: { clipboard: { readText: () => string } }) => clipboard.readText()),
      )
      .toBe(workspace2Path);
  });
});
