import { test, expect } from "./baseTest";

test("absorb working-copy changes into the change that last touched the file via context menu", async ({
  graphFrame,
  testRepo,
}) => {
  // Build a stack: change A touches a.txt, its child change B touches b.txt.
  await testRepo.commitFile("a.txt", "line1\nline2\nline3\n", "A");
  await testRepo.commitFile("b.txt", "b-content\n", "B");

  const nodes = graphFrame.locator("#nodes > div");
  await expect(nodes).toHaveCount(4);

  // Edit a file in the working copy that was last touched by change A.
  await testRepo.writeFile("a.txt", "line1\nMODIFIED-line2\nline3\n");

  // Trigger "Absorb" on the working-copy change via the graph context menu.
  const workingCopyNode = nodes.first();
  await workingCopyNode.click({ button: "right" });

  const absorbItem = graphFrame.locator('[data-action="absorb"]');
  await expect(absorbItem).toBeVisible();
  await absorbItem.click();

  // The absorbed hunks are removed from the working copy.
  await expect(async () => {
    const diffResult = await testRepo.jjCommand(["diff", "--name-only"]);
    expect(diffResult.stdout.trim()).toBe("");
  }).toPass();

  // Change A now contains the absorbed modification...
  await expect(async () => {
    const logEntries = await testRepo.log();
    const changeA = logEntries.find((e) => e.description.trim() === "A");
    expect(changeA).toBeDefined();
    const diffResult = await testRepo.jjCommand(["diff", "-r", changeA!.change_id]);
    expect(diffResult.stdout).toContain("MODIFIED-line2");
  }).toPass();

  // ...while the unrelated child change B is left untouched.
  await expect(async () => {
    const logEntries = await testRepo.log();
    const changeB = logEntries.find((e) => e.description.trim() === "B");
    expect(changeB).toBeDefined();
    const diffResult = await testRepo.jjCommand(["diff", "--name-only", "-r", changeB!.change_id]);
    expect(diffResult.stdout.trim()).toBe("b.txt");
  }).toPass();

  // The graph refreshes and still shows the stack of changes.
  await expect(nodes).toHaveCount(4);
});
