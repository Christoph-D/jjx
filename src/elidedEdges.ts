import type { LogEntry, ParentRef } from "./types";

export type GraphEdgeType = "direct" | "indirect" | "missing";

export interface ClassifiedEdge {
  targetId: string;
  edgeType: GraphEdgeType;
}

export interface SyntheticNode {
  id: string;
  targetId: string;
  edgeType: GraphEdgeType;
}

function getUniqueEntryId(entry: LogEntry): string {
  return entry.divergent && entry.change_offset ? `${entry.change_id}/${entry.change_offset}` : entry.change_id;
}

function getParentUniqueId(parent: ParentRef): string {
  return parent.divergent && parent.change_offset ? `${parent.change_id}/${parent.change_offset}` : parent.change_id;
}

interface AncestryInfo {
  visibleIds: Set<string>;
  parentMap: Map<string, string[]>;
  ancestorOfVisible: Set<string>;
}

function buildAncestryInfo(entries: LogEntry[]): AncestryInfo {
  const visibleIds = new Set<string>();
  const parentMap = new Map<string, string[]>();
  const allParents = new Set<string>();
  const allEntryIds = new Set<string>();
  const mutableIds = new Set<string>();

  for (const entry of entries) {
    const id = getUniqueEntryId(entry);
    allEntryIds.add(id);

    const parentIds = entry.parents.map(getParentUniqueId);
    parentMap.set(id, parentIds);

    for (const pid of parentIds) {
      allParents.add(pid);
    }

    if (!entry.immutable) {
      mutableIds.add(id);
    }

    const isVisible =
      entry.current_working_copy ||
      entry.working_copies.length > 0 ||
      !entry.immutable ||
      entry.remote_bookmarks.length > 0 ||
      entry.remote_tags.length > 0;

    if (isVisible) {
      visibleIds.add(id);
    }
  }

  for (const mutableId of mutableIds) {
    const parents = parentMap.get(mutableId);
    if (parents) {
      for (const pid of parents) {
        if (allEntryIds.has(pid)) {
          visibleIds.add(pid);
        }
      }
    }
  }

  const ancestorOfVisible = new Set<string>();
  for (const pid of allParents) {
    if (!visibleIds.has(pid)) {
      if (canReachVisible(pid, visibleIds, parentMap)) {
        ancestorOfVisible.add(pid);
      }
    }
  }

  return { visibleIds, parentMap, ancestorOfVisible };
}

function canReachVisible(startId: string, visibleIds: Set<string>, parentMap: Map<string, string[]>): boolean {
  const visited = new Set<string>();
  const stack = [startId];

  while (stack.length > 0) {
    const current = stack.pop()!;
    if (visited.has(current)) {
      continue;
    }
    visited.add(current);

    const parents = parentMap.get(current);
    if (!parents) {
      continue;
    }

    for (const parent of parents) {
      if (visibleIds.has(parent)) {
        return true;
      }
      if (!visited.has(parent)) {
        stack.push(parent);
      }
    }
  }

  return false;
}

