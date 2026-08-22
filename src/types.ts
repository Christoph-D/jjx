export type FileStatusType = "A" | "M" | "D" | "R" | "C" | "X" | "?";

export type FullChangeId = string & { readonly __brand: "FullChangeId" };

export interface ChangeId {
  // Internal only: A full-length change ID.
  // This ID is meant to be used in jj commands
  // and to identify a change across different parts of the extension.
  // It is not meant to be human-readable; it's too long.
  // The format is <changeid>/<offset> or <changeid> without
  // an offset, depending on whether jj provides an offset.
  // An offset may be present here even if changeOffset is null.
  changeId: FullChangeId;

  // UI only: The shortest unique change ID. Can be shown to the user.
  changeIdPrefix: string;

  // UI Only: Optional suffix to get multiple change IDs to the
  // same visual length. If used, must be appended to changeIdPrefix.
  changeIdSuffix: string;

  // UI only: If present, the offset must be appended when showing
  // this change ID to the user because the change is divergent.
  changeOffset: string | null;
}

export type FileStatus = {
  type: FileStatusType;
  file: string;
  path: string;
  renamedFrom?: string;
  // True when the file is listed in the change's conflicted files, even if it
  // also has a regular diff entry (e.g. in merges). Synthesized conflict
  // ("X") entries always carry this flag.
  isConflict?: boolean;
};

export interface Change {
  changeId: ChangeId;
  commitId: string;
  bookmarks?: string[];
  description: string;
  isEmpty: boolean;
  isConflict: boolean;
  divergent?: boolean;
}

export interface ChangeWithDetails extends Change {
  author: {
    name: string;
    email: string;
  };
  authoredDate: string;
}

import type { LogEntryLocalRef, LogEntryRemoteRef } from "./graph-protocol";
export type { LogEntryLocalRef, LogEntryRemoteRef };

export interface ParentRef {
  change_id: string;
  divergent: boolean;
  change_offset: string;
}

export interface DiffFileEntry {
  status_char: string;
  source_path: string;
  target_path: string;
  is_conflict: boolean;
}

export interface LogEntry {
  change_id: string;
  change_id_short: string;
  change_id_shortest: string;
  commit_id: string;
  commit_id_short: string;
  immutable: boolean;
  mine: boolean;
  empty: boolean;
  current_working_copy: boolean;
  root: boolean;
  conflict: boolean;
  divergent: boolean;
  hidden: boolean;
  change_offset: string;
  description: string;
  author: {
    name: string;
    email: string;
    timestamp: string;
  };
  committer: {
    name: string;
    email: string;
    timestamp: string;
  };
  parents: ParentRef[];
  local_bookmarks: LogEntryLocalRef[];
  remote_bookmarks: LogEntryRemoteRef[];
  local_tags: LogEntryLocalRef[];
  remote_tags: LogEntryRemoteRef[];
  working_copies: string[];
  diff_files?: DiffFileEntry[];
  conflicted_files?: string[];
  fileStatuses?: FileStatus[];
}

export type RepositoryStatus = {
  fileStatuses: FileStatus[];
  untrackedFiles: FileStatus[];
  workingCopy: Change;
  parentChanges: Change[];
  conflictedFiles: Set<string>;
};

export type Show = {
  change: ChangeWithDetails;
  fileStatuses: FileStatus[];
  conflictedFiles: Set<string>;
};

export type Operation = {
  id: string;
  description: string;
  attributes: string;
  start: string;
  user: string;
  snapshot: boolean;
};
