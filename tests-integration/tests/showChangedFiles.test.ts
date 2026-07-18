import { test, expect } from "./baseTest";

test("showChangedFiles off by default hides changed-files UI", async ({ graphFrame, testRepo }) => {
  await testRepo.commitFile("a.txt", "content a", "commit A");
  await testRepo.commitFile("b.txt", "content b", "commit B");

  await expect(graphFrame.locator("#nodes > div").first()).toBeVisible();
  await expect(graphFrame.locator(".changed-files")).toHaveCount(0);
  await expect(graphFrame.locator(".changed-file")).toHaveCount(0);
});

test.use({ customSettings: { "jjx.showChangedFiles": true } });

test("showChangedFiles renders files and click opens diff", async ({ graphFrame, testRepo, workbox }) => {
  await testRepo.commitFile("a.txt", "content a", "commit A");
  await testRepo.commitFile("b.txt", "content b", "commit B");

  await expect(graphFrame.locator(".changed-file-path", { hasText: "a.txt" })).toBeVisible();
  await expect(graphFrame.locator(".changed-file-path", { hasText: "b.txt" })).toBeVisible();

  const aFile = graphFrame.locator(".changed-file", { hasText: "a.txt" }).first();
  await aFile.click();

  const diffEditor = workbox.locator(".editor-instance");
  await expect(diffEditor).toBeVisible();
  // a.txt is Added in commit A: original is empty, modified contains the content.
  const original = workbox.locator(".editor.original .view-lines");
  const modified = workbox.locator(".editor.modified .view-lines");
  await expect(original).toHaveText(/^\s*$/);
  await expect(modified.getByText("content a", { exact: true }).first()).toBeVisible();
});
