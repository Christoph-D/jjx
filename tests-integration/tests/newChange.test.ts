import { test, expect } from "./baseTest";
import { getParents } from "../testRepo";

test("create new child change from context menu", async ({ graphFrame, testRepo }) => {
  await testRepo.commitFile("a.txt", "content a", "A");
  await testRepo.commitFile("b.txt", "content b", "B");
  await testRepo.commitFile("c.txt", "content c", "C");

  const nodes = graphFrame.locator("#nodes > div");
  await expect(nodes).toHaveCount(5);

  const commitA = nodes.nth(3);
  await commitA.click({ button: "right" });

  const newChildItem = graphFrame.locator('.context-menu-item[data-action="newChild"]');
  await expect(newChildItem).toBeVisible();
  await newChildItem.click();

  await expect(nodes).toHaveCount(5);

  await expect(async () => {
    const logEntries = await testRepo.log();
    expect(getParents(logEntries, "@")).toEqual(["A"]);
  }).toPass();
});

test("create new change with multiple parents via toolbar", async ({ graphFrame, testRepo, workbox }) => {
  const changeIdA = await testRepo.commitFile("a.txt", "content a", "A");
  await testRepo.commitFile("b.txt", "content b", "B");
  await testRepo.jjCommand(["new", changeIdA]);
  await testRepo.commitFile("c.txt", "content c", "C");

  const nodes = graphFrame.locator("#nodes > div");
  await expect(nodes).toHaveCount(5);

  const commitB = nodes.nth(2);
  const commitC = nodes.nth(1);

  await commitB.click();
  await expect(commitB).toContainClass("selected");
  await commitC.click({ modifiers: ["Shift"] });
  await expect(commitC).toContainClass("selected");

  const newChangeButton = workbox.getByRole("button", { name: /Create New Change with Selected as Parents/i });
  await expect(newChangeButton).toBeVisible();
  await newChangeButton.click();

  await expect(nodes).toHaveCount(5);

  await expect(async () => {
    const logEntries = await testRepo.log();
    const parents = getParents(logEntries, "@");
    expect(parents).toHaveLength(2);
    expect(parents).toContain("B");
    expect(parents).toContain("C");
  }).toPass();
});

test("create new change via command palette", async ({ graphFrame, testRepo, workbox }) => {
  await testRepo.commitFile("a.txt", "content a", "A");
  await testRepo.commitFile("b.txt", "content b", "B");
  await testRepo.writeFile("c.txt", "content c");

  const nodes = graphFrame.locator("#nodes > div");
  await expect(nodes).toHaveCount(4);

  const scmEditor = workbox.locator(".scm-view .scm-editor").first();
  await scmEditor.click();
  await workbox.keyboard.type("C");

  await workbox.keyboard.press("Control+Shift+P");
  const quickInput = workbox.locator(".quick-input-widget input").first();
  await expect(quickInput).toBeVisible();
  await quickInput.fill(">Create New Change");
  await workbox.keyboard.press("Enter");

  await expect(nodes).toHaveCount(5);

  await expect(async () => {
    const logEntries = await testRepo.log("@-");
    expect(logEntries.find((e) => e.description.trim() === "C")).toBeDefined();
  }).toPass();
});

test("create new change via SCM input box", async ({ graphFrame, testRepo, workbox }) => {
  await testRepo.commitFile("a.txt", "content a", "A");
  await testRepo.commitFile("b.txt", "content b", "B");
  await testRepo.writeFile("c.txt", "content c");

  const nodes = graphFrame.locator("#nodes > div");
  await expect(nodes).toHaveCount(4);

  const scmEditor = workbox.locator(".scm-view .scm-editor").first();
  await scmEditor.click();
  await workbox.keyboard.type("C");
  await workbox.keyboard.press("Control+Enter");

  await expect(nodes).toHaveCount(5);

  await expect(async () => {
    const logEntries = await testRepo.log("@-");
    expect(logEntries.find((e) => e.description.trim() === "C")).toBeDefined();
  }).toPass();
});
