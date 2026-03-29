import { test, expect } from "./baseTest";

test("move single file changes from working copy to parent", async ({ graphFrame, testRepo, workbox }) => {
  await testRepo.commitFile("a.txt", "original", "A");

  await testRepo.writeFile("a.txt", "modified");
  await testRepo.writeFile("b.txt", "new file");

  await expect(graphFrame.locator("#nodes > div")).toHaveCount(3);

  const scmView = workbox.locator(".scm-view").first();
  await scmView.waitFor();

  const scmTree = workbox.getByRole("tree", { name: "Source Control Management" });

  const aFileItems = scmTree.getByRole("treeitem", { name: /^a\.txt/ });
  await expect(aFileItems).toHaveCount(2);
  const aFileItem = aFileItems.first();
  await expect(aFileItem).toBeVisible();
  await aFileItem.hover();

  const moveButton = aFileItem.getByRole("button", { name: "Move Changes to Parent" });
  await expect(moveButton).toBeVisible();
  await moveButton.click();

  await expect(async () => {
    const diffResult = await testRepo.jjCommand(["diff", "--name-only"]);
    expect(diffResult.stdout.trim()).toBe("b.txt");
  }).toPass();

  await expect(async () => {
    const diffResult = await testRepo.jjCommand(["diff", "--name-only", "-r", "@-"]);
    expect(diffResult.stdout.trim()).toBe("a.txt");
  }).toPass();
});

test("move last single file changes from working copy to parent with squash message editor", async ({
  graphFrame,
  testRepo,
  workbox,
}) => {
  await testRepo.commitFile("a.txt", "original", "A");

  await testRepo.writeFile("a.txt", "modified");
  await testRepo.jjCommand(["describe", "-m", "B"]);

  await expect(graphFrame.locator("#nodes > div")).toHaveCount(3);

  const scmView = workbox.locator(".scm-view").first();
  await scmView.waitFor();

  const scmTree = workbox.getByRole("tree", { name: "Source Control Management" });

  const aFileItems = scmTree.getByRole("treeitem", { name: /^a\.txt/ });
  await expect(aFileItems).toHaveCount(2);
  const aFileItem = aFileItems.first();
  await expect(aFileItem).toBeVisible();
  await aFileItem.hover();

  const moveButton = aFileItem.getByRole("button", { name: "Move Changes to Parent" });
  await expect(moveButton).toBeVisible();
  await moveButton.click();

  const editor = workbox.locator('.monaco-editor[role="code"][data-uri^="file://"]');
  await expect(editor).toBeVisible();
  await editor.click();
  await workbox.keyboard.press("Control+a");
  await workbox.keyboard.type("moved");
  await workbox.keyboard.press("Control+s");
  await expect(workbox.locator(".tab.active")).not.toHaveClass(/dirty/);
  await workbox.keyboard.press("Control+w");
  await expect(editor).toBeHidden();

  await expect(async () => {
    const diffResult = await testRepo.jjCommand(["diff", "--name-only"]);
    expect(diffResult.stdout.trim()).toBe("");
  }).toPass();

  await expect(async () => {
    const diffResult = await testRepo.jjCommand(["diff", "--name-only", "-r", "@-"]);
    expect(diffResult.stdout.trim()).toBe("a.txt");
  }).toPass();
});

test("move single file changes from parent to working copy", async ({ graphFrame, testRepo, workbox }) => {
  await testRepo.writeFile("a.txt", "content a");
  await testRepo.commitFile("b.txt", "content b", "A");

  await expect(graphFrame.locator("#nodes > div")).toHaveCount(3);

  const scmView = workbox.locator(".scm-view").first();
  await scmView.waitFor();

  const scmTree = workbox.getByRole("tree", { name: "Source Control Management" });

  const aFileItem = scmTree.getByRole("treeitem", { name: /^a\.txt/ });
  await expect(aFileItem).toBeVisible();
  await aFileItem.hover();

  const moveButton = aFileItem.getByRole("button", { name: "Move Changes to Working Copy" });
  await expect(moveButton).toBeVisible();
  await moveButton.click();

  await expect(async () => {
    const diffResult = await testRepo.jjCommand(["diff", "--name-only"]);
    expect(diffResult.stdout.trim()).toBe("a.txt");
  }).toPass();

  await expect(async () => {
    const diffResult = await testRepo.jjCommand(["diff", "--name-only", "-r", "@-"]);
    expect(diffResult.stdout.trim()).toBe("b.txt");
  }).toPass();
});

test("move all working copy changes to parent", async ({ graphFrame, testRepo, workbox }) => {
  await testRepo.commitFile("a.txt", "original", "A");

  await testRepo.writeFile("a.txt", "modified");
  await testRepo.writeFile("b.txt", "new file");

  await expect(graphFrame.locator("#nodes > div")).toHaveCount(3);

  const scmView = workbox.locator(".scm-view").first();
  await scmView.waitFor();

  const scmTree = workbox.getByRole("tree", { name: "Source Control Management" });
  const bFileItem = scmTree.getByRole("treeitem", { name: /^b\.txt/ });
  await expect(bFileItem).toBeVisible();

  const workingCopyItem = scmTree.getByRole("treeitem", { name: "Working Copy" });
  await expect(workingCopyItem).toBeVisible();
  await workingCopyItem.hover();

  const moveButton = workingCopyItem.getByRole("button", { name: "Move Changes to Parent" });
  await expect(moveButton).toBeVisible();
  await moveButton.click();

  await expect(async () => {
    const diffResult = await testRepo.jjCommand(["diff", "--name-only"]);
    expect(diffResult.stdout.trim()).toBe("");
  }).toPass();

  await expect(async () => {
    const diffResult = await testRepo.jjCommand(["diff", "--name-only", "-r", "@-"]);
    expect(diffResult.stdout).toBe("a.txt\nb.txt\n");
  }).toPass();
});

test("move all parent changes to working copy", async ({ graphFrame, testRepo, workbox }) => {
  await testRepo.writeFile("a.txt", "content a");
  await testRepo.commitFile("b.txt", "content b", "A");

  await expect(graphFrame.locator("#nodes > div")).toHaveCount(3);

  const scmView = workbox.locator(".scm-view").first();
  await scmView.waitFor();

  const scmTree = workbox.getByRole("tree", { name: "Source Control Management" });
  const parentItem = scmTree.getByRole("treeitem", { name: /Parent Commit/ });
  await expect(parentItem).toBeVisible();
  await parentItem.hover();

  const moveButton = parentItem.getByRole("button", { name: "Move Changes to Working Copy" });
  await expect(moveButton).toBeVisible();
  await moveButton.click();

  await expect(async () => {
    const diffResult = await testRepo.jjCommand(["diff", "--name-only"]);
    expect(diffResult.stdout.trim()).toBe("a.txt\nb.txt");
  }).toPass();

  await expect(async () => {
    const diffResult = await testRepo.jjCommand(["diff", "--name-only", "-r", "@-"]);
    expect(diffResult.stdout.trim()).toBe("");
  }).toPass();
});
