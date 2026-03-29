import { test, expect } from "./baseTest";

test("update change description via graph context menu", async ({ graphFrame, testRepo, workbox }) => {
  await testRepo.commitFile("a.txt", "content a", "Original A");
  await testRepo.commitFile("b.txt", "content b", "Original B");

  const nodes = graphFrame.locator("#nodes > div");
  await expect(nodes).toHaveCount(4);

  const commitB = nodes.nth(1);
  await commitB.click({ button: "right" });

  const describeItem = graphFrame.locator('.context-menu-item[data-action="describe"]');
  await expect(describeItem).toBeVisible();
  await describeItem.click();

  const editor = workbox.locator('.monaco-editor[role="code"][data-uri*=".jjdescription"]');
  await expect(editor).toBeVisible();
  await editor.click();
  await workbox.keyboard.press("Control+a");
  await workbox.keyboard.type("Updated B");
  await workbox.keyboard.press("Control+s");
  await expect(workbox.locator(".tab.active")).not.toHaveClass(/dirty/);
  await workbox.keyboard.press("Control+w");
  await expect(editor).toBeHidden();

  await expect(async () => {
    const logEntries = await testRepo.log();
    const commit = logEntries.find((e) => e.description.trim() === "Updated B");
    expect(commit).toBeDefined();
  }).toPass();
});
