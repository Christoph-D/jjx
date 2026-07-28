import { test, expect, waitForSCMView } from "./baseTest";

test("untracked files appear in the Untracked Files section and can be tracked", async ({
  graphFrame,
  testRepo,
  workbox,
}) => {
  await testRepo.commitFile("a.txt", "content", "base commit");

  // Create a ~2MiB file that exceeds jj's default maximum file size, so jj
  // reports it as untracked.
  await testRepo.writeFile("big.bin", "a".repeat(2 * 1024 * 1024));

  await expect(graphFrame.locator("#nodes > div").first()).toBeVisible();

  const scmView = await waitForSCMView(workbox, [], ["a.txt"]);

  // The untracked file shows up in a dedicated "Untracked Files" section.
  const untrackedSection = scmView.getByRole("treeitem", { name: /Untracked Files/ });
  await expect(untrackedSection).toBeVisible();

  const bigFileItem = scmView.getByRole("treeitem", { name: /^big\.bin/ });
  await expect(bigFileItem).toBeVisible();
  await bigFileItem.hover();

  const trackButton = bigFileItem.getByRole("button", { name: "Track This File" });
  await expect(trackButton).toBeVisible();
  await trackButton.click();

  // After tracking, the file is no longer untracked, so the section disappears.
  await expect(untrackedSection).toBeHidden();

  // The file is now tracked.
  await expect(async () => {
    const fileList = await testRepo.jjCommand(["file", "list"]);
    expect(fileList.stdout).toContain("big.bin");
  }).toPass();
});
