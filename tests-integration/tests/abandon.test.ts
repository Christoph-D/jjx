import { test, expect } from "./base-test";
import { getParents } from "../test-repo";

test("abandon single change via context menu", async ({ graphFrame, testRepo, workbox }) => {
  await testRepo.commitFile("a.txt", "content a", "A");
  await testRepo.commitFile("b.txt", "content b", "Second commit");
  await testRepo.commitFile("c.txt", "content c", "C");

  const changeB = (await testRepo.log()).find((e) => e.description.trim() === "Second commit")!;

  const nodes = graphFrame.locator("#nodes > div");
  await expect(nodes).toHaveCount(5);

  const commitB = nodes.nth(2);
  await commitB.click({ button: "right" });

  const abandonItem = graphFrame.locator('[data-action="abandon"]');
  await expect(abandonItem).toBeVisible();
  await abandonItem.click();

  const dialog = workbox.locator(".monaco-dialog-box");
  await expect(dialog).toBeVisible();
  await expect(dialog).toContainText(`Are you sure you want to abandon change "${changeB.change_id_shortest}"?`);
  await expect(dialog).toContainText("→ Second commit");

  await workbox.keyboard.press("Escape");
  await expect(dialog).not.toBeVisible();

  await expect(nodes).toHaveCount(5);

  await expect(async () => {
    const logEntries = await testRepo.log();
    expect(logEntries.find((e) => e.description.trim() === "Second commit")).toBeDefined();
    expect(getParents(logEntries, "C")).toEqual(["Second commit"]);
  }).toPass();

  await commitB.click({ button: "right" });
  await expect(abandonItem).toBeVisible();
  await abandonItem.click();
  await expect(dialog).toBeVisible();
  await expect(dialog).toContainText(`Are you sure you want to abandon change "${changeB.change_id_shortest}"?`);
  await expect(dialog).toContainText("→ Second commit");

  await dialog.getByRole("button", { name: "Abandon" }).click();

  await expect(dialog).not.toBeVisible();

  await expect(nodes).toHaveCount(4);

  await expect(async () => {
    const logEntries = await testRepo.log();
    expect(logEntries.find((e) => e.description.trim() === "Second commit")).toBeUndefined();
    expect(getParents(logEntries, "C")).toEqual(["A"]);
  }).toPass();
});

test("abandon multiple selected changes via context menu", async ({ graphFrame, testRepo, workbox }) => {
  await testRepo.commitFile("a.txt", "content a", "A");
  await testRepo.commitFile("b.txt", "content b", "B");
  await testRepo.commitFile("c.txt", "content c", "C");

  const nodes = graphFrame.locator("#nodes > div");
  await expect(nodes).toHaveCount(5);

  const commitB = nodes.nth(2);
  const commitC = nodes.nth(1);

  await commitB.click({ modifiers: ["Shift"] });
  await commitC.click({ modifiers: ["Shift"] });

  await commitC.click({ button: "right" });

  const abandonSelected = graphFrame.locator('[data-action="abandonSelected"]');
  await expect(abandonSelected).toBeVisible();
  await abandonSelected.click();

  const dialog = workbox.locator(".monaco-dialog-box");
  await expect(dialog).toBeVisible();
  await expect(dialog).toContainText("Are you sure you want to abandon 2 changes?");

  await dialog.getByRole("button", { name: "Abandon" }).click();

  await expect(nodes).toHaveCount(3);

  await expect(async () => {
    const logEntries = await testRepo.log();
    expect(logEntries.find((e) => e.description.trim() === "B")).toBeUndefined();
    expect(logEntries.find((e) => e.description.trim() === "C")).toBeUndefined();
    expect(getParents(logEntries, "@")).toEqual(["A"]);
  }).toPass();
});
