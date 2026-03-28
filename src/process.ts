import spawn from "cross-spawn";
import type { ChildProcess, SpawnOptions as NodeSpawnOptions } from "child_process";
import { logger } from "./logger";
import { getCommandTimeout } from "./config";
import { convertJJErrors } from "./errors";
import { getJjEditorEnv } from "./jjEditor";

export type SpawnOptions = NodeSpawnOptions & { cwd: string };

export type ProcessOutput = { stdout: Buffer; stderr: Buffer };

const activeProcesses = new Set<ChildProcess>();

export function killAllProcesses(): void {
  for (const proc of activeProcesses) {
    proc.kill();
  }
  activeProcesses.clear();
}

export function collectProcessOutput(childProcess: ChildProcess): Promise<ProcessOutput> {
  return new Promise((resolve, reject) => {
    const stdout: Buffer[] = [];
    const stderr: Buffer[] = [];

    childProcess.stdout?.on("data", (data: Buffer) => {
      stdout.push(data);
    });

    childProcess.stderr?.on("data", (data: Buffer) => {
      stderr.push(data);
    });

    childProcess.on("error", (error: Error) => {
      reject(new Error(`Spawning command failed: ${error.message}`));
    });

    childProcess.on("close", (code, signal) => {
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
    });
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

export function handleJJCommand(childProcess: ChildProcess): Promise<Buffer> {
  return collectProcessOutput(childProcess)
    .catch(convertJJErrors)
    .then((output) => output.stdout);
}
