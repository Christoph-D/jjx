import { test, expect, waitForSCMView, mod, runCommand } from "./baseTest";

test("resolve merge conflict in merge editor", async ({ graphFrame, testRepo, workbox }) => {
  await testRepo.writeFile("file1.txt", "A");
  await testRepo.writeFile("file2.txt", "A");
  const baseChange = await testRepo.commit("Base commit");

  await testRepo.writeFile("file1.txt", "B");
  await testRepo.writeFile("file2.txt", "B");
  const changeB = await testRepo.commit("Change B");

  await testRepo.jjCommand(["new", baseChange]);
  await testRepo.writeFile("file1.txt", "C");
  await testRepo.writeFile("file2.txt", "C");
  const changeC = await testRepo.commit("Change C");

  await testRepo.jjCommand(["new", changeB, changeC]);

  const conflictResult = await testRepo.log("@");
  expect(conflictResult[0].conflict).toBe(true);

  await expect(graphFrame.locator("#nodes > div").first()).toBeVisible();

  const scmView = await waitForSCMView(workbox, ["file1.txt", "file2.txt"], ["file1.txt", "file2.txt"]);

  await expect(scmView.getByRole("treeitem", { name: /Working Copy \(conflict\)/ })).toBeVisible();

  const file1Item = scmView.getByRole("treeitem", { name: /file1\.txt/ });
  await file1Item.first().click();

  const mergeEditor1Left = workbox.locator('.monaco-editor[role="code"][data-uri*="left_file1.txt"]');
  await expect(mergeEditor1Left).toBeVisible();

  const mergeEditor1Right = workbox.locator('.monaco-editor[role="code"][data-uri*="right_file1.txt"]');
  await expect(mergeEditor1Right).toBeVisible();

  await expect(mergeEditor1Left.locator(".view-line")).toContainText("B");
  await expect(mergeEditor1Right.locator(".view-line")).toContainText("C");

  const mergeEditor1Output = workbox.locator('.monaco-editor[role="code"][data-uri*="/file1.txt"]');
  await expect(mergeEditor1Output).toBeVisible();

  await mergeEditor1Output.click();
  await workbox.keyboard.press(`${mod}+a`);
  await workbox.keyboard.type("Merged1");

  await workbox.keyboard.press(`${mod}+s`);
  await expect(workbox.locator(".tab.active")).not.toHaveClass(/dirty/);

  const file2Item = scmView.getByRole("treeitem", { name: /file2\.txt/ });
  await file2Item.first().click();

  const mergeEditor2Left = workbox.locator('.monaco-editor[role="code"][data-uri*="left_file2.txt"]');
  await expect(mergeEditor2Left).toBeVisible();

  const mergeEditor2Right = workbox.locator('.monaco-editor[role="code"][data-uri*="right_file2.txt"]');
  await expect(mergeEditor2Right).toBeVisible();

  await expect(mergeEditor2Left.locator(".view-line")).toContainText("B");
  await expect(mergeEditor2Right.locator(".view-line")).toContainText("C");

  const mergeEditor2Output = workbox.locator('.monaco-editor[role="code"][data-uri*="/file2.txt"]');
  await expect(mergeEditor2Output).toBeVisible();

  await mergeEditor2Output.click();
  await workbox.keyboard.press(`${mod}+a`);
  await workbox.keyboard.type("Merged2");

  await workbox.keyboard.press(`${mod}+s`);
  await expect(workbox.locator(".tab.active")).not.toHaveClass(/dirty/);

  await runCommand(workbox, "View: Close All Editors");
  await expect(mergeEditor1Output).toBeHidden();
  await expect(mergeEditor2Output).toBeHidden();

  await expect(async () => {
    const log = await testRepo.log("@");
    expect(log[0].conflict).toBe(false);
  }).toPass();

  const file1Content = await testRepo.readFile("file1.txt");
  expect(file1Content.trim()).toBe("Merged1");

  const file2Content = await testRepo.readFile("file2.txt");
  expect(file2Content.trim()).toBe("Merged2");
});
