import { test, expect } from "./base-test";

const FILE_COUNT = 8000;

test.skip(process.platform !== "linux", "Performance test only runs on Linux");

test("performance: SCM view renders many changed files in the working copy", async ({ testRepo, workbox, scmView }) => {
  await testRepo.commitFile("initial.txt", "initial", "initial commit");

  for (let i = 0; i < FILE_COUNT; i++) {
    await testRepo.writeFile(`file${i.toString().padStart(3, "0")}.txt`, `content ${i}`);
  }

  await expect(
    workbox.getByRole("tab", { name: new RegExp(`Source Control.*${FILE_COUNT} pending changes`, "i") }),
  ).toBeVisible();

  const scmTree = scmView.getByRole("tree", { name: "Source Control Management" });
  const workingCopyGroup = scmTree.getByRole("treeitem", { name: /^Working Copy/ });
  await expect(workingCopyGroup).toContainText(String(FILE_COUNT));

  await expect(scmTree.getByRole("treeitem", { name: /^file000\.txt/ })).toBeVisible();
});
