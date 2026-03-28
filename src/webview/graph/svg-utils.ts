import { CHANGE_ID_RIGHT_PADDING, SWIMLANE_WIDTH, colorRegistry } from "./types";
import { changeIdHorizontalOffset } from "./signals";

export function getLaneColor(colorIndex: number): string {
  return colorRegistry[colorIndex % colorRegistry.length];
}

export function getLaneX(laneIndex: number): number {
  return changeIdHorizontalOffset.value + CHANGE_ID_RIGHT_PADDING + SWIMLANE_WIDTH * (laneIndex + 1);
}
