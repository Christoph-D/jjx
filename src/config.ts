import path from "path";
import * as vscode from "vscode";
import * as os from "os";
import which from "which";
import { TIMEOUTS } from "./constants";

export let extensionDir = "";

export function initExtensionDir(extensionUri: vscode.Uri) {
  extensionDir = vscode.Uri.joinPath(extensionUri, extensionUri.fsPath.includes("extensions") ? "dist" : "src").fsPath;
}

export function getConfigArgs(extensionDir: string): string[] {
  const configPath = path.join(extensionDir, "config.toml");
  return ["--config-file", configPath];
}

/**
 * If jjx.commandTimeout is set, returns that value.
 * Otherwise, returns the provided default timeout, or 30 seconds if no default is provided.
 */
export function getCommandTimeout(repositoryRoot: string, defaultTimeout: number | undefined): number {
  if (defaultTimeout === 0) {
    return 0;
  }
  const config = vscode.workspace.getConfiguration("jjx", vscode.Uri.file(repositoryRoot));
  const configuredTimeout = config.get<number | null>("commandTimeout");
  if (configuredTimeout !== null && configuredTimeout !== undefined) {
    return configuredTimeout;
  }
  return defaultTimeout ?? TIMEOUTS.FALLBACK;
}

/**
 * Gets the configured jj executable path from settings.
 * If no path is configured, searches through common installation paths before falling back to "jj".
 */
export async function getJJPath(
  workspaceFolder: string,
): Promise<{ filepath: string; source: "configured" | "path" | "common" }> {
  const config = vscode.workspace.getConfiguration(
    "jjx",
    workspaceFolder !== undefined ? vscode.Uri.file(workspaceFolder) : undefined,
  );
  const configuredPath = config.get<string>("jjPath");

  if (configuredPath) {
    if (await which(configuredPath, { nothrow: true })) {
      return { filepath: configuredPath, source: "configured" };
    } else {
      throw new Error(`Configured jjx.jjPath is not an executable file: ${configuredPath}`);
    }
  }

  const jjInPath = await which("jj", { nothrow: true });
  if (jjInPath) {
    return { filepath: jjInPath, source: "path" };
  }

  // It's particularly important to check common locations on MacOS because of https://github.com/microsoft/vscode/issues/30847#issuecomment-420399383
  const commonPaths = [
    path.join(os.homedir(), ".cargo", "bin", "jj"),
    path.join(os.homedir(), ".cargo", "bin", "jj.exe"),
    path.join(os.homedir(), ".nix-profile", "bin", "jj"),
    path.join(os.homedir(), ".local", "bin", "jj"),
    path.join(os.homedir(), "bin", "jj"),
    "/usr/bin/jj",
    "/home/linuxbrew/.linuxbrew/bin/jj",
    "/usr/local/bin/jj",
    "/opt/homebrew/bin/jj",
    "/opt/local/bin/jj",
  ];

  for (const commonPath of commonPaths) {
    const jjInCommonPath = await which(commonPath, { nothrow: true });
    if (jjInCommonPath) {
      return { filepath: jjInCommonPath, source: "common" };
    }
  }

  throw new Error(`jj CLI not found in PATH nor in common locations.`);
}

export function getLogRevset(): string {
  return `connected(present(@) | ancestors(immutable_heads()..) | trunk())`;
}

export function getElidedVisibleImmutableParents(repositoryRoot: string): number {
  const config = vscode.workspace.getConfiguration("jjx", vscode.Uri.file(repositoryRoot));
  return config.get<number>("elidedVisibleImmutableParents") ?? 1;
}
