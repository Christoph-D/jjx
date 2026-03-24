export type FileStatusType = "A" | "M" | "D" | "R" | "C" | "X";

export type FileStatus = {
  type: FileStatusType;
  file: string;
  path: string;
  renamedFrom?: string;
};

export interface Change {
  changeId: string;
  commitId: string;
  bookmarks?: string[];
  description: string;
  isEmpty: boolean;
  isConflict: boolean;
  divergent?: boolean;
  changeOffset?: string;
}

export function getRevFromChange(change: Change): string {
  if (change.divergent && change.changeOffset) {
    return `${change.changeId}/${change.changeOffset}`;
  }
  return change.changeId;
}

export interface ChangeWithDetails extends Change {
  author: {
    name: string;
    email: string;
  };
  authoredDate: string;
}

export interface LogEntryFile {
  path: string;
  status_char: FileStatusType;
}

export interface LogEntryLocalRef {
  name: string;
  synced: boolean;
  conflict: boolean;
}

export interface LogEntryRemoteRef {
  name: string;
  remote: string;
}

export interface ParentRef {
  change_id: string;
  divergent: boolean;
  change_offset: string;
}

export interface LogEntry {
  change_id: string;
  change_id_short: string;
  change_id_shortest: string;
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
  diff: {
    total_added: number;
    total_removed: number;
    files: LogEntryFile[];
  };
  parents: ParentRef[];
  local_bookmarks: LogEntryLocalRef[];
  remote_bookmarks: LogEntryRemoteRef[];
  local_tags: LogEntryLocalRef[];
  remote_tags: LogEntryRemoteRef[];
  working_copies: string[];
}

export type RepositoryStatus = {
  fileStatuses: FileStatus[];
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
  tags: string;
  start: string;
  user: string;
  snapshot: boolean;
};
