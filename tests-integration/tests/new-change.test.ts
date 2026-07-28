import { test, expect, handleEditor, mod, runCommand } from "./base-test";
import { getParents } from "../test-repo";

test("create new child change from context menu", async ({ graphFrame, testRepo }) => {
  await testRepo.commitFile("a.txt", "content a", "A");
  await testRepo.commitFile("b.txt", "content b", "B");
  await testRepo.commitFile("c.txt", "content c", "C");

  const nodes = graphFrame.locator("#nodes > div");
  await expect(nodes).toHaveCount(5);

  const commitA = nodes.nth(3);
  await commitA.click({ button: "right" });

  const newChildItem = graphFrame.locator('[data-action="newChild"]');
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
  await expect(commitB).toHaveAttribute("data-selected");
  await commitC.click({ modifiers: ["Shift"] });
  await expect(commitC).toHaveAttribute("data-selected");

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

  await runCommand(workbox, "Create New Change");

  await expect(nodes).toHaveCount(5);

  await expect(async () => {
    const logEntries = await testRepo.log("@-");
    expect(logEntries.find((e) => e.description.trim() === "C")).toBeDefined();
  }).toPass();
});

test("commit change via SCM input box", async ({ graphFrame, testRepo, workbox }) => {
  await testRepo.commitFile("a.txt", "content a", "A");
  await testRepo.commitFile("b.txt", "content b", "B");
  await testRepo.writeFile("c.txt", "content c");

  const nodes = graphFrame.locator("#nodes > div");
  await expect(nodes).toHaveCount(4);

  const scmEditor = workbox.locator(".scm-view .scm-editor").first();
  await scmEditor.click();
  await workbox.keyboard.type("C");
  await workbox.keyboard.press(`${mod}+Enter`);

  await expect(nodes).toHaveCount(5);

  await expect(async () => {
    const logEntries = await testRepo.log("@-");
    expect(logEntries).toHaveLength(1);
    expect(logEntries[0].description.trim()).toBe("C");
  }).toPass();

  // Commit without a commit message should succeed without opening an editor.
  await workbox.keyboard.press(`${mod}+Enter`);
  await expect(nodes).toHaveCount(6);

  await expect(async () => {
    const logEntries = await testRepo.log("@-");
    expect(logEntries).toHaveLength(1);
    expect(logEntries[0].description.trim()).toBe("");
  }).toPass();
});

test.describe("commitAction = new", () => {
  test.use({ customSettings: { "jjx.commitAction": "new", "jjx.graphStyle": "full" } });

  test("create new change via SCM input box", async ({ graphFrame, testRepo, workbox }) => {
    await expect(graphFrame.locator('[data-mode="compact"]')).toHaveCount(0);

    await testRepo.commitFile("a.txt", "content a", "A");
    await testRepo.commitFile("b.txt", "content b", "B");
    await testRepo.writeFile("c.txt", "content c");

    const nodes = graphFrame.locator("#nodes > div");
    await expect(nodes).toHaveCount(4);

    const scmEditor = workbox.locator(".scm-view .scm-editor").first();
    await scmEditor.click();
    await workbox.keyboard.type("C");
    await workbox.keyboard.press(`${mod}+Enter`);

    await expect(nodes).toHaveCount(5);

    await expect(async () => {
      const logEntries = await testRepo.log("@");
      expect(logEntries).toHaveLength(1);
      expect(logEntries[0].description.trim()).toBe("C");
    }).toPass();

    // Commit without a commit message should succeed without opening an editor.
    await workbox.keyboard.press(`${mod}+Enter`);
    await expect(nodes).toHaveCount(6);

    await expect(async () => {
      const logEntries = await testRepo.log("@");
      expect(logEntries).toHaveLength(1);
      expect(logEntries[0].description.trim()).toBe("");
    }).toPass();
  });

  test("create new change via SCM input box with editor", async ({ graphFrame, testRepo, workbox }) => {
    await expect(graphFrame.locator('[data-mode="compact"]')).toHaveCount(0);

    await testRepo.commitFile("a.txt", "content a", "A");
    await testRepo.commitFile("b.txt", "content b", "B");
    await testRepo.writeFile("c.txt", "content c");

    const nodes = graphFrame.locator("#nodes > div");
    await expect(nodes).toHaveCount(4);

    const scmEditor = workbox.locator(".scm-view .scm-editor").first();
    await scmEditor.click();
    await workbox.keyboard.type("some message");
    await workbox.keyboard.press(`Shift+${mod}+Enter`);
    await handleEditor(workbox, "some message", "edited message");

    await expect(nodes).toHaveCount(5);

    await expect(async () => {
      const logEntries = await testRepo.log("@");
      expect(logEntries).toHaveLength(1);
      expect(logEntries[0].description.trim()).toBe("edited message");
    }).toPass();

    await scmEditor.click();
    await workbox.keyboard.press(`Shift+${mod}+Enter`);
    await handleEditor(workbox, "", "another edited message");
    await expect(nodes).toHaveCount(6);

    await expect(async () => {
      const logEntries = await testRepo.log("@");
      expect(logEntries).toHaveLength(1);
      expect(logEntries[0].description.trim()).toBe("another edited message");
    }).toPass();
  });
});
