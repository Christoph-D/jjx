import { test, expect } from "./baseTest";

test("rebase commit onto another via drag and drop", async ({ graphFrame, testRepo }) => {
  await testRepo.writeFile("a.txt", "content a");
  await testRepo.commit("A");
  await testRepo.writeFile("b.txt", "content b");
  await testRepo.commit("B");
  await testRepo.writeFile("c.txt", "content c");
  await testRepo.commit("C");

  const nodes = graphFrame.locator("#nodes > div");
  await expect(nodes).toHaveCount(5, { timeout: 10000 });

  const commitC = nodes.nth(1);
  const commitA = nodes.nth(3);

  const cChangeId = await commitC.getAttribute("data-change-id");
  const aChangeId = await commitA.getAttribute("data-change-id");

  if (!cChangeId || !aChangeId) {
    throw new Error("Could not get change IDs");
  }

  await graphFrame.evaluate(
    ({ cChangeId, aChangeId }) => {
      const cNode = document.querySelector(`.change-node[data-change-id="${cChangeId}"]`) as HTMLElement;
      const aNode = document.querySelector(`.change-node[data-change-id="${aChangeId}"]`) as HTMLElement;

      if (!cNode || !aNode) {
        throw new Error("Could not find nodes");
      }

      const cRect = cNode.getBoundingClientRect();
      const aRect = aNode.getBoundingClientRect();

      const mousedownEvent = new MouseEvent("mousedown", {
        bubbles: true,
        cancelable: true,
        clientX: cRect.left + cRect.width / 2,
        clientY: cRect.top + cRect.height / 2,
        button: 0,
      });
      cNode.dispatchEvent(mousedownEvent);

      const intermediateX = cRect.left + cRect.width / 2 + 10;
      const intermediateY = cRect.top + cRect.height / 2 + 10;
      const mousemoveEvent1 = new MouseEvent("mousemove", {
        bubbles: true,
        cancelable: true,
        clientX: intermediateX,
        clientY: intermediateY,
      });
      document.dispatchEvent(mousemoveEvent1);

      const mousemoveEvent2 = new MouseEvent("mousemove", {
        bubbles: true,
        cancelable: true,
        clientX: aRect.left + aRect.width / 2,
        clientY: aRect.top + aRect.height / 2,
      });
      document.dispatchEvent(mousemoveEvent2);

      const mouseupEvent = new MouseEvent("mouseup", {
        bubbles: true,
        cancelable: true,
        clientX: aRect.left + aRect.width / 2,
        clientY: aRect.top + aRect.height / 2,
        button: 0,
      });
      document.dispatchEvent(mouseupEvent);
    },
    { cChangeId, aChangeId },
  );

  const rebaseOntoItem = graphFrame.locator('.context-menu-item[data-action="rebaseOnto"]');
  await expect(rebaseOntoItem).toBeVisible({ timeout: 5000 });
  await rebaseOntoItem.click();

  await expect(nodes).toHaveCount(5, { timeout: 10000 });

  await expect(async () => {
    const logEntries = await testRepo.log();
    const commitCEntry = logEntries.find((e) => e.description.trim() === "C");
    expect(commitCEntry).toBeDefined();
    expect(commitCEntry!.parents).toHaveLength(1);

    const commitAParent = logEntries.find((e) => e.change_id === commitCEntry!.parents[0].change_id);
    expect(commitAParent).toBeDefined();
    expect(commitAParent!.description.trim()).toBe("A");
  }).toPass({ timeout: 10000 });
});
