import { test as base, expect, newTestRepo } from "./baseTest";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";

// `colocatedCheck.ts` warns when a repository root contains BOTH a `.jj` and a
// `.git` directory and the built-in Git extension is enabled. The warning has
// two surfaces:
//   - a persistent status bar item (`$(warning) jjx issues (N)`) whose command
//     (`jj.showColocatedWarnings`) re-shows the warning, and
//   - a `showWarningMessage` toast offering a single action, "Open Folder
//     Settings".
// There is no persistent "don't show again" state.

// A colocated repo (`.jj` + `.git`) with the Git extension enabled: the warning
// must fire.
const colocatedTest = base.extend({
  testRepo: [
    // eslint-disable-next-line no-empty-pattern
    async ({}, use) => {
      const tempDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), "jjx-test-"));
      const repoPath = path.join(tempDir, "repo");
      const repo = await newTestRepo(repoPath, { colocate: true });
      await use(repo);
      await fs.promises.rm(tempDir, { recursive: true, force: true });
    },
    { scope: "test" },
  ],
});

colocatedTest.use({ customSettings: { "git.enabled": true } });

colocatedTest("warns about a colocated jj/git repository with an Open Folder Settings action", async ({ workbox }) => {
  // The persistent status bar item is the reliable signal that detection ran.
  const statusItem = workbox.locator(".statusbar-item", { hasText: /jjx issues/ });
  await expect(statusItem).toBeVisible();

  // Re-trigger the warning toast via the status bar item's command so the toast
  // is freshly visible (startup toasts may collapse into the notification
  // center). `.first()` tolerates a still-visible startup toast.
  await statusItem.click();

  const colocatedToast = workbox
    .locator(".notifications-toasts .notification-list-item")
    .filter({ hasText: /Colocated Jujutsu and Git repository detected in "repo"/ });
  await expect(colocatedToast.first()).toBeVisible();
  await expect(colocatedToast.first().getByRole("button", { name: /Open Folder Settings/ })).toBeVisible();
});

// A non-colocated, git-backed jj repo store (no top-level `.git`). Even with the
// Git extension enabled, the detection condition (`.jj` AND `.git`) must fail,
// so no warning appears.
const nonColocatedTest = base.extend({
  testRepo: [
    // eslint-disable-next-line no-empty-pattern
    async ({}, use) => {
      const tempDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), "jjx-test-"));
      const repoPath = path.join(tempDir, "repo");
      const repo = await newTestRepo(repoPath, { colocate: false });
      await use(repo);
      await fs.promises.rm(tempDir, { recursive: true, force: true });
    },
    { scope: "test" },
  ],
});

nonColocatedTest.use({ customSettings: { "git.enabled": true } });

nonColocatedTest("does not warn for a non-colocated jj repository", async ({ graphFrame, workbox }) => {
  // Wait for the graph to render real data, which only happens after the first
  // background poll. Polling starts after the initial colocated check, so this
  // guarantees the check has run.
  await expect(graphFrame.locator("#nodes > div").first()).toBeVisible();

  // The status bar item persists once shown, so its absence reliably proves no
  // colocated warning was registered.
  await expect(workbox.locator(".statusbar-item", { hasText: /jjx issues/ })).toBeHidden();
  await expect(
    workbox.locator(".notifications-toasts .notification-list-item", {
      hasText: /Colocated Jujutsu and Git repository detected/,
    }),
  ).toBeHidden();
});
