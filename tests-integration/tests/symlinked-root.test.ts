import fs from "fs";
import os from "os";
import path from "path";
import { test as base, expect, TestRepo, newTestRepo, waitForSCMView } from "./base-test";

// Opens the repository through a symlinked path so the workspace folder keeps a path spelling
// that differs from the resolved repository root.
// The SCM view must still show paths relative to the repository root.
const test = base.extend<{ symlinkedRepoPath: string }>({
  symlinkedRepoPath: [
    // eslint-disable-next-line no-empty-pattern
    async ({}, use) => {
      const tempDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), "jjx-symlink-"));
      const realDir = path.join(tempDir, "real");
      await fs.promises.mkdir(realDir);
      const repoPath = path.join(realDir, "repo");
      await newTestRepo(repoPath);
      const linkDir = path.join(tempDir, "link");
      await fs.promises.symlink(realDir, linkDir);
      await use(path.join(linkDir, "repo"));
      await fs.promises.rm(tempDir, { recursive: true, force: true });
    },
    { scope: "test" },
  ],
  workspaceFolders: [
    async ({ symlinkedRepoPath }, use) => {
      await use([symlinkedRepoPath]);
    },
    { scope: "test" },
  ],
});

test("SCM view shows repo-relative paths when the workspace root is a symlink", async ({
  graphFrame,
  workbox,
  symlinkedRepoPath,
}) => {
  test.skip(process.platform === "win32", "Creating directory symlinks needs privileges on Windows");

  const repo = new TestRepo(symlinkedRepoPath);
  await repo.commitFile("root.txt", "base", "base commit");
  await repo.writeFile("modified.txt", "modified");
  await repo.writeFile("subdir/nested.txt", "nested");

  await expect(graphFrame.locator("#nodes > div").first()).toBeVisible();

  const scmView = await waitForSCMView(workbox, ["modified.txt", "nested.txt"], ["root.txt"]);

  const tempDir = path.dirname(path.dirname(symlinkedRepoPath));
  const scmTree = workbox.getByRole("tree", { name: "Source Control Management" });
  const entries = await scmTree.evaluate((el) =>
    Array.from(el.querySelectorAll("[role='treeitem']"))
      .filter((item) => item.getAttribute("aria-level") === "2")
      .map((item) => ({
        name: (item.getAttribute("aria-label") ?? "").split(",")[0].trim(),
        text: item.textContent ?? "",
      })),
  );

  const entryOf = (fileName: string) => {
    const entry = entries.find((candidate) => candidate.name === fileName);
    expect(entry, `No SCM entry found for ${fileName}`).toBeDefined();
    return entry!;
  };

  // Files in the repository root show no path suffix at all.
  for (const fileName of ["root.txt", "modified.txt"]) {
    const text = entryOf(fileName).text;
    expect(text, `${fileName} should show no path suffix`).not.toContain("/");
    expect(text).not.toContain("\\");
  }

  // A file in a subdirectory shows the path relative to the repository root, never an absolute
  // path in either spelling of the repository root.
  const nestedText = entryOf("nested.txt").text;
  expect(nestedText).toContain("subdir");
  for (const entry of entries) {
    expect(entry.text).not.toContain(symlinkedRepoPath);
    expect(entry.text).not.toContain(tempDir);
  }

  // Clicking a file still opens a working diff through the symlinked spelling.
  const nestedItem = scmView.getByRole("treeitem", { name: /^nested\.txt/ });
  await nestedItem.first().click();
  const modifiedPane = workbox.locator(".editor-instance .editor.modified .view-lines");
  await expect(modifiedPane.getByText("nested", { exact: true })).toBeVisible();
});
