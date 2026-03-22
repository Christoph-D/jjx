import { test, expect } from "./baseTest";

test("graph view shows new commits", async ({ graphFrame, testRepo }) => {
  const rootCommit = graphFrame.getByText("root()");
  await expect(rootCommit).toBeVisible({ timeout: 10000 });

  const workingCopy = graphFrame.getByText("@");
  await expect(workingCopy).toBeVisible({ timeout: 10000 });

  const nodes = graphFrame.locator("#nodes > div");
  await expect(nodes).toHaveCount(2, { timeout: 10000 });

  await testRepo.writeFile("a.txt", "content a");
  await testRepo.commit("commit 1");
  await testRepo.writeFile("b.txt", "content b");
  await testRepo.commit("commit 2");
  await testRepo.writeFile("c.txt", "content c");
  await testRepo.commit("commit 3");

  await expect(nodes).toHaveCount(5, { timeout: 10000 });

  await expect(graphFrame.getByText("commit 1")).toBeVisible();
  await expect(graphFrame.getByText("commit 2")).toBeVisible();
  await expect(graphFrame.getByText("commit 3")).toBeVisible();
});
