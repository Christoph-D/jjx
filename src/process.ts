import spawn from "cross-spawn";
import type { ChildProcess, SpawnOptions as NodeSpawnOptions } from "child_process";
import * as vscode from "vscode";
import { logger } from "./logger";
import { getCommandTimeout } from "./config";
import { convertJJErrors, extractJJWarning } from "./errors";
import { getJjEditorEnv } from "./jj-editor";
import { buildSpawnEnv } from "./spawn-env";

export class CancelledError extends Error {
  constructor() {
    super("Operation cancelled");
  }
}

export class ProcessError extends Error {
  readonly exitCode: number | null;
  readonly signal: string | null;
  readonly stdout: string;
  readonly stderr: string;

  constructor(exitCode: number | null, signal: string | null, stdout: string, stderr: string) {
    const reason = exitCode !== null ? `exit code ${exitCode}` : `signal ${signal}`;
    super(`Command failed with ${reason}.\nstdout: ${stdout}\nstderr: ${stderr}`);
    this.name = "ProcessError";
    this.exitCode = exitCode;
    this.signal = signal;
    this.stdout = stdout;
    this.stderr = stderr;
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

const STDIO_DRAIN_GRACE_MS = 2000;

export function collectProcessOutput(
  childProcess: ChildProcess,
  token?: vscode.CancellationToken,
): Promise<ProcessOutput> {
  return new Promise((resolve, reject) => {
    const stdout: Buffer[] = [];
    const stderr: Buffer[] = [];
    let settled = false;
    let drainTimer: ReturnType<typeof setTimeout> | null = null;

    const cancelDrainTimer = () => {
      if (drainTimer) {
        clearTimeout(drainTimer);
        drainTimer = null;
      }
    };

    const settle = (code: number | null, signal: string | null) => {
      if (settled) {
        return;
      }
      settled = true;
      cancelDrainTimer();
      const stdoutBuf = Buffer.concat(stdout);
      const stderrBuf = Buffer.concat(stderr);
      if (code) {
        reject(new ProcessError(code, null, stdoutBuf.toString(), stderrBuf.toString()));
      } else if (signal) {
        reject(new ProcessError(null, signal, stdoutBuf.toString(), stderrBuf.toString()));
      } else {
        resolve({ stdout: stdoutBuf, stderr: stderrBuf });
      }
    };

    childProcess.stdout?.on("data", (data: Buffer) => {
      stdout.push(data);
    });

    childProcess.stderr?.on("data", (data: Buffer) => {
      stderr.push(data);
    });

    childProcess.on("error", (error: Error) => {
      if (!settled) {
        settled = true;
        cancelDrainTimer();
        reject(new Error(`Spawning command failed: ${error.message}`));
      }
    });

    childProcess.on("close", (code, signal) => {
      settle(code, signal);
    });

    childProcess.on("exit", (code, signal) => {
      cancelDrainTimer();
      drainTimer = setTimeout(() => settle(code, signal), STDIO_DRAIN_GRACE_MS);
    });

    if (token) {
      token.onCancellationRequested(() => {
        if (!settled) {
          settled = true;
          cancelDrainTimer();
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
    env: { ...buildSpawnEnv(), ...jjEditorEnv, ...options.env },
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
    .then((output) => {
      // jj prints warnings (e.g. "Failed to export some bookmarks") on stderr even when a command
      // exits successfully. Surface them so the user knows the operation only partially succeeded.
      const warning = extractJJWarning(output.stderr.toString());
      if (warning) {
        void vscode.window.showWarningMessage(warning);
      }
      return output.stdout;
    });
}
