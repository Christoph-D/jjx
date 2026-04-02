import spawn from "cross-spawn";
import type { ChildProcess, SpawnOptions as NodeSpawnOptions } from "child_process";
import * as vscode from "vscode";
import { logger } from "./logger";
import { getCommandTimeout } from "./config";
import { convertJJErrors } from "./errors";
import { getJjEditorEnv } from "./jjEditor";

export class CancelledError extends Error {
  constructor() {
    super("Operation cancelled");
  }
}

export type SpawnOptions = NodeSpawnOptions & { cwd: string };

export type ProcessOutput = { stdout: Buffer; stderr: Buffer };

const activeProcesses = new Set<ChildProcess>();

export function killAllProcesses(): void {
  for (const proc of activeProcesses) {
    proc.kill();
  }
  activeProcesses.clear();
}

export function collectProcessOutput(
  childProcess: ChildProcess,
  token?: vscode.CancellationToken,
): Promise<ProcessOutput> {
  return new Promise((resolve, reject) => {
    const stdout: Buffer[] = [];
    const stderr: Buffer[] = [];
    let settled = false;

    childProcess.stdout?.on("data", (data: Buffer) => {
      stdout.push(data);
    });

    childProcess.stderr?.on("data", (data: Buffer) => {
      stderr.push(data);
    });

    childProcess.on("error", (error: Error) => {
      if (!settled) {
        settled = true;
        reject(new Error(`Spawning command failed: ${error.message}`));
      }
    });

    childProcess.on("close", (code, signal) => {
      if (!settled) {
        settled = true;
        const stdoutBuf = Buffer.concat(stdout);
        const stderrBuf = Buffer.concat(stderr);
        if (code) {
          reject(
            new Error(
              `Command failed with exit code ${code}.\nstdout: ${stdoutBuf.toString()}\nstderr: ${stderrBuf.toString()}`,
            ),
          );
        } else if (signal) {
          reject(
            new Error(
              `Command failed with signal ${signal}.\nstdout: ${stdoutBuf.toString()}\nstderr: ${stderrBuf.toString()}`,
            ),
          );
        } else {
          resolve({ stdout: stdoutBuf, stderr: stderrBuf });
        }
      }
    });

    if (token) {
      token.onCancellationRequested(() => {
        if (!settled) {
          settled = true;
          childProcess.kill();
          reject(new CancelledError());
        }
      });
    }
  });
}

export function spawnJJ(jjPath: string, args: string[], options: SpawnOptions) {
  const jjEditorEnv = getJjEditorEnv();
  const finalOptions = {
    ...options,
    timeout: getCommandTimeout(options.cwd, options.timeout),
    env: { ...process.env, ...jjEditorEnv, ...options.env },
  };

  logger.trace(`spawn: ${JSON.stringify([jjPath, ...args])} ${JSON.stringify({ spawnOptions: finalOptions })}`);

  const childProcess = spawn(jjPath, args, finalOptions);
  activeProcesses.add(childProcess);
  childProcess.on("close", () => activeProcesses.delete(childProcess));
  return childProcess;
}

export function handleJJCommand(childProcess: ChildProcess, token?: vscode.CancellationToken): Promise<Buffer> {
  return collectProcessOutput(childProcess, token)
    .catch(convertJJErrors)
    .then((output) => output.stdout);
}
