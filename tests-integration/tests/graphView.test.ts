import { test, expect } from "./baseTest";

test("jj graph view loads and contains root commit", async ({ workbox }) => {
  await expect(workbox.locator(".monaco-workbench")).toBeVisible({ timeout: 30000 });

  await workbox.getByRole("tab", { name: /Source Control/i }).click();

  await workbox.locator(".scm-view").first().waitFor({ timeout: 10000 });

  const graphHeader = workbox.getByRole("button", { name: /Source Control Graph/i });

  const isExpanded = await graphHeader.getAttribute("aria-expanded");
  if (isExpanded === "false") {
    await graphHeader.click();
    await workbox.waitForTimeout(2000);
  }

  const allFrames = workbox.frames();
  let graphFrame = null;
  for (const frame of allFrames) {
    const content = await frame.content();
    if (content.includes('id="nodes"')) {
      graphFrame = frame;
      break;
    }
  }

  expect(graphFrame).not.toBeNull();

  // eslint-disable-next-line @typescript-eslint/no-unnecessary-type-assertion
  const rootCommit = graphFrame!.getByText("root()");
  await expect(rootCommit).toBeVisible({ timeout: 10000 });
});
