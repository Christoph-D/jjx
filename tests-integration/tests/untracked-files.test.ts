import { test, expect, waitForSCMView } from "./base-test";
import * as fs from "fs";
import * as path from "path";

test("untracked files appear in the Untracked Files section and can be tracked or deleted", async ({
  graphFrame,
  testRepo,
  workbox,
}) => {
  await testRepo.commitFile("a.txt", "content", "base commit");

  // Create ~2MiB files that exceed jj's default maximum file size, so jj
  // reports them as untracked.
  await testRepo.writeFile("track.bin", "a".repeat(2 * 1024 * 1024));
  await testRepo.writeFile("delete.bin", "b".repeat(2 * 1024 * 1024));

  await expect(graphFrame.locator("#nodes > div").first()).toBeVisible();

  const scmView = await waitForSCMView(workbox, [], ["a.txt"]);

  const scmTree = workbox.getByRole("tree", { name: "Source Control Management" });
  // Returns the file names listed under a given SCM section header.
  const filesInSection = (sectionLabel: string) =>
    scmTree.evaluate((el, label) => {
      const items = Array.from(el.querySelectorAll("[role='treeitem']"));
      let inSection = false;
      const found: string[] = [];
      for (const item of items) {
        const level = item.getAttribute("aria-level");
        const ariaLabel = item.getAttribute("aria-label") ?? "";
        if (level === "1") {
          inSection = ariaLabel.includes(label);
        } else if (level === "2" && inSection) {
          const fileName = ariaLabel.split(",")[0].trim();
          if (fileName) {
            found.push(fileName);
          }
        }
      }
      return found;
    }, sectionLabel);

  // Both files show up in a dedicated "Untracked Files" section.
  const untrackedSection = scmView.getByRole("treeitem", { name: /Untracked Files/ });
  await expect(untrackedSection).toBeVisible();
  await expect(async () => {
    const files = await filesInSection("Untracked Files");
    expect(files).toEqual(expect.arrayContaining(["track.bin", "delete.bin"]));
  }).toPass();

  const trackFileItem = scmView.getByRole("treeitem", { name: /^track\.bin/ });
  await trackFileItem.hover();
  const trackButton = trackFileItem.getByRole("button", { name: "Track This File" });
  await expect(trackButton).toBeVisible();
  await trackButton.click();

  // Tracking removes the file from the Untracked Files section (the other file
  // stays), and the file is now tracked.
  await expect(async () => {
    const files = await filesInSection("Untracked Files");
    expect(files).not.toContain("track.bin");
    expect(files).toContain("delete.bin");
  }).toPass();
  await expect(async () => {
    const fileList = await testRepo.jjCommand(["file", "list"]);
    expect(fileList.stdout).toContain("track.bin");
  }).toPass();

  // Deleting a file removes it as well. Deleting an untracked file does not
  // create a jj operation, so the operation id is unchanged. Without an
  // explicit refresh the entry would stay stale.
  const deleteFileItem = scmView.getByRole("treeitem", { name: /^delete\.bin/ });
  await deleteFileItem.hover();
  const deleteButton = deleteFileItem.getByRole("button", { name: "Delete This File" });
  await expect(deleteButton).toBeVisible();
  await deleteButton.click();

  const dialog = workbox.locator(".monaco-dialog-box");
  await expect(dialog).toBeVisible();
  await dialog.getByRole("button", { name: "Delete" }).click();

  await expect(untrackedSection).toBeHidden();

  await expect(async () => {
    const fileList = await testRepo.jjCommand(["file", "list"]);
    expect(fileList.stdout).not.toContain("delete.bin");
    expect(fs.existsSync(path.join(testRepo.repoPath, "delete.bin"))).toBe(false);
  }).toPass();
});
