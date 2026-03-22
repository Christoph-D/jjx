import path from "path";
import fs from "fs/promises";
import os from "os";
import { spawn, execSync } from "child_process";

import { runTests } from "@vscode/test-electron";
import { execJJPromise } from "./utils";

async function main() {
  const displayNum = 99;
  const display = `:${displayNum}`;

  execSync("which Xvfb", { stdio: "ignore" });

  const xvfb = spawn("Xvfb", [display, "-screen", "0", "1024x768x24"], {
    stdio: "ignore",
  });

  await new Promise((resolve) => setTimeout(resolve, 500));

  console.log(`Started Xvfb on display ${display}`);

  try {
    // The folder containing the Extension Manifest package.json
    // Passed to `--extensionDevelopmentPath`
    const extensionDevelopmentPath = path.resolve(__dirname, "../../");

    // The path to the extension test runner script (output from esbuild)
    // Passed to --extensionTestsPath
    const extensionTestsPath = path.resolve(__dirname, "./runner.js");

    const testRepoPath = await fs.mkdtemp(path.join(os.tmpdir(), "jjx-test-"));

    console.log(`Creating test repo in ${testRepoPath}`);
    await execJJPromise("git init", {
      cwd: testRepoPath,
    });

    // Download VS Code, unzip it and run the integration test
    await runTests({
      extensionDevelopmentPath,
      extensionTestsPath,
      launchArgs: [testRepoPath, "--disable-gpu"],
      extensionTestsEnv: {
        ...process.env,
        DISPLAY: display,
        ELECTRON_RUN_AS_NODE: undefined,
      },
      reuseMachineInstall: true,
    });
  } catch (err) {
    console.error(err);
    console.error("Failed to run tests");
    process.exit(1);
  } finally {
    xvfb.kill();
  }
}

void main();
