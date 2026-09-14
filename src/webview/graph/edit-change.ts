import type { RegularChangeNode } from "../../graph-protocol";
import { changeDoubleClickAction, postMessage } from "./signals";

/**
 * A double click action on a change. The behavior depends on the double action config value.
 * Returns whether a message was sent to the extension host.
 */
export function editChange(change: RegularChangeNode): boolean {
  if (change.currentWorkingCopy && (changeDoubleClickAction.value !== "new" || change.isEmpty)) {
    return false;
  }
  postMessage({ command: "editChange", changeId: change.id.changeId });
  return true;
}
