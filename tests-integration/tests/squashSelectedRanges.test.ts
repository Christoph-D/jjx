import { test, expect, mod, cursorTop } from "./baseTest";

test("squash selected line ranges into parent change", async ({ graphFrame, testRepo, workbox }) => {
  await testRepo.commitFile("a.txt", "line1\nline2\nline3\n", "A");
  await testRepo.writeFile("a.txt", "line1\nMODIFIED\nline3\nADDED\n");

  await expect(graphFrame.locator("#nodes > div")).toHaveCount(3);
  await expect(graphFrame.locator("#nodes > div").first()).not.toHaveText(/\(empty\)/);

  // Open a.txt in a regular editor via Quick Open
  await workbox.keyboard.press(`${mod}+p`);
  const quickOpen = workbox.locator(".quick-input-widget");
  await expect(quickOpen).toBeVisible();
  await workbox.keyboard.type("a.txt");
  const quickOpenResult = quickOpen.locator(".monaco-list-row").first();
  await expect(quickOpenResult).toBeVisible();
  await quickOpenResult.click();

  const editor = workbox.locator('.monaco-editor[role="code"][data-uri^="file://"]');
  await expect(editor).toBeVisible();
  await editor.click();

  // Navigate to line 4 ("ADDED") and select it
  await workbox.keyboard.press(cursorTop);
  await workbox.keyboard.press("ArrowDown");
  await workbox.keyboard.press("ArrowDown");
  await workbox.keyboard.press("ArrowDown");
  await workbox.keyboard.press("Home");
  await workbox.keyboard.press("Shift+End");

  // Trigger "Squash Selected Changes..." via command palette
  await workbox.keyboard.press(`${mod}+Shift+P`);
  const quickInput = workbox.locator(".quick-input-widget input").first();
  await expect(quickInput).toBeVisible();
  await quickInput.fill(">Squash Selected Changes");
  const quickPick = workbox.locator(".quick-input-widget");
  await expect(quickPick).toBeVisible();
  const squashItem = quickPick
    .locator(".monaco-list-row")
    .filter({ hasText: /Jujutsu: Squash Selected Changes/ })
    .first();
  await expect(squashItem).toBeVisible();
  await squashItem.click();

  // Select parent from the destination quick pick
  await expect(quickPick).toBeVisible();
  const parentItem = quickPick
    .locator(".monaco-list-row")
    .filter({ hasText: /Parent/ })
    .first();
  await expect(parentItem).toBeVisible();
  await parentItem.click();

  // Verify: only the ADDED line was squashed, MODIFIED change remains in working copy
  await expect(async () => {
    const content = await testRepo.readFile("a.txt");
    expect(content).toBe("line1\nMODIFIED\nline3\nADDED\n");
  }).toPass();

  await expect(async () => {
    const diffResult = await testRepo.jjCommand(["diff", "--git"]);
    expect(diffResult.stdout).toContain("-line2");
    expect(diffResult.stdout).toContain("+MODIFIED");
    expect(diffResult.stdout).not.toContain("+ADDED");
  }).toPass();

  await expect(async () => {
    const diffResult = await testRepo.jjCommand(["diff", "--name-only", "-r", "@-"]);
    expect(diffResult.stdout.trim()).toBe("a.txt");
  }).toPass();
});
