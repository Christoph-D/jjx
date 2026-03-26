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
  return entry.change_offset ? `${entry.change_id}/${entry.change_offset}` : entry.change_id;
}

function getParentUniqueId(parent: ParentRef): string {
  return parent.change_offset ? `${parent.change_id}/${parent.change_offset}` : parent.change_id;
}

interface AncestryInfo {
  visibleIds: Set<string>;
  parentMap: Map<string, string[]>;
  ancestorOfVisible: Set<string>;
}

function buildAncestryInfo(
  entries: LogEntry[],
  elideImmutableCommits: boolean,
  immutableParentDepth: number,
): AncestryInfo {
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
      (elideImmutableCommits ? !entry.immutable : true) ||
      entry.remote_bookmarks.length > 0 ||
      entry.remote_tags.length > 0;

    if (isVisible) {
      visibleIds.add(id);
    }
  }

  const levels = immutableParentDepth;
  let currentLevel = new Set(mutableIds);
  for (let i = 0; i < levels; i++) {
    const nextLevel = new Set<string>();
    for (const id of currentLevel) {
      const parents = parentMap.get(id);
      if (parents) {
        for (const pid of parents) {
          if (allEntryIds.has(pid)) {
            visibleIds.add(pid);
            nextLevel.add(pid);
          }
        }
      }
    }
    currentLevel = nextLevel;
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

export interface ClassifyEdgesOptions {
  elideImmutableCommits?: boolean;
  numberOfImmutableParentsInLog?: number;
}

export function classifyEdges(
  entries: LogEntry[],
  options?: ClassifyEdgesOptions,
): {
  edges: Map<string, ClassifiedEdge[]>;
  syntheticNodes: Map<string, SyntheticNode>;
  visibleIds: Set<string>;
} {
  const elideImmutableCommits = options?.elideImmutableCommits ?? true;
  const immutableParentDepth = options?.numberOfImmutableParentsInLog ?? 1;
  const edges = new Map<string, ClassifiedEdge[]>();
  const syntheticNodes = new Map<string, SyntheticNode>();
  const { visibleIds, parentMap, ancestorOfVisible } = buildAncestryInfo(
    entries,
    elideImmutableCommits,
    immutableParentDepth,
  );

  const externalEdgesCache = new Map<string, ClassifiedEdge[]>();

  const visibleChildCount = new Map<string, number>();
  for (const entry of entries) {
    const id = getUniqueEntryId(entry);
    if (!visibleIds.has(id)) {
      continue;
    }
    for (const parent of entry.parents) {
      const parentId = getParentUniqueId(parent);
      if (!visibleIds.has(parentId)) {
        visibleChildCount.set(parentId, (visibleChildCount.get(parentId) || 0) + 1);
      }
    }
  }

  for (const entry of entries) {
    const id = getUniqueEntryId(entry);
    const classifiedEdges: ClassifiedEdge[] = [];
    const knownAncestors = new Set<string>();
    const ancestorOfVisibleParentIds = entry.parents
      .map(getParentUniqueId)
      .filter((pid) => !visibleIds.has(pid) && ancestorOfVisible.has(pid));
    const hasMultipleAncestorOfVisibleParents = ancestorOfVisibleParentIds.length > 1;

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
          const indirectEdges = parentEdges.filter((e) => e.edgeType === "indirect");
          const parentIsMerge = (parentMap.get(parentId)?.length ?? 0) > 1;
          const hasMultipleVisibleChildren = (visibleChildCount.get(parentId) ?? 0) > 1;
          if (
            hasMultipleAncestorOfVisibleParents ||
            parentIsMerge ||
            indirectEdges.length > 1 ||
            hasMultipleVisibleChildren
          ) {
            for (const edge of indirectEdges) {
              if (!knownAncestors.has(edge.targetId)) {
                classifiedEdges.push(edge);
                knownAncestors.add(edge.targetId);
              }
            }
          } else {
            if (!knownAncestors.has(parentId)) {
              classifiedEdges.push({ targetId: parentId, edgeType: "direct" });
              knownAncestors.add(parentId);
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

    removeTransitiveEdges(classifiedEdges, parentMap, visibleIds);
    edges.set(id, classifiedEdges);
  }

  for (const [id, classifiedEdges] of edges.entries()) {
    if (!visibleIds.has(id)) {
      continue;
    }
    for (const edge of classifiedEdges) {
      if (!visibleIds.has(edge.targetId) && !syntheticNodes.has(edge.targetId)) {
        const reachableVisible = findReachableVisible(edge.targetId, visibleIds, parentMap);
        syntheticNodes.set(edge.targetId, {
          id: edge.targetId,
          targetId: reachableVisible || edge.targetId,
          edgeType: reachableVisible ? "indirect" : "missing",
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
      removeTransitiveEdges(edges, parentMap, visibleIds);
    }

    cache.set(current, edges);
    stack.pop();
  }

  return cache.get(startId)!;
}

function removeTransitiveEdges(
  edges: ClassifiedEdge[],
  parentMap: Map<string, string[]>,
  visibleIds: Set<string>,
): void {
  const initialTargets = new Set<string>();
  for (const edge of edges) {
    if (edge.edgeType !== "missing") {
      initialTargets.add(edge.targetId);
    }
  }

  const resolvedAncestors = new Map<string, Set<string>>();
  for (const target of initialTargets) {
    if (!visibleIds.has(target)) {
      const ancestors = findVisibleAncestors(target, visibleIds, parentMap);
      resolvedAncestors.set(target, ancestors);
    }
  }

  const unwanted = new Set<string>();
  const work: string[] = [];

  for (const target of initialTargets) {
    if (visibleIds.has(target)) {
      const parents = parentMap.get(target);
      if (parents) {
        work.push(...parents);
      }
    } else {
      const ancestors = resolvedAncestors.get(target);
      if (ancestors) {
        for (const ancestor of ancestors) {
          const parents = parentMap.get(ancestor);
          if (parents) {
            work.push(...parents);
          }
        }
      }
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
    if (edge.edgeType === "missing") {
      continue;
    }

    const target = edge.targetId;
    if (unwanted.has(target)) {
      edges.splice(i, 1);
    } else if (!visibleIds.has(target)) {
      const ancestors = resolvedAncestors.get(target);
      if (ancestors && ancestors.size > 0 && [...ancestors].every((a) => unwanted.has(a))) {
        edges.splice(i, 1);
      }
    }
  }
}

function findVisibleAncestors(startId: string, visibleIds: Set<string>, parentMap: Map<string, string[]>): Set<string> {
  const result = new Set<string>();
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
        result.add(parent);
      } else {
        stack.push(parent);
      }
    }
  }

  return result;
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
  const visibleEntries = entries.filter((e) => visibleIds.has(getUniqueEntryId(e)));

  const updatedEntries = visibleEntries.map((entry) => {
    const entryId = getUniqueEntryId(entry);
    const classifiedEdges = edges.get(entryId);
    if (!classifiedEdges) {
      return entry;
    }
    const newParents = classifiedEdges.map((edge) => {
      const slashIndex = edge.targetId.indexOf("/");
      if (slashIndex !== -1) {
        return {
          change_id: edge.targetId.substring(0, slashIndex),
          divergent: false,
          change_offset: edge.targetId.substring(slashIndex + 1),
        };
      }
      return { change_id: edge.targetId, divergent: false, change_offset: "" };
    });
    return { ...entry, parents: newParents };
  });

  if (syntheticNodes.size === 0) {
    return updatedEntries;
  }

  const entryIds = new Set(updatedEntries.map(getUniqueEntryId));
  const result = [...updatedEntries];
  const insertedAtRow = new Map<string, number>();

  for (let i = updatedEntries.length - 1; i >= 0; i--) {
    const entry = updatedEntries[i];
    const entryId = getUniqueEntryId(entry);
    const classifiedEdges = edges.get(entryId) || [];

    const syntheticNodesForEntry: SyntheticNode[] = [];
    for (const edge of classifiedEdges) {
      if (!visibleIds.has(edge.targetId)) {
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
    hidden: false,
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
