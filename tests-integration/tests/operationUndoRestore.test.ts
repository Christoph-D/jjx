import { test, expect } from "./baseTest";

test("undo a specific operation from operation log tree view", async ({ graphFrame, testRepo, workbox }) => {
  await testRepo.commitFile("a.txt", "content a", "A");
  await testRepo.commitFile("b.txt", "content b", "B");

  const nodes = graphFrame.locator("#nodes > div");
  await expect(nodes).toHaveCount(4);

  const opLogHeader = workbox.getByRole("button", { name: /Operation Log/ });
  const isExpanded = await opLogHeader.getAttribute("aria-expanded");
  if (isExpanded === "false") {
    await opLogHeader.click();
  }

  const opLogPane = workbox
    .locator(".pane")
    .filter({ has: workbox.locator(".pane-header", { hasText: "Operation Log" }) });
  const paneBody = opLogPane.locator(".pane-body");
  const treeItems = paneBody.locator('[role="treeitem"]');
  await expect(treeItems.first()).toBeVisible();

  const firstItem = treeItems.first();
  await firstItem.hover();
  const undoBtn = firstItem.getByRole("button", { name: "Undo Operation" });
  await undoBtn.click({ force: true });

  await expect(nodes).toHaveCount(3);

  await expect(async () => {
    const logEntries = await testRepo.log();
    expect(logEntries.find((e) => e.description.trim() === "B")).toBeUndefined();
    expect(logEntries.find((e) => e.description.trim() === "A")).toBeDefined();
  }).toPass();
});

test("restore repo to a specific operation from operation log tree view", async ({ graphFrame, testRepo, workbox }) => {
  await testRepo.commitFile("a.txt", "content a", "A");
  await testRepo.commitFile("b.txt", "content b", "B");

  const nodes = graphFrame.locator("#nodes > div");
  await expect(nodes).toHaveCount(4);

  const opsResult = await testRepo.jjCommand([
    "operation",
    "log",
    "--limit",
    "10",
    "--no-graph",
    "-T",
    'tags ++ "\\n"',
  ]);
  const opTags = opsResult.stdout.trim().split("\n").filter(Boolean);

  let commitCount = 0;
  let commitAIndex = -1;
  for (let i = 0; i < opTags.length; i++) {
    if (opTags[i].includes("commit")) {
      commitCount++;
      if (commitCount === 2) {
        commitAIndex = i;
        break;
      }
    }
  }
  if (commitAIndex === -1) {
    commitAIndex = opTags.length - 2;
  }

  const opLogHeader = workbox.getByRole("button", { name: /Operation Log/ });
  const isExpanded = await opLogHeader.getAttribute("aria-expanded");
  if (isExpanded === "false") {
    await opLogHeader.click();
  }

  const opLogPane = workbox
    .locator(".pane")
    .filter({ has: workbox.locator(".pane-header", { hasText: "Operation Log" }) });
  const paneBody = opLogPane.locator(".pane-body");
  const treeItems = paneBody.locator('[role="treeitem"]');
  await expect(treeItems.first()).toBeVisible();

  const targetItem = treeItems.nth(commitAIndex);
  await targetItem.hover();
  const restoreBtn = targetItem.getByRole("button", { name: "Restore Repo to the State at This Operation" });
  await restoreBtn.click({ force: true });

  await expect(async () => {
    const logEntries = await testRepo.log();
    expect(logEntries.find((e) => e.description.trim() === "B")).toBeUndefined();
    expect(logEntries.find((e) => e.description.trim() === "A")).toBeDefined();
  }).toPass();
});
