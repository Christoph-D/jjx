export interface VSCodeAPI {
  postMessage(message: unknown): void;
}

export const rootChangeId = "z".repeat(32);
export const SWIMLANE_WIDTH = 14;
export const CIRCLE_RADIUS = 5;
export const EDGE_EXTENSION = 20;
export const CHANGE_ID_RIGHT_PADDING = 6;

export const colorRegistry = [
  "rgba(from var(--vscode-charts-blue) r g b / 100%)",
  "rgba(from var(--vscode-charts-purple) r g b / 100%)",
  "rgba(from var(--vscode-charts-orange) r g b / 100%)",
  "rgba(from var(--vscode-charts-green) r g b / 100%)",
  "rgba(from var(--vscode-charts-red) r g b / 100%)",
];
