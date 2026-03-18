import type { LogEntry } from "./types";

export interface ElidedInfo {
  count: number;
}

function getUniqueChangeId(entry: LogEntry): string {
  return entry.divergent && entry.change_offset ? `${entry.change_id}/${entry.change_offset}` : entry.change_id;
}

export function collapseImmutableEntries(entries: LogEntry[]): {
  entries: LogEntry[];
  elidedMap: Map<string, ElidedInfo>;
} {
  if (entries.length === 0) {
    return { entries: [], elidedMap: new Map() };
  }

  const childrenOf = new Map<string, string[]>();
  const entryById = new Map<string, LogEntry>();

  for (const entry of entries) {
    const id = getUniqueChangeId(entry);
    entryById.set(id, entry);
    for (const parent of entry.parents) {
      const parentId =
        parent.divergent && parent.change_offset ? `${parent.change_id}/${parent.change_offset}` : parent.change_id;
      const existing = childrenOf.get(parentId);
      if (existing) {
        existing.push(id);
      } else {
        childrenOf.set(parentId, [id]);
      }
    }
  }

  const visibleIds = new Set(entries.map(getUniqueChangeId));
  const elidedIds = new Set<string>();

  for (const entry of entries) {
    if (!entry.immutable || entry.current_working_copy || entry.root) {
      continue;
    }

    const id = getUniqueChangeId(entry);
    const children = (childrenOf.get(id) ?? []).filter((cid) => visibleIds.has(cid));

    if (children.length === 0) {
      continue;
    }

    const allChildrenImmutable = children.every((cid) => {
      const child = entryById.get(cid);
      return child && child.immutable && !child.current_working_copy;
    });

    if (allChildrenImmutable) {
      elidedIds.add(id);
    }
  }

  if (elidedIds.size === 0) {
    return { entries, elidedMap: new Map() };
  }

  const result: LogEntry[] = [];
  const elidedMap = new Map<string, ElidedInfo>();
  const idRemapping = new Map<string, string>();
  let elidedCounter = 0;

  let i = 0;
  while (i < entries.length) {
    const entry = entries[i];
    const id = getUniqueChangeId(entry);

    if (!elidedIds.has(id)) {
      result.push(entry);
      i++;
      continue;
    }

    const groupEntries: LogEntry[] = [entries[i]];
    i++;
    while (i < entries.length && elidedIds.has(getUniqueChangeId(entries[i]))) {
      const prevParentIds = new Set(
        groupEntries[groupEntries.length - 1].parents.map((p) =>
          p.divergent && p.change_offset ? `${p.change_id}/${p.change_offset}` : p.change_id,
        ),
      );
      const nextId = getUniqueChangeId(entries[i]);
      if (prevParentIds.has(nextId)) {
        groupEntries.push(entries[i]);
        i++;
      } else {
        break;
      }
    }

    const syntheticId = `__elided_${elidedCounter}`;
    elidedCounter++;

    for (const ge of groupEntries) {
      idRemapping.set(getUniqueChangeId(ge), syntheticId);
    }

    const lastEntry = groupEntries[groupEntries.length - 1];
    const syntheticEntry: LogEntry = {
      change_id: syntheticId,
      change_id_short: syntheticId,
      change_id_shortest: syntheticId,
      commit_id_short: syntheticId,
      immutable: true,
      mine: false,
      empty: true,
      current_working_copy: false,
      root: false,
      conflict: false,
      divergent: false,
      change_offset: "",
      description: `${groupEntries.length} elided`,
      author: lastEntry.author,
      committer: lastEntry.committer,
      diff: { total_added: 0, total_removed: 0, files: [] },
      parents: lastEntry.parents,
      local_bookmarks: [],
      remote_bookmarks: [],
      local_tags: [],
      remote_tags: [],
      working_copies: [],
    };

    result.push(syntheticEntry);
    elidedMap.set(syntheticId, { count: groupEntries.length });
  }

  const remappedResult = result.map((entry) => {
    const needsRemap = entry.parents.some((p) => {
      const pid = p.divergent && p.change_offset ? `${p.change_id}/${p.change_offset}` : p.change_id;
      return idRemapping.has(pid);
    });

    if (!needsRemap) {
      return entry;
    }

    const remappedParents = entry.parents.map((p) => {
      const pid = p.divergent && p.change_offset ? `${p.change_id}/${p.change_offset}` : p.change_id;
      const newId = idRemapping.get(pid);
      if (newId) {
        return { change_id: newId, divergent: false, change_offset: "" };
      }
      return p;
    });

    const seen = new Set<string>();
    const dedupedParents = remappedParents.filter((p) => {
      const pid = p.divergent && p.change_offset ? `${p.change_id}/${p.change_offset}` : p.change_id;
      if (seen.has(pid)) {
        return false;
      }
      seen.add(pid);
      return true;
    });

    return { ...entry, parents: dedupedParents };
  });

  return { entries: remappedResult, elidedMap };
}
