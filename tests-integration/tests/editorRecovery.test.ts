import { test, expect } from "./baseTest";

test("recover editor content when describe command fails after change is abandoned", async ({
  graphFrame,
  testRepo,
  workbox,
}) => {
  const changeId = await testRepo.commitFile("a.txt", "content a", "Original commit");

  const nodes = graphFrame.locator("#nodes > div");
  await expect(nodes).toHaveCount(3);

  const commitNode = nodes.nth(1);
  await commitNode.click({ button: "right" });
  const describeItem = graphFrame.locator('.context-menu-item[data-action="describe"]');
  await expect(describeItem).toBeVisible();
  await describeItem.click();

  const editor = workbox.locator('.monaco-editor[role="code"][data-uri*=".jj"]');
  await expect(editor).toBeVisible();
  await editor.click();

  // Abandon the commit while the editor is open
  await testRepo.jjCommand(["abandon", "-r", changeId]);

  await workbox.keyboard.press("Control+a");
  await workbox.keyboard.type("Recovered description content");
  await workbox.keyboard.press("Control+s");
  await expect(workbox.locator(".tab.active")).not.toHaveClass(/dirty/);

  await workbox.keyboard.press("Control+w");
  await expect(editor).toBeHidden();

  const recoveredEditor = workbox.locator('.monaco-editor[role="code"][data-uri*="untitled"]');
  await expect(recoveredEditor).toBeVisible();

  await expect(recoveredEditor.getByText("Recovered description content")).toBeVisible();
});
