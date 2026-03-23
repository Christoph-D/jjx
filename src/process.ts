import spawn from "cross-spawn";
import type { ChildProcess } from "child_process";
import { logger } from "./logger";
import { getCommandTimeout } from "./config";
import { convertJJErrors } from "./errors";
import { getJjEditorEnv } from "./jjEditor";

export function spawnJJ(jjPath: string, args: string[], options: Parameters<typeof spawn>[2] & { cwd: string }) {
  const jjEditorEnv = getJjEditorEnv();
  const finalOptions = {
    ...options,
    timeout: getCommandTimeout(options.cwd, options.timeout),
    env: { ...process.env, ...jjEditorEnv, ...options.env },
  };

  logger.info(`spawn: ${JSON.stringify([jjPath, ...args])} ${JSON.stringify({ spawnOptions: finalOptions })}`);

  return spawn(jjPath, args, finalOptions);
}

export function handleJJCommand(childProcess: ChildProcess) {
  return handleCommand(childProcess).catch(convertJJErrors);
}

export function handleCommand(childProcess: ChildProcess) {
  return new Promise<Buffer>((resolve, reject) => {
    const output: Buffer[] = [];
    const errOutput: Buffer[] = [];
    childProcess.stdout!.on("data", (data: Buffer) => {
      output.push(data);
    });
    childProcess.stderr!.on("data", (data: Buffer) => {
      errOutput.push(data);
    });
    childProcess.on("error", (error: Error) => {
      reject(new Error(`Spawning command failed: ${error.message}`));
    });
    childProcess.on("close", (code, signal) => {
      if (code) {
        reject(
          new Error(
            `Command failed with exit code ${code}.\nstdout: ${Buffer.concat(output).toString()}\nstderr: ${Buffer.concat(errOutput).toString()}`,
          ),
        );
      } else if (signal) {
        reject(
          new Error(
            `Command failed with signal ${signal}.\nstdout: ${Buffer.concat(output).toString()}\nstderr: ${Buffer.concat(errOutput).toString()}`,
          ),
        );
      } else {
        resolve(Buffer.concat(output));
      }
    });
  });
}
