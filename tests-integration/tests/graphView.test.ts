import { test, expect } from "./baseTest";

test("graph view shows new commits", async ({ graphFrame, testRepo }) => {
  const rootCommit = graphFrame.getByText("root()");
  await expect(rootCommit).toBeVisible();

  const workingCopy = graphFrame.getByText("@");
  await expect(workingCopy).toBeVisible();

  const nodes = graphFrame.locator("#nodes > div");
  await expect(nodes).toHaveCount(2);

  await testRepo.commitFile("a.txt", "content a", "commit 1");
  await testRepo.commitFile("b.txt", "content b", "commit 2");
  await testRepo.commitFile("c.txt", "content c", "commit 3");

  await expect(nodes).toHaveCount(5);

  await expect(graphFrame.getByText("commit 1")).toBeVisible();
  await expect(graphFrame.getByText("commit 2")).toBeVisible();
  await expect(graphFrame.getByText("commit 3")).toBeVisible();
});
