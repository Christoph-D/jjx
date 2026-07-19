import { test as base, expect } from "./baseTest";
import { type Frame } from "@playwright/test";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { TestRepo } from "../testRepo";

const test = base.extend({
  testRepo: [
    // eslint-disable-next-line no-empty-pattern
    async ({}, use) => {
      const tempDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), "jjx-test-"));
      const repoPath = path.join(tempDir, "norepo");
      await fs.promises.mkdir(repoPath, { recursive: true });
      await use(new TestRepo(repoPath));
      await fs.promises.rm(tempDir, { recursive: true, force: true });
    },
    { scope: "test" },
  ],
});

test("shows no repo found state when jj binary exists but no jj repo is present", async ({ workbox, scmView }) => {
  const graphHeader = scmView.getByRole("button", { name: /JJ Graph/i });
  const isExpanded = await graphHeader.getAttribute("aria-expanded");
  if (isExpanded === "false") {
    await graphHeader.click();
  }

  let graphFrame: Frame | undefined;
  await expect(async () => {
    for (const frame of workbox.frames()) {
      const content = await frame.content();
      if (content.includes('id="no-repo-found-state"')) {
        graphFrame = frame;
        return;
      }
    }
    throw new Error("Graph frame with no-repo-found state not found");
  }).toPass();

  await expect(graphFrame!.locator('#no-repo-found-state [data-role="message"]')).toHaveText("No jj Repository Found");

  await expect(scmView.getByRole("treeitem", { name: /no jj repository found/i })).toBeVisible();
});
