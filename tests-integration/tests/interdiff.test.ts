import { test, expect, waitForSCMView } from "./base-test";

async function getComparisonSection(
  workbox: import("@playwright/test").Page,
  prefix: string,
): Promise<{ exists: boolean; files: string[]; labels: string[] }> {
  const scmTree = workbox.getByRole("tree", { name: "Source Control Management" });
  return scmTree.evaluate((el, prefix) => {
    const items = Array.from(el.querySelectorAll("[role='treeitem']"));
    let exists = false;
    let inSection = false;
    const files: string[] = [];
    const labels: string[] = [];
    for (const item of items) {
      const level = item.getAttribute("aria-level");
      const label = item.getAttribute("aria-label") ?? "";
      if (level === "1") {
        if (label.startsWith(prefix)) {
          exists = true;
          inSection = true;
        } else {
          inSection = false;
        }
      } else if (level === "2" && inSection) {
        labels.push(label);
        const fileName = label.split(",")[0].trim();
        if (fileName) {
          files.push(fileName);
        }
      }
    }
    return { exists, files, labels };
  }, prefix);
}

async function sectionHasBadge(workbox: import("@playwright/test").Page, prefix: string): Promise<boolean> {
  return workbox.getByRole("tree", { name: "Source Control Management" }).evaluate((el, prefix) => {
    const items = Array.from(el.querySelectorAll("[role='treeitem']"));
    let inSection = false;
    for (const item of items) {
      if (item.getAttribute("aria-level") === "1") {
        inSection = (item.getAttribute("aria-label") ?? "").startsWith(prefix);
      } else if (inSection && item.getAttribute("aria-level") === "2") {
        if (item.querySelector('[class*="decoration-itemBadge"], [class*="decoration-iconBadge"]')) {
          return true;
        }
      }
    }
    return false;
  }, prefix);
}

// Sets up two sibling changes A and B (both children of root), each adding a.txt with
// different content. Both the from/to diff and the interdiff between them list a.txt as
// modified, with B's content on the left and A's on the right.
async function setupSiblings(testRepo: import("../test-repo").TestRepo) {
  await testRepo.commitFile("a.txt", "content a", "A");
  await testRepo.jjCommand(["new", "root()"]);
  await testRepo.writeFile("a.txt", "content b");
  await testRepo.commit("B");
}

test("two selected changes show a from/to diff section by default", async ({ graphFrame, testRepo, workbox }) => {
  await setupSiblings(testRepo);

  const nodes = graphFrame.locator("#nodes > div");
  await expect(nodes).toHaveCount(4); // @, B, A, root

  // Working copy is empty; the parent of @ is B (which added a.txt).
  await waitForSCMView(workbox, [], ["a.txt"]);

  // No diff section before selecting two changes.
  expect((await getComparisonSection(workbox, "Diff")).exists).toBe(false);
  expect((await getComparisonSection(workbox, "Interdiff")).exists).toBe(false);

  // Select B (nth 1) then Shift+click A (nth 2) to build a two-change selection.
  await nodes.nth(1).click();
  await nodes.nth(2).click({ modifiers: ["Shift"] });

  // The Diff section appears by default (a from/to diff, not an interdiff) and lists a.txt.
  await expect(async () => {
    expect((await getComparisonSection(workbox, "Diff")).exists).toBe(true);
    expect((await getComparisonSection(workbox, "Interdiff")).exists).toBe(false);
    expect((await getComparisonSection(workbox, "Diff")).files).toEqual(expect.arrayContaining(["a.txt"]));
  }).toPass();

  // Each diff file shows its status letter (M/A/D/...) as a decoration badge.
  await expect(async () => {
    expect(await sectionHasBadge(workbox, "Diff")).toBe(true);
  }).toPass();

  // Clicking the diff a.txt opens a diff editor. Selection order is [B, A], so the diff is
  // from B to A: left shows B's content, right shows A's content.
  const aFileItems = workbox
    .locator(".scm-view")
    .first()
    .getByRole("treeitem", { name: /^a\.txt/ });
  await expect(aFileItems).toHaveCount(2);
  await aFileItems.last().click();

  const diffEditor = workbox.locator(".editor-instance");
  await expect(diffEditor).toBeVisible();
  const original = diffEditor.locator(".editor.original .view-lines");
  const modified = diffEditor.locator(".editor.modified .view-lines");
  await expect(original.getByText("content b", { exact: true }).first()).toBeVisible();
  await expect(modified.getByText("content a", { exact: true }).first()).toBeVisible();

  // Selecting a single change again hides the Diff section.
  await nodes.nth(1).click();
  await expect(async () => {
    expect((await getComparisonSection(workbox, "Diff")).exists).toBe(false);
  }).toPass();
});

