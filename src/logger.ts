import * as vscode from "vscode";

let _outputChannel: vscode.LogOutputChannel | undefined;

export function initLogger(outputChannel: vscode.LogOutputChannel): void {
  _outputChannel = outputChannel;
}

function getChannel(): vscode.LogOutputChannel {
  if (!_outputChannel) {
    throw new Error("Logger not initialized. Call initLogger first.");
  }
  return _outputChannel;
}

export const logger = {
  info(message: string): void {
    getChannel().info(message);
  },
  error(message: string): void {
    getChannel().error(message);
  },
  warn(message: string): void {
    getChannel().warn(message);
  },
  debug(message: string): void {
    getChannel().debug(message);
  },
  trace(message: string): void {
    getChannel().trace(message);
  },
};