export function classifyEdges(entries: LogEntry[]): {
  edges: Map<string, ClassifiedEdge[]>;
  syntheticNodes: Map<string, SyntheticNode>;
  visibleIds: Set<string>;
} {
  const edges = new Map<string, ClassifiedEdge[]>();
  const syntheticNodes = new Map<string, SyntheticNode>();
  const { visibleIds, parentMap, ancestorOfVisible } = buildAncestryInfo(entries);

  const externalEdgesCache = new Map<string, ClassifiedEdge[]>();

  for (const entry of entries) {
    const id = getUniqueEntryId(entry);
    const classifiedEdges: ClassifiedEdge[] = [];
    const knownAncestors = new Set<string>();

    for (const parent of entry.parents) {
      const parentId = getParentUniqueId(parent);

      if (visibleIds.has(parentId)) {
        if (!knownAncestors.has(parentId)) {
          classifiedEdges.push({ targetId: parentId, edgeType: "direct" });
          knownAncestors.add(parentId);
        }
      } else if (ancestorOfVisible.has(parentId)) {
        const parentEdges = resolveExternalEdges(parentId, visibleIds, parentMap, externalEdgesCache);
        if (parentEdges.every((e) => e.edgeType === "missing")) {
          if (!knownAncestors.has(parentId)) {
            classifiedEdges.push({ targetId: parentId, edgeType: "missing" });
            knownAncestors.add(parentId);
          }
        } else {
          for (const edge of parentEdges) {
            if (!knownAncestors.has(edge.targetId)) {
              classifiedEdges.push(edge);
              knownAncestors.add(edge.targetId);
            }
          }
        }
      } else {
        if (!knownAncestors.has(parentId)) {
          classifiedEdges.push({ targetId: parentId, edgeType: "missing" });
          knownAncestors.add(parentId);
        }
      }
    }

    removeTransitiveEdges(classifiedEdges, parentMap);
    edges.set(id, classifiedEdges);
  }

  for (const [id, classifiedEdges] of edges.entries()) {
    if (!visibleIds.has(id)) {
      continue;
    }
    for (const edge of classifiedEdges) {
      if (edge.edgeType !== "direct" && !syntheticNodes.has(edge.targetId)) {
        const reachableVisible = findReachableVisible(edge.targetId, visibleIds, parentMap);
        syntheticNodes.set(edge.targetId, {
          id: edge.targetId,
          targetId: reachableVisible || edge.targetId,
          edgeType: edge.edgeType,
        });
      }
    }
  }

  return { edges, syntheticNodes, visibleIds };
}

function resolveExternalEdges(
  startId: string,
  visibleIds: Set<string>,
  parentMap: Map<string, string[]>,
  cache: Map<string, ClassifiedEdge[]>,
): ClassifiedEdge[] {
  if (cache.has(startId)) {
    return cache.get(startId)!;
  }

  const stack: string[] = [startId];
  while (stack.length > 0) {
    const current = stack[stack.length - 1];

    if (cache.has(current)) {
      stack.pop();
      continue;
    }

    const parents = parentMap.get(current);
    if (!parents) {
      cache.set(current, [{ targetId: current, edgeType: "missing" }]);
      stack.pop();
      continue;
    }

    let allParentsResolved = true;
    for (const parent of parents) {
      if (visibleIds.has(parent) || cache.has(parent) || !parentMap.has(parent)) {
        continue;
      }
      if (!cache.has(parent)) {
        stack.push(parent);
        allParentsResolved = false;
      }
    }

    if (!allParentsResolved) {
      continue;
    }

    const edges: ClassifiedEdge[] = [];
    const knownTargets = new Set<string>();
    for (const parent of parents) {
      if (visibleIds.has(parent)) {
        if (!knownTargets.has(parent)) {
          edges.push({ targetId: parent, edgeType: "indirect" });
          knownTargets.add(parent);
        }
      } else if (cache.has(parent)) {
        const parentEdges = cache.get(parent)!;
        if (parentEdges.every((e) => e.edgeType === "missing")) {
          if (!knownTargets.has(parent)) {
            edges.push({ targetId: parent, edgeType: "missing" });
            knownTargets.add(parent);
          }
        } else {
          for (const edge of parentEdges) {
            if (!knownTargets.has(edge.targetId)) {
              edges.push({ ...edge });
              knownTargets.add(edge.targetId);
            }
          }
        }
      } else {
        if (!knownTargets.has(parent)) {
          edges.push({ targetId: parent, edgeType: "missing" });
          knownTargets.add(parent);
        }
      }
    }

    if (parents.length > 1) {
      removeTransitiveEdges(edges, parentMap);
    }

    cache.set(current, edges);
    stack.pop();
  }

  return cache.get(startId)!;
}

