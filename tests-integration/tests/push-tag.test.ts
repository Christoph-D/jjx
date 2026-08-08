import { test as test, expect, newTestRepo, clickPillMenuItem, type TestRepo } from "./base-test";
import type { Frame } from "@playwright/test";
import * as fs from "fs";
import * as os from "os";
import path from "path";

async function setupRemotesWithTrackedTag(testRepo: TestRepo, graphFrame: Frame) {
  const remoteAPath = path.join(path.dirname(testRepo.repoPath), "remote-a");
  const remoteBPath = path.join(path.dirname(testRepo.repoPath), "remote-b");
  const remoteARepo = await newTestRepo(remoteAPath);
  const remoteBRepo = await newTestRepo(remoteBPath);

  await testRepo.jjCommand(["git", "remote", "add", "remote-a", remoteAPath]);
  await testRepo.jjCommand(["git", "remote", "add", "remote-b", remoteBPath]);

  await testRepo.commitFile("test.txt", "content", "initial commit");
  await testRepo.createTag("my-tag", "@-");

  const tagPill = graphFrame.locator('[data-tag="my-tag"]');
  await expect(tagPill).toBeVisible();

  await clickPillMenuItem(graphFrame, tagPill, "Track on remote-a");
  await clickPillMenuItem(graphFrame, tagPill, "Track on remote-b");

  return { remoteARepo, remoteBRepo, tagPill };
}

test("push tag to all remotes via upload icon", async ({ graphFrame, testRepo }) => {
  test.slow();
  const { tagPill } = await setupRemotesWithTrackedTag(testRepo, graphFrame);

  const nodes = graphFrame.locator("#nodes > div");
  await expect(nodes).toHaveCount(3);

  const unsyncedPill = graphFrame.locator('[data-tag="my-tag"][data-unsynced]');
  const uploadIcon = tagPill.locator('[data-role="push-icon"]');

  await expect(uploadIcon).toBeVisible();

  await uploadIcon.click();

  await expect(unsyncedPill).not.toBeVisible();
});

test("push tag to single remote via context menu", async ({ graphFrame, testRepo }) => {
  test.slow();
  const { remoteARepo, remoteBRepo, tagPill } = await setupRemotesWithTrackedTag(testRepo, graphFrame);

  const uploadIcon = tagPill.locator('[data-role="push-icon"]');
  await expect(uploadIcon).toBeVisible();
  await uploadIcon.click();

  const unsyncedPill = graphFrame.locator('[data-tag="my-tag"][data-unsynced]');
  await expect(unsyncedPill).not.toBeVisible();

  // Move the tag to a new commit, making it out-of-sync with the remotes again.
  const changeId = await testRepo.commitFile("new.txt", "new content", "second commit");
  await testRepo.jjCommand(["tag", "set", "-r", "@-", "my-tag", "--allow-move"]);

  await expect(unsyncedPill).toBeVisible();
  await expect(uploadIcon).toBeVisible();

  await clickPillMenuItem(graphFrame, tagPill, "Push to remote-a");

  await expect(async () => {
    const showResult = await remoteARepo.jjCommand(["show", changeId]);
    expect(showResult.exitCode).toBe(0);
  }).toPass();

  const showResultB = await remoteBRepo.jjCommand(["show", changeId]);
  expect(showResultB.exitCode).not.toBe(0);

  await expect(unsyncedPill).toBeVisible();

  // remote-a is now in sync, so only remote-b should be offered as a push target.
  await expect(async () => {
    await tagPill.click({ button: "right" });
    const pushMenu = graphFrame.locator("#pill-context-menu");
    await expect(pushMenu).toBeVisible();
    const pushToB = pushMenu.locator("[data-action]").filter({ hasText: "Push to remote-b" });
    await expect(pushToB).toBeVisible();
    const pushToA = pushMenu.locator("[data-action]").filter({ hasText: "Push to remote-a" });
    await expect(pushToA).not.toBeVisible({ timeout: 2_000 });
    await graphFrame.locator("body").click({ position: { x: 1, y: 1 } });
    await expect(pushMenu).not.toBeVisible();
  }).toPass();

  await clickPillMenuItem(graphFrame, tagPill, "Push to remote-b");
  await expect(unsyncedPill).not.toBeVisible();
});

