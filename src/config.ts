import path from "path";
import * as vscode from "vscode";
import * as os from "os";
import which from "which";

export let extensionDir = "";
export let fakeEditorPath = "";

export function initExtensionDir(extensionUri: vscode.Uri) {
  extensionDir = vscode.Uri.joinPath(
    extensionUri,
    extensionUri.fsPath.includes("extensions") ? "dist" : "src",
  ).fsPath;

  const config = vscode.workspace.getConfiguration("jjk");
  const customPath = config.get<string | null>("fakeEditorPath");
  if (customPath !== null && customPath !== undefined) {
    fakeEditorPath = customPath;
    return;
  }

  const fakeEditorExecutables: {
    [platform in typeof process.platform]?: {
      [arch in typeof process.arch]?: string;
    };
  } = {
    freebsd: {
      arm: "fakeeditor_linux_arm",
      arm64: "fakeeditor_linux_aarch64",
      x64: "fakeeditor_linux_x86_64",
    },
    netbsd: {
      arm: "fakeeditor_linux_arm",
      arm64: "fakeeditor_linux_aarch64",
      x64: "fakeeditor_linux_x86_64",
    },
    openbsd: {
      arm: "fakeeditor_linux_arm",
      arm64: "fakeeditor_linux_aarch64",
      x64: "fakeeditor_linux_x86_64",
    },
    linux: {
      arm: "fakeeditor_linux_arm",
      arm64: "fakeeditor_linux_aarch64",
      x64: "fakeeditor_linux_x86_64",
    },
    win32: {
      arm64: "fakeeditor_windows_aarch64.exe",
      x64: "fakeeditor_windows_x86_64.exe",
    },
    darwin: {
      arm64: "fakeeditor_macos_aarch64",
      x64: "fakeeditor_macos_x86_64",
    },
  };

  const fakeEditorExecutableName =
    fakeEditorExecutables[process.platform]?.[process.arch];
  if (fakeEditorExecutableName) {
    fakeEditorPath = path.join(
      extensionDir,
      "fakeeditor",
      "zig-out",
      "bin",
      fakeEditorExecutableName,
    );
  }
}

export function getConfigArgs(extensionDir: string): string[] {
  const configPath = path.join(extensionDir, "config.toml");
  return ["--config-file", configPath];
}

/**
 * If jjk.commandTimeout is set, returns that value.
 * Otherwise, returns the provided default timeout, or 30 seconds if no default is provided.
 */
export function getCommandTimeout(
  repositoryRoot: string,
  defaultTimeout: number | undefined,
): number {
  const config = vscode.workspace.getConfiguration(
    "jjk",
    vscode.Uri.file(repositoryRoot),
  );
  const configuredTimeout = config.get<number | null>("commandTimeout");
  if (configuredTimeout !== null && configuredTimeout !== undefined) {
    return configuredTimeout;
  }
  return defaultTimeout ?? 30000;
}

/**
 * Returns ["--ignore-working-copy"] if the setting is enabled, otherwise returns an empty array.
 * This allows the flag to be conditionally included using the spread operator.
 */
export function getIgnoreWorkingCopyArgs(repositoryRoot: string): string[] {
  const config = vscode.workspace.getConfiguration(
    "jjk",
    vscode.Uri.file(repositoryRoot),
  );
  const ignoreWorkingCopy = config.get<boolean>("ignoreWorkingCopy");
  if (ignoreWorkingCopy) {
    return ["--ignore-working-copy"];
  }
  return [];
}

/**
 * Gets the configured jj executable path from settings.
 * If no path is configured, searches through common installation paths before falling back to "jj".
 */
export async function getJJPath(
  workspaceFolder: string,
): Promise<{ filepath: string; source: "configured" | "path" | "common" }> {
  const config = vscode.workspace.getConfiguration(
    "jjk",
    workspaceFolder !== undefined
      ? vscode.Uri.file(workspaceFolder)
      : undefined,
  );
  const configuredPath = config.get<string>("jjPath");

  if (configuredPath) {
    if (await which(configuredPath, { nothrow: true })) {
      return { filepath: configuredPath, source: "configured" };
    } else {
      throw new Error(
        `Configured jjk.jjPath is not an executable file: ${configuredPath}`,
      );
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