function removeTransitiveEdges(edges: ClassifiedEdge[], parentMap: Map<string, string[]>): void {
  if (!edges.some((e) => e.edgeType === "indirect")) {
    return;
  }

  const initialTargets = new Set<string>();
  for (const edge of edges) {
    if (edge.edgeType !== "missing") {
      initialTargets.add(edge.targetId);
    }
  }

  const unwanted = new Set<string>();
  const work: string[] = [];

  for (const target of initialTargets) {
    const parents = parentMap.get(target);
    if (parents) {
      work.push(...parents);
    }
  }

  while (work.length > 0) {
    const pos = work.pop()!;
    if (unwanted.has(pos)) {
      continue;
    }
    unwanted.add(pos);
    if (initialTargets.has(pos)) {
      continue;
    }

    const parents = parentMap.get(pos);
    if (!parents) {
      continue;
    }

    work.push(...parents);
  }

  for (let i = edges.length - 1; i >= 0; i--) {
    const edge = edges[i];
    if (edge.edgeType !== "missing" && unwanted.has(edge.targetId)) {
      edges.splice(i, 1);
    }
  }
}

function findReachableVisible(
  startId: string,
  visibleIds: Set<string>,
  parentMap: Map<string, string[]>,
): string | null {
  const visited = new Set<string>();
  const stack = [startId];

  while (stack.length > 0) {
    const current = stack.pop()!;
    if (visited.has(current)) {
      continue;
    }
    visited.add(current);

    const parents = parentMap.get(current);
    if (!parents) {
      continue;
    }

    for (const parent of parents) {
      if (visibleIds.has(parent)) {
        return parent;
      }
      if (!visited.has(parent)) {
        stack.push(parent);
      }
    }
  }

  return null;
}

export function insertSyntheticNodes(
  entries: LogEntry[],
  syntheticNodes: Map<string, SyntheticNode>,
  edges: Map<string, ClassifiedEdge[]>,
  visibleIds: Set<string>,
): LogEntry[] {
  if (syntheticNodes.size === 0) {
    return entries.filter((e) => visibleIds.has(getUniqueEntryId(e)));
  }

  const visibleEntries = entries.filter((e) => visibleIds.has(getUniqueEntryId(e)));
  const entryIds = new Set(visibleEntries.map(getUniqueEntryId));
  const result = [...visibleEntries];
  const insertedAtRow = new Map<string, number>();

  const syntheicEntriesByTarget = new Map<string, SyntheticNode[]>();
  for (const node of syntheticNodes.values()) {
    const existing = syntheicEntriesByTarget.get(node.targetId) || [];
    existing.push(node);
    syntheicEntriesByTarget.set(node.targetId, existing);
  }

  for (let i = visibleEntries.length - 1; i >= 0; i--) {
    const entry = visibleEntries[i];
    const entryId = getUniqueEntryId(entry);
    const classifiedEdges = edges.get(entryId) || [];

    const syntheticNodesForEntry: SyntheticNode[] = [];
    for (const edge of classifiedEdges) {
      if (edge.edgeType !== "direct") {
        const synthNode = syntheticNodes.get(edge.targetId);
        if (synthNode) {
          syntheticNodesForEntry.push(synthNode);
        }
      }
    }

    if (syntheticNodesForEntry.length > 0) {
      const insertIndex = i + 1;

      for (const synthNode of syntheticNodesForEntry) {
        if (!entryIds.has(synthNode.id) && !insertedAtRow.has(synthNode.id)) {
          const syntheticEntry = createSyntheticEntry(synthNode);
          result.splice(insertIndex, 0, syntheticEntry);
          insertedAtRow.set(synthNode.id, insertIndex);
          entryIds.add(synthNode.id);
        }
      }
    }
  }

  return result;
}

function createSyntheticEntry(node: SyntheticNode): LogEntry {
  const parents: ParentRef[] =
    node.edgeType === "indirect" ? [{ change_id: node.targetId, divergent: false, change_offset: "" }] : [];

  return {
    change_id: node.id,
    change_id_short: "",
    change_id_shortest: "",
    commit_id_short: "",
    immutable: true,
    mine: false,
    empty: true,
    current_working_copy: false,
    root: false,
    conflict: false,
    divergent: false,
    change_offset: "",
    description: "",
    author: { name: "", email: "", timestamp: "" },
    committer: { name: "", email: "", timestamp: "" },
    diff: { total_added: 0, total_removed: 0, files: [] },
    parents,
    local_bookmarks: [],
    remote_bookmarks: [],
    local_tags: [],
    remote_tags: [],
    working_copies: [],
  };
}

export { getUniqueEntryId, getParentUniqueId };
