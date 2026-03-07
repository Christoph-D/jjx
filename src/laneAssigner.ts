import type { LogEntry } from "./repository";

const colorRegistryLength = 5;

export interface LaneNode {
  lane: number;
  changeId: string;
  colorIndex: number;
  // Only for display purposes to calculate where to place the label
  numLanesActiveVisually: number;
}

export interface LaneEdge {
  fromRow: number; // The index in ChangeIdGraph.nodes
  toRow: number; // The index in ChangeIdGraph.nodes
  lanePath: number[];
  fromId: string;
  toId: string;
  colorIndex: number;
}

export interface ChangeIdGraph {
  nodes: LaneNode[];
  edges: LaneEdge[];
}

function rot(n: number, length: number): number {
  return ((n % length) + length) % length;
}

interface LaneInfo {
  targetId: string | null;
  colorIndex: number;
}

export function assignLanes(entries: LogEntry[]): ChangeIdGraph {
  const result: ChangeIdGraph = { nodes: [], edges: [] };
  const lanesByRow: LaneInfo[][] = [[]];
  let colorIndex = 0;
  const nodeToRow: Record<string, number> = {};

  // We're working with a partial jj log, so some parent changes could be outside the visible set.
  const visibleChangeIds = new Set<string>();
  for (const entry of entries) {
    visibleChangeIds.add(entry.change_id);
  }

  // Compute nodes
  for (const entry of entries) {
    const lanes = lanesByRow[lanesByRow.length - 1].map((l) => ({
      ...l,
    }));
    let numLanesActiveVisually = lanes.length;
    let nodeLane = lanes.findIndex((l) => l.targetId === entry.change_id);
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

    lanes[nodeLane] = {
      targetId: entry.parents.length > 0 ? entry.parents[0] : entry.change_id,
      colorIndex: color,
    };

    for (let i = 0; i < entry.parents.length; i++) {
      const parentId = entry.parents[i];
      if (!visibleChangeIds.has(parentId)) {
        continue;
      }
      const existingIndex = lanes.findIndex((l) => l.targetId === parentId);
      if (existingIndex === -1) {
        lanes.push({
          targetId: parentId,
          colorIndex: rot(colorIndex, colorRegistryLength),
        });
        colorIndex++;
      }
    }

    // Close lanes for this change ID
    for (let i = 0; i < lanes.length; i++) {
      if (i !== nodeLane && lanes[i].targetId === entry.change_id) {
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
      changeId: entry.change_id,
      lane: nodeLane,
      colorIndex: color,
      numLanesActiveVisually,
    });
    nodeToRow[entry.change_id] = n - 1;
    lanesByRow.push(lanes);
  }

  // Compute edges
  for (let i = 0; i < result.nodes.length; i++) {
    const node = result.nodes[i];
    const entry = entries[i];

    let firstParent = true;
    for (const parent of entry.parents) {
      if (!visibleChangeIds.has(parent)) {
        continue;
      }
      const parentRow = nodeToRow[parent];
      const parentNode = result.nodes[parentRow];

      const lanePath: number[] = [];
      for (let j = i; j <= parentRow; j++) {
        const lane =
          j === i
            ? node.lane
            : lanesByRow[j].findIndex((l) => l.targetId === parent);
        lanePath.push(lane);
      }

      result.edges.push({
        fromRow: i,
        toRow: parentRow,
        lanePath,
        fromId: entry.change_id,
        toId: parent,
        colorIndex: firstParent ? node.colorIndex : parentNode.colorIndex,
      });
      firstParent = false;
    }
  }

  return result;
}
