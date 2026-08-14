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
};

/**
 * Per-file diff data of a commit for the Split view: the file's status in the
 * commit's diff plus the base64-encoded left (parent) and right (commit)
 * contents captured via the `jjx-vscode-diff` diff tool.
 */
export interface SplitFileEntry {
  status: FileStatusType;
  // Absolute path of the file on the right side of the diff
  // (the post-rename path for renames/copies).
  path: string;
  // Repo-relative source path, set for renames (`R`) and copies (`C`).
  renamedFrom?: string;
  // True when either side's content is not decodable UTF-8 text.
  binary: boolean;
  // True when the file is conflicted in the commit; both sides then contain
  // jj's materialized conflict markers.
  conflict: boolean;
  // Base64-encoded left (parent) content; undefined when the file was added.
  leftBase64?: string;
  // Base64-encoded right (commit) content; undefined when the file was deleted.
  rightBase64?: string;
  // Decoded left text, ready for hunk splitting; undefined for binary files
  // and files absent on the left side.
  leftText?: string;
  // Decoded right text, ready for hunk splitting; undefined for binary files
  // and files absent on the right side.
  rightText?: string;
}

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