test("quick actions toggle between diff and interdiff", async ({ graphFrame, testRepo, workbox }) => {
  await setupSiblings(testRepo);

  const nodes = graphFrame.locator("#nodes > div");
  await expect(nodes).toHaveCount(4);
  await waitForSCMView(workbox, [], ["a.txt"]);

  await nodes.nth(1).click();
  await nodes.nth(2).click({ modifiers: ["Shift"] });

  await expect(async () => {
    expect((await getComparisonSection(workbox, "Diff")).exists).toBe(true);
  }).toPass();

  const scmView = workbox.locator(".scm-view").first();

  // The Diff section header only offers a "View Interdiff" quick action; the change-level
  // actions (discard, edit, describe, squash) don't apply to a two-revision comparison.
  const diffSection = scmView.getByRole("treeitem", { name: /^Diff / });
  await diffSection.hover();
  const viewInterdiff = diffSection.getByRole("button", { name: "View Interdiff" });
  await expect(viewInterdiff).toBeVisible();
  await expect(diffSection.getByRole("button", { name: "Discard Changes" })).toHaveCount(0);
  await expect(diffSection.getByRole("button", { name: "Edit This Change" })).toHaveCount(0);
  await viewInterdiff.click();

  // It is replaced by an Interdiff section.
  await expect(async () => {
    expect((await getComparisonSection(workbox, "Interdiff")).exists).toBe(true);
    expect((await getComparisonSection(workbox, "Diff")).exists).toBe(false);
  }).toPass();

  // The Interdiff section offers a "View Regular Diff" quick action that switches back.
  const interdiffSection = scmView.getByRole("treeitem", { name: /^Interdiff / });
  await interdiffSection.hover();
  const viewRegularDiff = interdiffSection.getByRole("button", { name: "View Regular Diff" });
  await expect(viewRegularDiff).toBeVisible();
  await viewRegularDiff.click();

  await expect(async () => {
    expect((await getComparisonSection(workbox, "Diff")).exists).toBe(true);
    expect((await getComparisonSection(workbox, "Interdiff")).exists).toBe(false);
  }).toPass();
});

test("interdiff toggle survives a commit but reverts on selection change", async ({
  graphFrame,
  testRepo,
  workbox,
}) => {
  await setupSiblings(testRepo);

  const nodes = graphFrame.locator("#nodes > div");
  await expect(nodes).toHaveCount(4);
  await waitForSCMView(workbox, [], ["a.txt"]);

  await nodes.nth(1).click();
  await nodes.nth(2).click({ modifiers: ["Shift"] });

  await expect(async () => {
    expect((await getComparisonSection(workbox, "Diff")).exists).toBe(true);
  }).toPass();

  const scmView = workbox.locator(".scm-view").first();

  // Switch to interdiff.
  const diffSection = scmView.getByRole("treeitem", { name: /^Diff / });
  await diffSection.hover();
  await diffSection.getByRole("button", { name: "View Interdiff" }).click();
  await expect(async () => {
    expect((await getComparisonSection(workbox, "Interdiff")).exists).toBe(true);
  }).toPass();

  // A commit in the working copy (unrelated to the two selected changes) must not revert the
  // interdiff toggle.
  await testRepo.writeFile("other.txt", "unrelated");
  await testRepo.commit("unrelated change");

  await expect(async () => {
    expect((await getComparisonSection(workbox, "Interdiff")).exists).toBe(true);
  }).toPass();

  // Changing the graph selection reverts to the default from/to diff.
  await nodes.nth(1).click();
  await nodes.nth(2).click({ modifiers: ["Shift"] });

  await expect(async () => {
    expect((await getComparisonSection(workbox, "Diff")).exists).toBe(true);
    expect((await getComparisonSection(workbox, "Interdiff")).exists).toBe(false);
  }).toPass();
});
