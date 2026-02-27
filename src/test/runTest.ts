import path from "path";
import fs from "fs/promises";
import os from "os";
import { spawn, execSync } from "child_process";

import { runTests } from "@vscode/test-electron";
import { execJJPromise } from "./utils";

async function main() {
  let xvfb: ReturnType<typeof spawn> | null = null;

  try {
    // Start Xvfb for headless rendering if in a container/CI environment
    const displayNum = 99;
    const display = `:${displayNum}`;

    // Check if Xvfb is available
    try {
      execSync("which Xvfb", { stdio: "ignore" });

      // Start Xvfb
      xvfb = spawn("Xvfb", [display, "-screen", "0", "1024x768x24"], {
        stdio: "ignore",
      });

      // Wait a moment for Xvfb to start
      await new Promise((resolve) => setTimeout(resolve, 500));

      console.log(`Started Xvfb on display ${display}`);
    } catch {
      console.log("Xvfb not available, using existing display");
    }

    // The folder containing the Extension Manifest package.json
    // Passed to `--extensionDevelopmentPath`
    const extensionDevelopmentPath = path.resolve(__dirname, "../../");

    // The path to the extension test runner script (output from esbuild)
    // Passed to --extensionTestsPath
    const extensionTestsPath = path.resolve(__dirname, "./runner.js");

    const testRepoPath = await fs.mkdtemp(path.join(os.tmpdir(), "jjk-test-"));

    console.log(`Creating test repo in ${testRepoPath}`);
    await execJJPromise("init --git", {
      cwd: testRepoPath,
    });

    // Download VS Code, unzip it and run the integration test
    await runTests({
      extensionDevelopmentPath,
      extensionTestsPath,
      launchArgs: [testRepoPath, "--disable-gpu"],
      extensionTestsEnv: {
        ...process.env,
        DISPLAY: xvfb ? display : process.env.DISPLAY,
        ELECTRON_RUN_AS_NODE: undefined,
      },
      reuseMachineInstall: true,
    });
  } catch (err) {
    console.error(err);
    console.error("Failed to run tests");
    process.exit(1);
  } finally {
    if (xvfb) {
      xvfb.kill();
    }
  }
}

void main();
