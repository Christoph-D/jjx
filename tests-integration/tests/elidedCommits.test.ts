import { test, expect } from "./baseTest";

test("elided commits appear when ancestors are immutable", async ({ graphFrame, testRepo }) => {
  await testRepo.commitFile("a.txt", "content a", "commit A");
  await testRepo.commitFile("b.txt", "content b", "commit B");

  const nodes = graphFrame.locator("#nodes > div");
  await expect(nodes).toHaveCount(4, { timeout: 10000 });

  const elidedNode = graphFrame.getByText("~");
  await expect(elidedNode).toBeHidden();

  await testRepo.createTag("test-tag", "@-");

  await expect(nodes).toHaveCount(3, { timeout: 10000 });

  await expect(elidedNode).toBeVisible();

  await testRepo.writeFile(".vscode/settings.json", '{"jjx.numberOfImmutableParentsInLog": 2}');
  await expect(nodes).toHaveCount(4, { timeout: 10000 });
  await expect(elidedNode).toBeVisible();

  await testRepo.writeFile(".vscode/settings.json", '{"jjx.numberOfImmutableParentsInLog": 3}');
  await expect(nodes).toHaveCount(4, { timeout: 10000 });
  await expect(elidedNode).toBeHidden();
});

test("elided commits read from settings", async ({ graphFrame, testRepo }) => {
  await testRepo.commitFile("a.txt", "content a", "commit A");
  await testRepo.commitFile("b.txt", "content b", "commit B");

  await testRepo.writeFile(".vscode/settings.json", '{"jjx.elideImmutableCommits": false}');
  await testRepo.createTag("test-tag", "@-");

  const nodes = graphFrame.locator("#nodes > div");
  const elidedNode = graphFrame.getByText("~");

  await expect(nodes).toHaveCount(4, { timeout: 10000 });
  await expect(elidedNode).toBeHidden();

  await testRepo.writeFile(".vscode/settings.json", '{"jjx.numberOfImmutableParentsInLog": 2}');
  await expect(nodes).toHaveCount(4, { timeout: 10000 });
  await expect(elidedNode).toBeVisible();

  await testRepo.writeFile(".vscode/settings.json", '{"jjx.numberOfImmutableParentsInLog": 3}');
  await expect(nodes).toHaveCount(4, { timeout: 10000 });
  await expect(elidedNode).toBeHidden();
});
