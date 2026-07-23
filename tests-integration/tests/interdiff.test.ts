import { test, expect, waitForSCMView } from "./baseTest";

async function getInterdiffSection(
  workbox: import("@playwright/test").Page,
): Promise<{ exists: boolean; files: string[] }> {
  const scmTree = workbox.getByRole("tree", { name: "Source Control Management" });
  return scmTree.evaluate((el) => {
    const items = Array.from(el.querySelectorAll("[role='treeitem']"));
    let exists = false;
    let inSection = false;
    const files: string[] = [];
    for (const item of items) {
      const level = item.getAttribute("aria-level");
      const label = item.getAttribute("aria-label") ?? "";
      if (level === "1") {
        if (label.startsWith("Interdiff")) {
          exists = true;
          inSection = true;
        } else {
          inSection = false;
        }
      } else if (level === "2" && inSection) {
        const fileName = label.split(",")[0].trim();
        if (fileName) {
          files.push(fileName);
        }
      }
    }
    return { exists, files };
  });
}

test("interdiff section shows for two selected changes, opens diff, hides otherwise", async ({
  graphFrame,
  testRepo,
  workbox,
}) => {
  // Two sibling changes A and B (both children of root), each adding a.txt with
  // different content, so their interdiff lists a.txt as modified.
  await testRepo.commitFile("a.txt", "content a", "A");
  await testRepo.jjCommand(["new", "root()"]);
  await testRepo.writeFile("a.txt", "content b");
  await testRepo.commit("B");

  const nodes = graphFrame.locator("#nodes > div");
  await expect(nodes).toHaveCount(4); // @, B, A, root

  // Working copy is empty; the parent of @ is B (which added a.txt).
  await waitForSCMView(workbox, [], ["a.txt"]);

  // No interdiff section before selecting two changes.
  expect((await getInterdiffSection(workbox)).exists).toBe(false);

  // Select B (nth 1) then Shift+click A (nth 2) to build a two-change selection.
  await nodes.nth(1).click();
  await nodes.nth(2).click({ modifiers: ["Shift"] });

  // The Interdiff section appears (created last, so at the bottom) and lists a.txt.
  await expect(async () => {
    const section = await getInterdiffSection(workbox);
    expect(section.exists).toBe(true);
    expect(section.files).toEqual(expect.arrayContaining(["a.txt"]));
  }).toPass();

  // Clicking the interdiff a.txt opens a diff editor. Selection order is [B, A],
  // so the interdiff is from B to A: left shows B's content, right shows A's content.
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

  // Selecting a single change again hides the Interdiff section.
  await nodes.nth(1).click();
  await expect(async () => {
    expect((await getInterdiffSection(workbox)).exists).toBe(false);
  }).toPass();
});
