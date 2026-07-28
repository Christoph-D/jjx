import { test, expect } from "./base-test";

test("showChangedFiles off by default hides changed-files UI", async ({ graphFrame, testRepo }) => {
  await testRepo.commitFile("a.txt", "content a", "commit A");
  await testRepo.commitFile("b.txt", "content b", "commit B");

  await expect(graphFrame.locator("#nodes > div").first()).toBeVisible();
  await expect(graphFrame.locator('[data-role="changed-file"]')).toHaveCount(0);
});

test.describe("with showChangedFiles enabled", () => {
  test.use({ customSettings: { "jjx.showChangedFiles": true } });

  test("showChangedFiles renders files and click opens diff", async ({ graphFrame, testRepo, workbox }) => {
    await testRepo.commitFile("a.txt", "content a", "commit A");
    await testRepo.commitFile("b.txt", "content b", "commit B");

    await expect(graphFrame.locator('[data-role="changed-file"][data-path="a.txt"]')).toBeVisible();
    await expect(graphFrame.locator('[data-role="changed-file"][data-path="b.txt"]')).toBeVisible();

    const aFile = graphFrame.locator('[data-role="changed-file"][data-path="a.txt"]');
    await aFile.click();

    const diffEditor = workbox.locator(".editor-instance");
    await expect(diffEditor).toBeVisible();
    // a.txt is Added in commit A: original is empty, modified contains the content.
    const original = workbox.locator(".editor.original .view-lines");
    const modified = workbox.locator(".editor.modified .view-lines");
    await expect(original).toHaveText(/^\s*$/);
    await expect(modified.getByText("content a", { exact: true }).first()).toBeVisible();
  });
});
