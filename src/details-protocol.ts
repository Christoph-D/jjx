import type { ChangeDetails } from "./types";
import type { FileStatusType } from "./types";

export type DetailsWebviewToExtensionMessage =
  | { command: "webviewReady" }
  // `commitId` pins the revision the file belongs to; `shortChangeId` is the preformatted
  // label used in editor titles. `currentWorkingCopy` mirrors the graph view's behavior of
  // opening the live file for the working-copy change.
  | {
      command: "openFileDiff";
      commitId: string;
      shortChangeId: string;
      path: string;
      status: FileStatusType;
      renamedFrom?: string;
    }
  | {
      command: "openFileAtRevision";
      commitId: string;
      shortChangeId: string;
      currentWorkingCopy: boolean;
      path: string;
    }
  | { command: "openFileInWorkingCopy"; path: string }
  | { command: "copyPath"; path: string }
  | { command: "copyRelativePath"; path: string }
  | { command: "copyId"; id: string }
  | { command: "reportError"; message: string; stack?: string }
  | { command: "showWarning"; message: string };

export type DetailsExtensionToWebviewMessage =
  // Nothing (or nothing resolvable) is selected in the graph view.
  { command: "showNoSelection" } | { command: "updateDetails"; change: ChangeDetails } | { command: "showErrorState" };
