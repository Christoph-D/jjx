import fs from "fs/promises";
import path from "path";
import { execFile } from "child_process";
import { generateTemplate, type TemplateFields, LOG_TEMPLATE } from "../src/templateBuilder.js";
import type { LogEntry } from "../src/types.js";

export interface JJCommandResult {
  stdout: string;
  stderr: string;
  exitCode: number;
}

export interface BookmarkInfo {
  name: string;
  description: string | null;
}

export interface TagInfo {
  name: string;
  description: string | null;
}

const BOOKMARK_FIELDS: TemplateFields = {
  name: { type: "string", expr: "self.name()" },
  description: {
    type: "raw",
    expr: 'if(self.normal_target(), self.normal_target().description().escape_json(), "null")',
  },
};
const BOOKMARK_TEMPLATE = generateTemplate(BOOKMARK_FIELDS);

const TAG_FIELDS: TemplateFields = {
  name: { type: "string", expr: "self.name()" },
  description: {
    type: "raw",
    expr: 'if(self.normal_target(), self.normal_target().description().escape_json(), "null")',
  },
};
const TAG_TEMPLATE = generateTemplate(TAG_FIELDS);

function getJJPath(): string {
  return process.env.JJ_PATH || "jj";
}

function isTransientLockError(stderr: string): boolean {
  return (
    /lock/i.test(stderr) ||
    /Access is denied/i.test(stderr) ||
    // On Windows, when the extension's background poll snapshots the working
    // copy concurrently with a test-initiated `jj` command, the file system may
    // briefly expose an interim state where `.jj/working_copy/type` does not
    // exist, producing the errors below. They are transient and a retry
    // succeeds once the snapshot swap completes.
    /broken or inaccessible/i.test(stderr) ||
    /Failed to read working copy backend type/i.test(stderr) ||
    /system cannot find the file specified/i.test(stderr) ||
    (/working_copy/i.test(stderr) && /os error 2/i.test(stderr))
  );
}

export class TestRepo {
  static userName: string | null = "Test User";
  static userEmail: string | null = "test@example.com";

  constructor(public readonly repoPath: string) {}

  async commit(message: string): Promise<string> {
    const result = await this.jjCommand(["commit", "-m", message]);
    if (result.exitCode !== 0) {
      throw new Error(`Commit failed: ${result.stderr}`);
    }
    const entries = await this.log("@-");
    return entries[0].change_id;
  }

  async log(rev: string = "all()"): Promise<LogEntry[]> {
    const result = await this.jjCommand(["log", "-r", rev, "-T", LOG_TEMPLATE]);
    const output = result.stdout;

    if (!output.trim()) {
      return [];
    }

    const entries: LogEntry[] = [];
    for (const line of output.trim().split("\n")) {
      const jsonStart = line.indexOf("{");
      if (jsonStart === -1) {
        continue;
      }
      entries.push(JSON.parse(line.slice(jsonStart)) as LogEntry);
    }
    return entries;
  }

  async writeFile(relativePath: string, content: string): Promise<void> {
    const fullPath = path.join(this.repoPath, relativePath);
    await fs.mkdir(path.dirname(fullPath), { recursive: true });
    await fs.writeFile(fullPath, content);
  }

  async readFile(relativePath: string): Promise<string> {
    const fullPath = path.join(this.repoPath, relativePath);
    try {
      return await fs.readFile(fullPath, "utf-8");
    } catch {
      throw new Error(`Failed to read file: ${relativePath}`);
    }
  }

  async deleteFile(relativePath: string): Promise<void> {
    const fullPath = path.join(this.repoPath, relativePath);
    await fs.unlink(fullPath);
  }

  async commitFile(relativePath: string, content: string, message: string): Promise<string> {
    await this.writeFile(relativePath, content);
    return this.commit(message);
  }

  async hasRemoteBookmark(name: string, remote: string): Promise<boolean> {
    const result = await this.jjCommand([
      "bookmark",
      "list",
      "--remote",
      remote,
      "-T",
      'self.name() ++ if(self.remote(), "@" ++ self.remote(), "") ++ "\\n"',
    ]);
    return result.stdout.includes(`${name}@${remote}`);
  }

