import fs from "fs/promises";
import path from "path";
import { execFile } from "child_process";

export interface JJCommandResult {
  stdout: string;
  stderr: string;
  exitCode: number;
}

function getJJPath(): string {
  return process.env.JJ_PATH || "jj";
}

export class TestRepo {
  constructor(public readonly repoPath: string) {}

  async commit(message: string): Promise<JJCommandResult> {
    return this.jjCommand(["commit", "-m", message]);
  }

  async writeFile(relativePath: string, content: string): Promise<void> {
    const fullPath = path.join(this.repoPath, relativePath);
    await fs.mkdir(path.dirname(fullPath), { recursive: true });
    await fs.writeFile(fullPath, content);
  }

  async jjCommand(args: string[]): Promise<JJCommandResult> {
    const jjPath = getJJPath();
    return new Promise((resolve) => {
      execFile(jjPath, args, { cwd: this.repoPath, timeout: 10000 }, (error, stdout, stderr) => {
        resolve({
          stdout: stdout?.toString() ?? "",
          stderr: stderr?.toString() ?? "",
          exitCode: error ? (typeof error.code === "number" ? error.code : 1) : 0,
        });
      });
    });
  }
}

export async function newTestRepo(repoPath: string): Promise<TestRepo> {
  const repo = new TestRepo(repoPath);
  await fs.mkdir(repoPath, { recursive: true });
  await repo.jjCommand(["git", "init"]);
  return repo;
}
