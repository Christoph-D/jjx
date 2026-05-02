import { test, expect } from "./baseTest";

test("navigate between parent and child changes via editor title bar buttons", async ({
  graphFrame,
  testRepo,
  workbox,
}) => {
  await testRepo.commitFile("test.txt", "A", "commit A");
  await testRepo.commitFile("test.txt", "B", "commit B");

  await testRepo.writeFile("test.txt", "C");

  await expect(graphFrame.locator("#nodes > div").first()).toBeVisible();

  await workbox.keyboard.press("Control+P");
  const quickOpen = workbox.locator(".quick-input-widget");
  await expect(quickOpen).toBeVisible();
  await workbox.keyboard.type("test.txt");
  await expect(quickOpen.locator(".monaco-list-row").first()).toBeVisible();
  await workbox.keyboard.press("Enter");

  const viewLines = workbox.locator(".monaco-editor .view-lines");

  const expectEditorContent = async (expected: string) => {
    await expect(viewLines.getByText(expected, { exact: true }).first()).toBeVisible();
  };

  await expectEditorContent("C");

  const parentButton = workbox.getByRole("button", { name: "Open Parent Change" });
  await expect(parentButton).toBeVisible();
  await parentButton.click();
  await expectEditorContent("B");

  await parentButton.click();
  await expectEditorContent("A");

  const childButton = workbox.getByRole("button", { name: "Open Child Change" });
  await expect(childButton).toBeVisible();
  await childButton.click();
  await expectEditorContent("B");

  await childButton.click();
  await expectEditorContent("C");
});
