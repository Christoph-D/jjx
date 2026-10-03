import { test, expect, newTestRepo, runCommand } from "./base-test";
import path from "path";

test("push to selected remote via flag picker", async ({ graphFrame, scmView, testRepo, workbox }) => {
  test.slow();
  const originPath = path.join(path.dirname(testRepo.repoPath), "push-origin");
  const originRepo = await newTestRepo(originPath);

  await testRepo.jjCommand(["git", "remote", "add", "origin", originPath]);

  await expect(graphFrame.locator("#nodes > div")).toHaveCount(2);

  const graphPaneHeader = scmView.locator(".pane-header", { hasText: "JJ Graph" }).first();

  const clickSubmenuItem = async (text: string) => {
    await expect(async () => {
      await graphPaneHeader.getByRole("button", { name: /Fetch & Push\.\.\./ }).click();
      const contextView = workbox.locator(".context-view");
      await expect(contextView).toBeVisible({ timeout: 3000 });
      const item = workbox
        .getByRole("menuitem", {
          name: new RegExp(`^${text.replace(/\./g, "\\.")}$`),
        })
        .first();
      await expect(item).toBeVisible({ timeout: 3000 });
      // We can't use click() because VS Code inserts a deliberate 100ms delay before
      // registering click handlers on the submenu items.
      // There is no change in the DOM to wait for, so we have to use the keyboard to bypass
      // the click handler. Retrying the full interaction handles the case where polling or
      // file watchers cause the context menu to re-render and detach menu items.
      await item.hover({ timeout: 3000 });
      await workbox.keyboard.press("Enter");
    }).toPass();
  };

  const selectQuickPickOption = async (label: string) => {
    const option = workbox.getByRole("option", { name: label, exact: true }).first();
    await expect(option).toBeVisible();
    await option.click();
  };

  const toggleQuickPickCheckbox = async (label: string) => {
    const option = workbox.locator(".quick-input-widget .monaco-list-row").filter({ hasText: label }).first();
    await expect(option).toBeVisible();
    await option.click();
  };

  const flagCheckbox = (flag: string) =>
    workbox.locator(`.quick-input-widget .monaco-custom-toggle[role="checkbox"][aria-label="${flag}"]`);

  const expectFlagsChecked = async (flags: string[]) => {
    for (const flag of ["--tracked", "--deleted", "--all"]) {
      await expect(flagCheckbox(flag)).toHaveAttribute("aria-checked", flags.includes(flag) ? "true" : "false");
    }
  };

  const openPushToSelectedRemote = async () => {
    if (process.platform === "darwin") {
      await runCommand(workbox, "Push to Selected Remote");
    } else {
      await clickSubmenuItem("Push to Selected Remote...");
    }
    await selectQuickPickOption("origin");
    // The flag picker opens with --tracked checked by default.
    await expect(
      workbox.locator(".quick-input-widget .monaco-list-row").filter({ hasText: "--tracked" }),
    ).toBeVisible();
    await expectFlagsChecked(["--tracked"]);
  };

  // === Part 1: Push a new bookmark with --all ===

  await testRepo.jjCommand(["bookmark", "create", "bookmark-push"]);
  const changeId1 = await testRepo.commitFile("push-all.txt", "content 1", "push commit 1");

  await openPushToSelectedRemote();

  // Checking --all automatically unchecks the conflicting --tracked flag.
  await toggleQuickPickCheckbox("--all");
  await expectFlagsChecked(["--all"]);

  // Checking --tracked back unchecks --all in turn.
  await toggleQuickPickCheckbox("--tracked");
  await expectFlagsChecked(["--tracked"]);

  await toggleQuickPickCheckbox("--all");
  await expectFlagsChecked(["--all"]);
  await workbox.keyboard.press("Enter");

  await expect(async () => {
    const showResult = await originRepo.jjCommand(["show", changeId1]);
    expect(showResult.exitCode).toBe(0);
  }).toPass();

  // === Part 2: Push the tracked bookmark with the default --tracked selection ===

  const changeId2 = await testRepo.commitFile("push-tracked.txt", "content 2", "push commit 2");
  await testRepo.jjCommand(["bookmark", "move", "bookmark-push", "--to", "@-"]);

  await openPushToSelectedRemote();
  // Accept the default selection (--tracked only).
  await workbox.keyboard.press("Enter");

  await expect(async () => {
    const showResult = await originRepo.jjCommand(["show", changeId2]);
    expect(showResult.exitCode).toBe(0);
  }).toPass();

  await expect(async () => {
    const bookmarkList = await originRepo.jjCommand(["bookmark", "list"]);
    expect(bookmarkList.stdout).toContain("push commit 2");
  }).toPass();
});
