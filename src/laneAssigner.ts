import type { LogEntry } from "./repository";

const colorRegistryLength = 5;

export interface LaneNode {
  targetId: string | null;
  sourceId: string | null;
  colorIndex: number;
}

export interface LaneEdge {
  fromLane: number;
  toLane: number;
  colorIndex: number;
  type: "incoming" | "outgoing" | "passthrough" | "merge-outgoing";
  fromId: string;
  toId: string;
}

export interface CommitLaneInfo {
  commitId: string;
  nodeLane: number;
  colorIndex: number;
  inputLanes: LaneNode[];
  outputLanes: LaneNode[];
  edges: LaneEdge[];
}

function rot(n: number, length: number): number {
  return ((n % length) + length) % length;
}

export function assignLanes(entries: LogEntry[]): CommitLaneInfo[] {
  const results: CommitLaneInfo[] = [];
  const activeLanes: LaneNode[] = [];
  let colorIndex = 0;

  for (const entry of entries) {
    const inputLanes = activeLanes.map((l) => ({ ...l }));

    // Find which lane was expecting this commit
    let nodeLane = activeLanes.findIndex((l) => l.targetId === entry.change_id);

    if (nodeLane === -1) {
      // This commit wasn't expected by any lane — assign to an empty slot or create a new lane
      nodeLane = activeLanes.findIndex((l) => l.targetId === null);
      if (nodeLane === -1) {
        nodeLane = activeLanes.length;
        activeLanes.push({
          targetId: entry.change_id,
          sourceId: entry.change_id,
          colorIndex: rot(colorIndex, colorRegistryLength),
        });
      } else {
        activeLanes[nodeLane] = {
          targetId: entry.change_id,
          sourceId: entry.change_id,
          colorIndex: rot(colorIndex, colorRegistryLength),
        };
      }
      colorIndex++;
    }

    const nodeColorIndex = activeLanes[nodeLane].colorIndex;

    // Replace this commit's lane with its first parent (or null if no parents)
    if (entry.parents.length > 0) {
      activeLanes[nodeLane] = {
        targetId: entry.parents[0],
        sourceId: entry.change_id,
        colorIndex: nodeColorIndex,
      };
    } else {
      activeLanes[nodeLane] = { targetId: null, sourceId: null, colorIndex: nodeColorIndex };
    }

    // Open new lanes for secondary parents (merge sources)
    for (let i = 1; i < entry.parents.length; i++) {
      const parentId = entry.parents[i];
      const existingIndex = activeLanes.findIndex((l) => l.targetId === parentId);
      if (existingIndex === -1) {
        activeLanes.push({
          targetId: parentId,
          sourceId: entry.change_id,
          colorIndex: rot(colorIndex, colorRegistryLength),
        });
        colorIndex++;
      }
    }

    // When a commit is consumed from lane N, set other lanes tracking it to null (converged)
    for (let i = 0; i < activeLanes.length; i++) {
      if (i !== nodeLane && activeLanes[i].targetId === entry.change_id) {
        activeLanes[i] = { targetId: null, sourceId: null, colorIndex: activeLanes[i].colorIndex };
      }
    }

    while (
      activeLanes.length > 0 &&
      activeLanes[activeLanes.length - 1].targetId === null
    ) {
      activeLanes.pop();
    }

    const outputLanes = activeLanes.map((l) => ({ ...l }));

    // Compute edges for this row
    const edges: LaneEdge[] = [];

    // 1. Incoming edges: input lanes that were tracking this commit
    for (let i = 0; i < inputLanes.length; i++) {
      if (inputLanes[i].targetId === entry.change_id) {
        edges.push({
          fromLane: i,
          toLane: nodeLane,
          colorIndex: inputLanes[i].colorIndex,
          type: "incoming",
          fromId: inputLanes[i].sourceId!,
          toId: inputLanes[i].targetId!,
        });
      }
    }

    // 2. Outgoing edge to first parent
    if (entry.parents.length > 0) {
      const firstParentOutputLane = outputLanes.findIndex(
        (l) => l.targetId === entry.parents[0],
      );
      if (firstParentOutputLane !== -1) {
        edges.push({
          fromLane: nodeLane,
          toLane: firstParentOutputLane,
          colorIndex: nodeColorIndex,
          type: "outgoing",
          fromId: entry.change_id,
          toId: entry.parents[0],
        });
      }
    }

    // 3. Merge-outgoing edges for secondary parents
    for (let i = 1; i < entry.parents.length; i++) {
      const parentId = entry.parents[i];
      const parentOutputLane = outputLanes.findIndex(
        (l) => l.targetId === parentId,
      );
      if (parentOutputLane !== -1) {
        edges.push({
          fromLane: nodeLane,
          toLane: parentOutputLane,
          colorIndex: outputLanes[parentOutputLane].colorIndex,
          type: "merge-outgoing",
          fromId: entry.change_id,
          toId: parentId,
        });
      }
    }

    // 4. Pass-through edges: input lanes that are NOT this commit, passing through to output
    for (let i = 0; i < inputLanes.length; i++) {
      if (
        inputLanes[i].targetId !== null &&
        inputLanes[i].targetId !== entry.change_id
      ) {
        edges.push({
          fromLane: i,
          toLane: i,
          colorIndex: inputLanes[i].colorIndex,
          type: "passthrough",
          fromId: inputLanes[i].sourceId!,
          toId: inputLanes[i].targetId!,
        });
      }
    }

    results.push({
      commitId: entry.change_id,
      nodeLane,
      colorIndex: nodeColorIndex,
      inputLanes,
      outputLanes,
      edges,
    });
  }

  return results;
}