test("push tag to one remote and untrack from another", async ({ graphFrame, testRepo }) => {
  test.slow();
  const { remoteARepo, tagPill } = await setupRemotesWithTrackedTag(testRepo, graphFrame);

  const uploadIcon = tagPill.locator('[data-role="push-icon"]');
  await expect(uploadIcon).toBeVisible();
  await uploadIcon.click();

  const unsyncedPill = graphFrame.locator('[data-tag="my-tag"][data-unsynced]');
  await expect(unsyncedPill).not.toBeVisible();

  const changeId = await testRepo.commitFile("new.txt", "new content", "second commit");
  await testRepo.jjCommand(["tag", "set", "-r", "@-", "my-tag", "--allow-move"]);
  await expect(unsyncedPill).toBeVisible();

  await clickPillMenuItem(graphFrame, tagPill, "Push to remote-a");

  await expect(async () => {
    const showResult = await remoteARepo.jjCommand(["show", changeId]);
    expect(showResult.exitCode).toBe(0);
  }).toPass();

  // remote-b is still out of sync, but untracking it removes it as a push target,
  // so the tag is considered in sync again.
  await clickPillMenuItem(graphFrame, tagPill, "Untrack from remote-b");
  await expect(unsyncedPill).not.toBeVisible();

  await clickPillMenuItem(graphFrame, tagPill, "Untrack from remote-a");

  await expect(async () => {
    const trackedResult = await testRepo.jjCommand(["tag", "list", "my-tag", "--tracked"]);
    expect(trackedResult.stdout.trim()).toBe("");
  }).toPass();
});

const JJ_038_PATH = process.env.JJX_JJ_038_PATH ?? "/usr/local/bin/jj-0.38";

const testJJ038 = test.extend({
  customSettings:
    // eslint-disable-next-line no-empty-pattern
    async ({}, use) => {
      await use({ "jjx.jjPath": JJ_038_PATH });
    },
  testRepo: [
    // eslint-disable-next-line no-empty-pattern
    async ({}, use) => {
      test.skip(!fs.existsSync(JJ_038_PATH), "jj 0.38 binary not available");
      // Route the test helper's own jj invocations (repo/remote creation) through
      // jj 0.38 as well, so the repo format matches the version the extension uses.
      const tempDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), "jjx-test-"));
      const repoPath = path.join(tempDir, "repo");
      const testRepo = await newTestRepo(repoPath, { jjPath: JJ_038_PATH });
      try {
        await use(testRepo);
      } finally {
        await fs.promises.rm(tempDir, { recursive: true, force: true });
      }
    },
    { scope: "test" },
  ],
});

testJJ038(
  "push tag to remote via context menu without tracking support (jj 0.38)",
  async ({ graphFrame, testRepo }) => {
    test.slow();
    const remoteAPath = path.join(path.dirname(testRepo.repoPath), "remote-a");
    const remoteBPath = path.join(path.dirname(testRepo.repoPath), "remote-b");
    const remoteARepo = await newTestRepo(remoteAPath, { jjPath: JJ_038_PATH });
    const remoteBRepo = await newTestRepo(remoteBPath, { jjPath: JJ_038_PATH });

    await testRepo.jjCommand(["git", "remote", "add", "remote-a", remoteAPath]);
    await testRepo.jjCommand(["git", "remote", "add", "remote-b", remoteBPath]);

    await testRepo.commitFile("test.txt", "content", "initial commit");
    await testRepo.createTag("test-tag", "@-");

    const tagPill = graphFrame.locator('[data-tag="test-tag"]');
    await expect(tagPill).toBeVisible();

    // Without tracking support there is no push-all icon on the pill, only a
    // per-remote "Push to <remote>" entry in the context menu.
    await expect(tagPill.locator('[data-role="push-icon"]')).not.toBeVisible();

    await clickPillMenuItem(graphFrame, tagPill, "Push to remote-a");

    await expect(async () => {
      const tag = await remoteARepo.getTag("test-tag");
      expect(tag).toBeDefined();
    }).toPass();

    const tagB = await remoteBRepo.getTag("test-tag");
    expect(tagB).toBeUndefined();

    await clickPillMenuItem(graphFrame, tagPill, "Push to remote-b");

    await expect(async () => {
      const tag = await remoteBRepo.getTag("test-tag");
      expect(tag).toBeDefined();
    }).toPass();
  },
);
