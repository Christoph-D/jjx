/* eslint-disable @typescript-eslint/no-floating-promises */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { assignLanes, type CommitLaneInfo, type LaneEdge } from "../laneAssigner";
import type { LogEntry } from "../repository";

function makeEntry(
  change_id: string,
  parents: string[],
  overrides: Partial<LogEntry> = {},
): LogEntry {
  return {
    change_id,
    change_id_short: change_id.slice(0, 8),
    change_id_shortest: change_id.slice(0, 4),
    commit_id_short: "c" + change_id.slice(0, 7),
    immutable: false,
    mine: true,
    empty: false,
    current_working_copy: false,
    root: false,
    conflict: false,
    description: `commit ${change_id}`,
    author: { name: "Test", email: "test@test.com", timestamp: "2025-01-01" },
    committer: {
      name: "Test",
      email: "test@test.com",
      timestamp: "2025-01-01",
    },
    diff: { total_added: 0, total_removed: 0, files: [] },
    parents,
    bookmarks: [],
    tags: [],
    ...overrides,
  };
}

function edgesOfType(
  info: CommitLaneInfo,
  type: LaneEdge["type"],
): LaneEdge[] {
  return info.edges.filter((e) => e.type === type);
}

describe("assignLanes", () => {
  it("linear chain: all commits in lane 0", () => {
    const entries = [
      makeEntry("aaa", ["bbb"]),
      makeEntry("bbb", ["ccc"]),
      makeEntry("ccc", []),
    ];
    const result = assignLanes(entries);

    assert.strictEqual(result.length, 3);
    // All nodes should be in lane 0
    assert.strictEqual(result[0].nodeLane, 0);
    assert.strictEqual(result[1].nodeLane, 0);
    assert.strictEqual(result[2].nodeLane, 0);

    // All should use the same color
    assert.strictEqual(result[0].colorIndex, result[1].colorIndex);
    assert.strictEqual(result[1].colorIndex, result[2].colorIndex);

    // First commit has no incoming edges (nothing was expecting it before)
    assert.strictEqual(edgesOfType(result[0], "incoming").length, 0);
    // First commit has an outgoing edge to bbb
    const outgoing0 = edgesOfType(result[0], "outgoing");
    assert.strictEqual(outgoing0.length, 1);
    assert.strictEqual(outgoing0[0].fromLane, 0);
    assert.strictEqual(outgoing0[0].toLane, 0);

    // Second commit has an incoming edge from lane 0
    const incoming1 = edgesOfType(result[1], "incoming");
    assert.strictEqual(incoming1.length, 1);
    assert.strictEqual(incoming1[0].fromLane, 0);
    assert.strictEqual(incoming1[0].toLane, 0);

    // Last commit has no outgoing edges (no parents)
    assert.strictEqual(edgesOfType(result[2], "outgoing").length, 0);
  });

  it("fork: commit with two children opens two lanes", () => {
    // A -> C, B -> C  (A and B are separate children of C)
    // Topological order: A, B, C
    const entries = [
      makeEntry("aaa", ["ccc"]),
      makeEntry("bbb", ["ccc"]),
      makeEntry("ccc", []),
    ];
    const result = assignLanes(entries);

    assert.strictEqual(result.length, 3);
    // A is in lane 0
    assert.strictEqual(result[0].nodeLane, 0);
    // B should be in lane 1 (new lane since lane 0 is tracking ccc)
    assert.strictEqual(result[1].nodeLane, 1);

    // After processing B, both lanes track ccc (no dedup)
    assert.strictEqual(result[1].outputLanes.length, 2);
    assert.strictEqual(result[1].outputLanes[0].id, "ccc");
    assert.strictEqual(result[1].outputLanes[1].id, "ccc");

    // B has a passthrough for lane 0 (tracking ccc)
    const passthroughB = edgesOfType(result[1], "passthrough");
    assert.strictEqual(passthroughB.length, 1);
    assert.strictEqual(passthroughB[0].fromId, "ccc");

    // C should be in lane 0 (first lane tracking ccc)
    assert.strictEqual(result[2].nodeLane, 0);

    // C has 2 incoming edges (both lanes were tracking ccc)
    const incomingC = edgesOfType(result[2], "incoming");
    assert.strictEqual(incomingC.length, 2);
  });

  it("merge: commit with two parents opens a new lane for second parent", () => {
    // A has parents [B, C]  (merge commit)
    // Topological order: A, B, C
    const entries = [
      makeEntry("aaa", ["bbb", "ccc"]),
      makeEntry("bbb", ["ddd"]),
      makeEntry("ccc", ["ddd"]),
      makeEntry("ddd", []),
    ];
    const result = assignLanes(entries);

    assert.strictEqual(result.length, 4);
    // A should be in lane 0
    assert.strictEqual(result[0].nodeLane, 0);

    // A should have an outgoing edge (to first parent bbb) and a merge-outgoing (to second parent ccc)
    const outgoingA = edgesOfType(result[0], "outgoing");
    assert.strictEqual(outgoingA.length, 1);
    assert.strictEqual(outgoingA[0].toId, "bbb");

    const mergeA = edgesOfType(result[0], "merge-outgoing");
    assert.strictEqual(mergeA.length, 1);
    assert.strictEqual(mergeA[0].toId, "ccc");

    // B should be in lane 0 (continues from A's first parent)
    assert.strictEqual(result[1].nodeLane, 0);

    // C should be in lane 1 (the merge lane)
    assert.strictEqual(result[2].nodeLane, 1);
  });

  it("diamond merge: two paths converge then merge", () => {
    // A -> B, A -> C, B -> D, C -> D
    // Topological order: A, B, C, D
    const entries = [
      makeEntry("aaa", ["bbb", "ccc"]), // A merges B and C
      makeEntry("bbb", ["ddd"]),
      makeEntry("ccc", ["ddd"]),
      makeEntry("ddd", []),
    ];
    const result = assignLanes(entries);

    // D should have lanes converge
    const dResult = result[3];
    assert.strictEqual(dResult.commitId, "ddd");

    // D should have at least one incoming edge
    const incomingD = edgesOfType(dResult, "incoming");
    assert.ok(incomingD.length >= 1, `Expected at least 1 incoming edge for D, got ${incomingD.length}`);

    // After D is consumed, lanes tracking it become null and are trimmed
    assert.ok(dResult.outputLanes.length <= 1, `Expected at most 1 output lane after D, got ${dResult.outputLanes.length}`);
  });

  it("passthrough: lane passes through a row it is not consumed by", () => {
    // A -> B, C -> D, B -> E, D -> E
    // Topological order: A, C, B, D, E
    // When processing C (row 1), lane 0 (tracking B) should pass through
    const entries = [
      makeEntry("aaa", ["bbb"]),
      makeEntry("ccc", ["ddd"]),
      makeEntry("bbb", ["eee"]),
      makeEntry("ddd", ["eee"]),
      makeEntry("eee", []),
    ];
    const result = assignLanes(entries);

    // Row 1 (C) should have a passthrough edge for the lane tracking bbb
    const passthroughC = edgesOfType(result[1], "passthrough");
    assert.ok(
      passthroughC.length >= 1,
      `Expected at least 1 passthrough edge at row 1, got ${passthroughC.length}`,
    );
    // The passthrough should be for lane tracking bbb
    assert.ok(
      passthroughC.some((e) => e.fromId === "bbb"),
      "Expected passthrough edge tracking bbb",
    );
  });

  it("root node: no outgoing edges", () => {
    const entries = [makeEntry("aaa", [])];
    const result = assignLanes(entries);

    assert.strictEqual(result.length, 1);
    assert.strictEqual(result[0].nodeLane, 0);
    assert.strictEqual(edgesOfType(result[0], "outgoing").length, 0);
    assert.strictEqual(edgesOfType(result[0], "merge-outgoing").length, 0);
  });

  it("colors are distinct for independent branches", () => {
    const entries = [
      makeEntry("aaa", ["ccc"]),
      makeEntry("bbb", ["ddd"]),
      makeEntry("ccc", []),
      makeEntry("ddd", []),
    ];
    const result = assignLanes(entries);

    // A and B should have different colors since they are independent
    assert.notStrictEqual(result[0].colorIndex, result[1].colorIndex);
  });

  it("lanes converge when commit is consumed", () => {
    // Two lanes converge to same parent:
    // A -> C, B -> C, C -> D
    const entries = [
      makeEntry("aaa", ["ccc"]),
      makeEntry("bbb", ["ccc"]),
      makeEntry("ccc", ["ddd"]),
      makeEntry("ddd", []),
    ];
    const result = assignLanes(entries);

    // B's input lanes = output of A = [{ccc,c0}] (just 1 lane)
    const bResult = result[1];
    assert.strictEqual(bResult.commitId, "bbb");
    assert.strictEqual(bResult.inputLanes.length, 1);
    assert.strictEqual(bResult.inputLanes[0].id, "ccc");

    // B opens a new lane (1), then replaces it with parent ccc.
    // Now both lanes track ccc (no dedup until consumed)
    assert.strictEqual(bResult.outputLanes.length, 2);
    assert.strictEqual(bResult.outputLanes[0].id, "ccc");
    assert.strictEqual(bResult.outputLanes[1].id, "ccc");

    // Lane 0 (tracking ccc) passes through B unchanged
    const passthroughB = edgesOfType(bResult, "passthrough");
    assert.strictEqual(passthroughB.length, 1);
    assert.strictEqual(passthroughB[0].fromLane, 0);
    assert.strictEqual(passthroughB[0].toLane, 0);

    // C sees 2 input lanes (both tracking ccc)
    const cResult = result[2];
    assert.strictEqual(cResult.commitId, "ccc");
    assert.strictEqual(cResult.inputLanes.length, 2);
    assert.strictEqual(cResult.inputLanes[0].id, "ccc");
    assert.strictEqual(cResult.inputLanes[1].id, "ccc");

    // C has 2 incoming edges (from both lanes)
    const incomingC = edgesOfType(cResult, "incoming");
    assert.strictEqual(incomingC.length, 2);

    // After C is consumed, other lanes tracking it become null
    // C's output has 1 lane tracking ddd (lane 1 was set to null and trimmed)
    assert.strictEqual(cResult.outputLanes.length, 1);
    assert.strictEqual(cResult.outputLanes[0].id, "ddd");
  });
  it("assigns three branches to three lanes", () => {
    // Change structure:
    //
    //        aaa
    //       /   \
    //       |   ccc
    //       |    /\
    //       |   /  eee
    //       | ddd  |
    //       |  |   |
    //      bbb /   /
    //       | /   /
    //      fff   /
    //       |   /
    //      ggg /
    //       | /
    //      hhh
    //
    const entries = [
      makeEntry("aaa", ["bbb", "ccc"]),
      makeEntry("ccc", ["ddd", "eee"]),
      makeEntry("eee", ["hhh"]),
      makeEntry("ddd", ["fff"]),
      makeEntry("bbb", ["fff"]),
      makeEntry("fff", ["ggg"]),
      makeEntry("ggg", ["hhh"]),
      makeEntry("hhh", []),
    ];
    const result = assignLanes(entries);

    assert.strictEqual(result.length, 8);

    // aaa is a merge commit with parents bbb and ccc
    assert.strictEqual(result[0].commitId, "aaa");
    assert.strictEqual(result[0].nodeLane, 0);
    const outgoingA = edgesOfType(result[0], "outgoing");
    assert.strictEqual(outgoingA.length, 1);
    assert.strictEqual(outgoingA[0].toId, "bbb");
    const mergeA = edgesOfType(result[0], "merge-outgoing");
    assert.strictEqual(mergeA.length, 1);
    assert.strictEqual(mergeA[0].toId, "ccc");
    assert.strictEqual(result[0].outputLanes.length, 2);
    assert.strictEqual(result[0].outputLanes[0].id, "bbb");
    assert.strictEqual(result[0].outputLanes[1].id, "ccc");

    // ccc is a merge commit in lane 1 with parents ddd and eee
    assert.strictEqual(result[1].commitId, "ccc");
    assert.strictEqual(result[1].nodeLane, 1);
    const outgoingC = edgesOfType(result[1], "outgoing");
    assert.strictEqual(outgoingC.length, 1);
    assert.strictEqual(outgoingC[0].toId, "ddd");
    const mergeC = edgesOfType(result[1], "merge-outgoing");
    assert.strictEqual(mergeC.length, 1);
    assert.strictEqual(mergeC[0].toId, "eee");
    assert.strictEqual(result[1].outputLanes.length, 3);
    assert.strictEqual(result[1].outputLanes[0].id, "bbb");
    assert.strictEqual(result[1].outputLanes[1].id, "ddd");
    assert.strictEqual(result[1].outputLanes[2].id, "eee");

    // eee is in lane 2, parent is ggg
    assert.strictEqual(result[2].commitId, "eee");
    assert.strictEqual(result[2].nodeLane, 2);
    const outgoingE = edgesOfType(result[2], "outgoing");
    assert.strictEqual(outgoingE.length, 1);
    assert.strictEqual(outgoingE[0].toId, "hhh");
    assert.strictEqual(result[2].outputLanes.length, 3);
    assert.strictEqual(result[2].outputLanes[0].id, "bbb");
    assert.strictEqual(result[2].outputLanes[1].id, "ddd");
    assert.strictEqual(result[2].outputLanes[2].id, "hhh");

    // ddd is in lane 1, merges into fff
    assert.strictEqual(result[3].commitId, "ddd");
    assert.strictEqual(result[3].nodeLane, 1);
    const outgoingD = edgesOfType(result[3], "outgoing");
    assert.strictEqual(outgoingD.length, 1);
    assert.strictEqual(outgoingD[0].toId, "fff");
    assert.strictEqual(result[3].outputLanes.length, 3);
    assert.strictEqual(result[3].outputLanes[0].id, "bbb");
    assert.strictEqual(result[3].outputLanes[1].id, "fff");
    assert.strictEqual(result[3].outputLanes[2].id, "hhh");

    // bbb continues in lane 0, parent is fff
    assert.strictEqual(result[4].commitId, "bbb");
    assert.strictEqual(result[4].nodeLane, 0);
    const outgoingB = edgesOfType(result[4], "outgoing");
    assert.strictEqual(outgoingB.length, 1);
    assert.strictEqual(outgoingB[0].toId, "fff");
    assert.strictEqual(result[4].outputLanes.length, 3);
    assert.strictEqual(result[4].outputLanes[0].id, "fff");
    assert.strictEqual(result[4].outputLanes[1].id, "fff");
    assert.strictEqual(result[4].outputLanes[2].id, "hhh");

    // fff is in lane 0, parent is ggg
    assert.strictEqual(result[5].commitId, "fff");
    assert.strictEqual(result[5].nodeLane, 0);
    const outgoingF = edgesOfType(result[5], "outgoing");
    assert.strictEqual(outgoingF.length, 1);
    assert.strictEqual(outgoingF[0].toId, "ggg");
    assert.strictEqual(result[5].outputLanes.length, 3);
    assert.strictEqual(result[5].outputLanes[0].id, "ggg");
    assert.strictEqual(result[5].outputLanes[1].id, null);
    assert.strictEqual(result[5].outputLanes[2].id, "hhh");

    assert.strictEqual(result[6].commitId, "ggg");
    assert.strictEqual(result[6].nodeLane, 0);
    const outgoingG = edgesOfType(result[6], "outgoing");
    assert.strictEqual(outgoingG.length, 1);
    assert.strictEqual(outgoingG[0].toId, "hhh");
    assert.strictEqual(result[6].outputLanes.length, 3);
    assert.strictEqual(result[6].outputLanes[0].id, "hhh");
    assert.strictEqual(result[6].outputLanes[1].id, null);
    assert.strictEqual(result[6].outputLanes[2].id, "hhh");

    assert.strictEqual(result[7].commitId, "hhh");
    assert.strictEqual(result[7].nodeLane, 0);
    assert.strictEqual(edgesOfType(result[7], "outgoing").length, 0);
    assert.strictEqual(edgesOfType(result[7], "merge-outgoing").length, 0);
    const incomingH = edgesOfType(result[7], "incoming");
    assert.strictEqual(incomingH.length, 2);
  });
});
