import type { LogEntry, ParentRef } from "./types";
import type { LaneNode, LaneEdge, ChangeIdGraph } from "./graph-protocol";
export type { LaneNode, LaneEdge, ChangeIdGraph };

const colorRegistryLength = 5;

function rot(n: number, length: number): number {
  return ((n % length) + length) % length;
}

interface LaneInfo {
  targetId: string | null;
  colorIndex: number;
}

function getParentUniqueId(parent: ParentRef): string {
  return parent.change_offset ? `${parent.change_id}/${parent.change_offset}` : parent.change_id;
}

interface NormalizedEntry {
  changeId: string;
  parentIds: string[];
}

function normalizeEntries(entries: LogEntry[]): NormalizedEntry[] {
  return entries.map((entry) => ({
    changeId: entry.change_offset ? `${entry.change_id}/${entry.change_offset}` : entry.change_id,
    parentIds: entry.parents.map(getParentUniqueId),
  }));
}

export function assignLanes(entries: LogEntry[]): ChangeIdGraph {
  const normalized = normalizeEntries(entries);
  const result: ChangeIdGraph = { nodes: [], edges: [] };
  const lanesByRow: LaneInfo[][] = [[]];
  let colorIndex = 0;
  const nodeToRow: Record<string, number> = {};

  // We're working with a partial jj log, so some parent changes could be outside the visible set.
  const visibleChangeIds = new Set<string>();
  for (const norm of normalized) {
    visibleChangeIds.add(norm.changeId);
  }

  // Compute nodes
  for (let idx = 0; idx < normalized.length; idx++) {
    const norm = normalized[idx];
    const lanes = lanesByRow[lanesByRow.length - 1].map((l) => ({
      ...l,
    }));
    let numLanesActiveVisually = lanes.length;
    let nodeLane = lanes.findIndex((l) => l.targetId === norm.changeId);
    let color: number;
    if (nodeLane === -1) {
      color = rot(colorIndex, colorRegistryLength);
      colorIndex++;

      nodeLane = lanes.findIndex((l) => l.targetId === null);
      if (nodeLane === -1) {
        nodeLane = lanes.length;
        numLanesActiveVisually++;
      }
    } else {
      color = lanes[nodeLane].colorIndex;
    }

    if (norm.parentIds.length > 0) {
      const firstParent = norm.parentIds[0];
      const firstParentAlreadyTracked = lanes.some((l, i) => i !== nodeLane && l.targetId === firstParent);
      lanes[nodeLane] = {
        targetId: firstParentAlreadyTracked ? null : firstParent,
        colorIndex: color,
      };
    } else {
      lanes[nodeLane] = {
        targetId: null,
        colorIndex: color,
      };
    }

    for (const parentId of norm.parentIds) {
      const existingIndex = lanes.findIndex((l) => l.targetId === parentId);
      if (existingIndex === -1) {
        const nullSlot = lanes.findIndex((l) => l.targetId === null);
        const newLane: LaneInfo = {
          targetId: parentId,
          colorIndex: rot(colorIndex, colorRegistryLength),
        };
        colorIndex++;
        if (nullSlot !== -1) {
          lanes[nullSlot] = newLane;
        } else {
          lanes.push(newLane);
        }
      }
    }

    // Close lanes for this change ID
    for (let i = 0; i < lanes.length; i++) {
      if (i !== nodeLane && lanes[i].targetId === norm.changeId) {
        lanes[i] = {
          targetId: null,
          colorIndex: lanes[i].colorIndex,
        };
      }
    }

    // Deduplicate: if multiple lanes target the same ID, keep only the first
    const seenTargets = new Set<string>();
    for (let i = 0; i < lanes.length; i++) {
      const tid = lanes[i].targetId;
      if (tid !== null) {
        if (seenTargets.has(tid)) {
          lanes[i] = { targetId: null, colorIndex: lanes[i].colorIndex };
        } else {
          seenTargets.add(tid);
        }
      }
    }

    while (lanes.length > 0 && lanes[lanes.length - 1].targetId === null) {
      lanes.pop();
    }

    const n = result.nodes.push({
      changeId: norm.changeId,
      lane: nodeLane,
      colorIndex: color,
      numLanesActiveVisually,
    });
    nodeToRow[norm.changeId] = n - 1;
    lanesByRow.push(lanes);
  }

  // Compute edges
  for (let i = 0; i < result.nodes.length; i++) {
    const node = result.nodes[i];
    const norm = normalized[i];

    let firstParent = true;
    for (const parentId of norm.parentIds) {
      const isVisible = visibleChangeIds.has(parentId);
      const parentRow = isVisible ? nodeToRow[parentId] : result.nodes.length;
      const endRow = isVisible ? parentRow : result.nodes.length;

      const lanePath: number[] = [];
      for (let j = i; j <= endRow; j++) {
        const lane = j === i ? node.lane : lanesByRow[j].findIndex((l) => l.targetId === parentId);
        lanePath.push(lane);
      }

      const parentColorIndex = isVisible
        ? result.nodes[parentRow].colorIndex
        : (lanesByRow[i].find((l) => l.targetId === parentId)?.colorIndex ?? rot(colorIndex, colorRegistryLength));

      result.edges.push({
        fromRow: i,
        toRow: parentRow,
        lanePath,
        fromId: norm.changeId,
        toId: parentId,
        colorIndex: firstParent ? node.colorIndex : parentColorIndex,
        extendsToBottom: !isVisible,
      });
      firstParent = false;
    }
  }

  return result;
}