  async getBookmark(name: string): Promise<BookmarkInfo | undefined> {
    const result = await this.jjCommand(["bookmark", "list", "-T", BOOKMARK_TEMPLATE]);
    const bookmarks: BookmarkInfo[] = result.stdout
      .trim()
      .split("\n")
      .filter((line) => line.length > 0)
      .map((line) => {
        const b = JSON.parse(line) as BookmarkInfo;
        if (b.description !== null) {
          b.description = b.description.replace(/\n$/, "");
        }
        return b;
      });
    return bookmarks.find((b) => b.name === name);
  }

  async getTag(name: string): Promise<TagInfo | undefined> {
    const result = await this.jjCommand(["tag", "list", "-T", TAG_TEMPLATE]);
    const tags: TagInfo[] = result.stdout
      .trim()
      .split("\n")
      .filter((line) => line.length > 0)
      .map((line) => {
        const t = JSON.parse(line) as TagInfo;
        if (t.description !== null) {
          t.description = t.description.replace(/\n$/, "");
        }
        return t;
      });
    return tags.find((t) => t.name === name);
  }

  async createTag(name: string, revision: string = "@"): Promise<JJCommandResult> {
    return this.jjCommand(["tag", "set", "-r", revision, name]);
  }

  async jjCommand(args: string[]): Promise<JJCommandResult> {
    let config: string[] = [];
    if (TestRepo.userName && TestRepo.userEmail) {
      config = ["--config", `user.name=${TestRepo.userName}`, "--config", `user.email=${TestRepo.userEmail}`];
    }
    const jjPath = getJJPath();
    const fullArgs = config.concat(args);
    const maxAttempts = 3;
    for (let attempt = 0; ; attempt++) {
      const result = await new Promise<JJCommandResult>((resolve) => {
        execFile(jjPath, fullArgs, { cwd: this.repoPath, timeout: 10000 }, (error, stdout, stderr) => {
          resolve({
            stdout: stdout?.toString() ?? "",
            stderr: stderr?.toString() ?? "",
            exitCode: error ? (typeof error.code === "number" ? error.code : 1) : 0,
          });
        });
      });
      if (result.exitCode === 0 || attempt >= maxAttempts - 1 || !isTransientLockError(result.stderr)) {
        return result;
      }
      await new Promise((resolve) => setTimeout(resolve, 500));
    }
  }
}

export function getParents(logEntries: LogEntry[], description: string): string[] {
  const entry =
    description === "@"
      ? logEntries.find((e) => e.current_working_copy)
      : logEntries.find((e) => e.description.trim() === description);
  if (!entry) {
    throw new Error(`Commit with description "${description}" not found`);
  }
  return entry.parents.map((parent) => {
    const parentEntry = logEntries.find((e) => e.change_id === parent.change_id);
    if (!parentEntry) {
      throw new Error(`Parent commit with change_id "${parent.change_id}" not found`);
    }
    if (parentEntry.current_working_copy) {
      return "@";
    }
    return parentEntry.description.trim();
  });
}

export interface NewTestRepoOptions {
  // When true, force a colocated repo (top-level `.git` alongside `.jj`) via
  // `jj git init --colocate`. When false, force a non-colocated, git-backed jj
  // repo store (no top-level `.git`) via `jj git init --no-colocate`. When
  // undefined, use `jj git init`'s default.
  colocate?: boolean;
}

export async function newTestRepo(repoPath: string, options: NewTestRepoOptions = {}): Promise<TestRepo> {
  const repo = new TestRepo(repoPath);
  await fs.mkdir(repoPath, { recursive: true });
  const initArgs = ["git", "init"];
  if (options.colocate === true) {
    initArgs.push("--colocate");
  } else if (options.colocate === false) {
    initArgs.push("--no-colocate");
  }
  await repo.jjCommand(initArgs);
  return repo;
}
