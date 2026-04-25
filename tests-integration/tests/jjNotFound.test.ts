import { test as base, expect, newTestRepo } from "./baseTest";
import { type Frame } from "@playwright/test";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";

const test = base.extend({
  testRepo: [
    // eslint-disable-next-line no-empty-pattern
    async ({}, use) => {
      const tempDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), "jjx-test-"));
      const repoPath = path.join(tempDir, "repo");
      const repo = await newTestRepo(repoPath);
      await repo.writeFile(
        ".vscode/settings.json",
        JSON.stringify({ "jjx.jjPath": "/nonexistent/jj" }),
      );
      await use(repo);
      await fs.promises.rm(tempDir, { recursive: true, force: true });
    },
    { scope: "test" },
  ],
});

test("shows error views when jj binary is not found", async ({ workbox, scmView }) => {
  const graphHeader = scmView.getByRole("button", { name: /JJ Graph/i });
  const isExpanded = await graphHeader.getAttribute("aria-expanded");
  if (isExpanded === "false") {
    await graphHeader.click();
  }

  let graphFrame: Frame | undefined;
  await expect(async () => {
    for (const frame of workbox.frames()) {
      const content = await frame.content();
      if (content.includes('id="jj-not-found-state"')) {
        graphFrame = frame;
        return;
      }
    }
    throw new Error("Graph frame with not-found state not found");
  }).toPass();

  await expect(graphFrame!.locator("#jj-not-found-state .stale-state-message")).toHaveText(
    "No jj Binary Found",
  );
  const installLink = graphFrame!.locator("#jj-not-found-state a");
  await expect(installLink).toHaveAttribute(
    "href",
    "https://docs.jj-vcs.dev/latest/install-and-setup/",
  );

  await expect(scmView.getByRole("treeitem", { name: /jj binary not found/i })).toBeVisible();

  const opLogHeader = scmView.getByRole("button", { name: /Operation Log/ });
  await opLogHeader.click();
  const opLogPane = scmView.locator(".pane", { hasText: "Operation Log" });
  await expect(opLogPane).toBeVisible();
  await expect(opLogPane.locator('[role="treeitem"]')).toHaveCount(0);
});
