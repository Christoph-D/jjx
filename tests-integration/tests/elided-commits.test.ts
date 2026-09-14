import { test, expect } from "./base-test";

test("elided commits appear when ancestors are immutable and respect settings", async ({ graphFrame, testRepo }) => {
  await testRepo.commitFile("a.txt", "content a", "commit A");
  await testRepo.commitFile("b.txt", "content b", "commit B");

  const nodes = graphFrame.locator("#nodes > div");
  const elidedNode = graphFrame.getByText("~");

  await test.step("tagging an ancestor elides immutable commits", async () => {
    await expect(nodes).toHaveCount(4);
    await expect(elidedNode).toBeHidden();

    await testRepo.createTag("test-tag", "@-");

    await expect(nodes).toHaveCount(3);
    await expect(elidedNode).toBeVisible();
  });

  await test.step("elision can be disabled via settings", async () => {
    await testRepo.writeFile(".vscode/settings.json", '{"jjx.elideImmutableCommits": false}');
    await expect(nodes).toHaveCount(4);
    await expect(elidedNode).toBeHidden();
  });

  await test.step("elidedVisibleImmutableParents controls how many elided commits stay visible", async () => {
    await testRepo.writeFile(".vscode/settings.json", '{"jjx.elidedVisibleImmutableParents": 2}');
    await expect(nodes).toHaveCount(4);
    await expect(elidedNode).toBeVisible();

    await testRepo.writeFile(".vscode/settings.json", '{"jjx.elidedVisibleImmutableParents": 3}');
    await expect(nodes).toHaveCount(4);
    await expect(elidedNode).toBeHidden();
  });
});
