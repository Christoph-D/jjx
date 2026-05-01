import { test, expect, newTestRepo } from "./baseTest";
import path from "path";

test("fetch from selected remote, default remote, and all remotes", async ({
  graphFrame,
  scmView,
  testRepo,
  workbox,
}) => {
  const originPath = path.join(testRepo.repoPath, "origin");
  const remoteBPath = path.join(testRepo.repoPath, "remote-b");
  const originRepo = await newTestRepo(originPath);
  const remoteBRepo = await newTestRepo(remoteBPath);

  await testRepo.jjCommand(["git", "remote", "add", "origin", "origin"]);
  await testRepo.jjCommand(["git", "remote", "add", "remote-b", "remote-b"]);

  await expect(graphFrame.locator("#nodes > div")).toHaveCount(2);

  const graphPaneHeader = scmView.locator(".pane-header", { hasText: "JJ Graph" }).first();

  const clickSubmenuItem = async (text: string) => {
    await graphPaneHeader.getByRole("button", { name: /Fetch\.\.\./ }).click();
    const contextView = workbox.locator(".context-view");
    await expect(contextView).toBeVisible();
    const item = workbox.getByRole("menuitem", { name: new RegExp(`^${text.replace(/\./g, "\\.")}$`) }).first();
    await item.hover();
    // We can't use click() because VS Code inserts a deliberate 100ms delay before
    // registering click handlers on the submenu items.
    // There is no change in the DOM to wait for, so we have to use the keyboard to bypass
    // the click handler.
    await workbox.keyboard.press("Enter");
  };

  const selectQuickPickOption = async (label: string) => {
    const option = workbox.getByRole("option", { name: label, exact: true }).first();
    await expect(option).toBeVisible();
    await option.click();
  };

  // === Part 1: Fetch from selected remote via submenu ===

  await originRepo.commitFile("origin.txt", "origin content", "origin commit 1");
  await originRepo.jjCommand(["bookmark", "create", "bookmark-origin-1"]);

  await remoteBRepo.commitFile("remote-b.txt", "remote-b content", "remote-b commit 1");
  await remoteBRepo.jjCommand(["bookmark", "create", "bookmark-remote-b-1"]);

  await clickSubmenuItem("Fetch from Selected Remote...");
  await selectQuickPickOption("origin");

  await expect(async () => {
    expect(await testRepo.hasRemoteBookmark("bookmark-origin-1", "origin")).toBe(true);
  }).toPass();
  expect(await testRepo.hasRemoteBookmark("bookmark-remote-b-1", "remote-b")).toBe(false);

  // === Part 2: Fetch From Default Remote via toolbar button ===

  await originRepo.commitFile("origin2.txt", "origin content 2", "origin commit 2");
  await originRepo.jjCommand(["bookmark", "create", "bookmark-origin-2"]);

  await graphPaneHeader.getByRole("button", { name: /Fetch from Default Remote/ }).click();

  await expect(async () => {
    expect(await testRepo.hasRemoteBookmark("bookmark-origin-2", "origin")).toBe(true);
  }).toPass();
  expect(await testRepo.hasRemoteBookmark("bookmark-remote-b-1", "remote-b")).toBe(false);

  // === Part 3: Fetch From All Remotes via submenu ===

  await originRepo.commitFile("origin3.txt", "origin content 3", "origin commit 3");
  await originRepo.jjCommand(["bookmark", "create", "bookmark-origin-3"]);

  await remoteBRepo.commitFile("remote-b2.txt", "remote-b content 2", "remote-b commit 2");
  await remoteBRepo.jjCommand(["bookmark", "create", "bookmark-remote-b-2"]);

  await clickSubmenuItem("Fetch from All Remotes");

  await expect(async () => {
    expect(await testRepo.hasRemoteBookmark("bookmark-origin-3", "origin")).toBe(true);
  }).toPass();
  await expect(async () => {
    expect(await testRepo.hasRemoteBookmark("bookmark-remote-b-2", "remote-b")).toBe(true);
  }).toPass();
});
