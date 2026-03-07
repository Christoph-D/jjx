/* eslint-disable @typescript-eslint/no-floating-promises */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { assignLanes } from "../laneAssigner";
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
    working_copies: [],
    ...overrides,
  };
}

function findNodeByChangeId(
  graph: ReturnType<typeof assignLanes>,
  changeId: string,
) {
  return graph.nodes.find((n) => n.changeId === changeId);
}

function findEdgesFrom(graph: ReturnType<typeof assignLanes>, fromId: string) {
  return graph.edges.filter((e) => e.fromId === fromId);
}

function findEdgesTo(graph: ReturnType<typeof assignLanes>, toId: string) {
  return graph.edges.filter((e) => e.toId === toId);
}

describe("assignLanes", () => {
  it("linear chain: all commits in lane 0", () => {
    const entries = [
      makeEntry("aaa", ["bbb"]),
      makeEntry("bbb", ["ccc"]),
      makeEntry("ccc", []),
    ];
    const result = assignLanes(entries);

    assert.strictEqual(result.nodes.length, 3);
    assert.strictEqual(result.nodes[0].changeId, "aaa");
    assert.strictEqual(result.nodes[0].lane, 0);
    assert.strictEqual(result.nodes[1].changeId, "bbb");
    assert.strictEqual(result.nodes[1].lane, 0);
    assert.strictEqual(result.nodes[2].changeId, "ccc");
    assert.strictEqual(result.nodes[2].lane, 0);

    assert.strictEqual(result.nodes[0].colorIndex, result.nodes[1].colorIndex);
    assert.strictEqual(result.nodes[1].colorIndex, result.nodes[2].colorIndex);

    assert.strictEqual(findEdgesTo(result, "aaa").length, 0);

    const fromA = findEdgesFrom(result, "aaa");
    assert.strictEqual(fromA.length, 1);
    assert.strictEqual(fromA[0].toId, "bbb");
    assert.deepStrictEqual(fromA[0].lanePath, [0, 0]);

    const toB = findEdgesTo(result, "bbb");
    assert.strictEqual(toB.length, 1);
    assert.strictEqual(toB[0].fromId, "aaa");
    assert.deepStrictEqual(toB[0].lanePath, [0, 0]);

    assert.strictEqual(findEdgesFrom(result, "ccc").length, 0);
  });

  it("fork: commit with two children opens two lanes", () => {
    const entries = [
      makeEntry("aaa", ["ccc"]),
      makeEntry("bbb", ["ccc"]),
      makeEntry("ccc", []),
    ];
    const result = assignLanes(entries);

    assert.strictEqual(result.nodes.length, 3);
    assert.strictEqual(findNodeByChangeId(result, "aaa")!.lane, 0);
    assert.strictEqual(findNodeByChangeId(result, "bbb")!.lane, 1);
    assert.strictEqual(findNodeByChangeId(result, "ccc")!.lane, 0);

    assert.strictEqual(findEdgesFrom(result, "aaa").length, 1);
    assert.strictEqual(findEdgesFrom(result, "bbb").length, 1);

    const toC = findEdgesTo(result, "ccc");
    assert.strictEqual(toC.length, 2);
  });

  it("merge: commit with two parents opens a new lane for second parent", () => {
    const entries = [
      makeEntry("aaa", ["bbb", "ccc"]),
      makeEntry("bbb", ["ddd"]),
      makeEntry("ccc", ["ddd"]),
      makeEntry("ddd", []),
    ];
    const result = assignLanes(entries);

    assert.strictEqual(result.nodes.length, 4);
    assert.strictEqual(findNodeByChangeId(result, "aaa")!.lane, 0);

    const fromA = findEdgesFrom(result, "aaa");
    assert.strictEqual(fromA.length, 2);
    assert.ok(fromA.some((e) => e.toId === "bbb"));
    assert.ok(fromA.some((e) => e.toId === "ccc"));

    assert.strictEqual(findNodeByChangeId(result, "bbb")!.lane, 0);
    assert.strictEqual(findNodeByChangeId(result, "ccc")!.lane, 1);
  });

  it("diamond merge: two paths converge then merge", () => {
    const entries = [
      makeEntry("aaa", ["bbb", "ccc"]),
      makeEntry("bbb", ["ddd"]),
      makeEntry("ccc", ["ddd"]),
      makeEntry("ddd", []),
    ];
    const result = assignLanes(entries);

    const nodeD = findNodeByChangeId(result, "ddd");
    assert.ok(nodeD);

    const toD = findEdgesTo(result, "ddd");
    assert.ok(toD.length >= 1);
  });

  it("passthrough: edges connect across rows", () => {
    const entries = [
      makeEntry("aaa", ["bbb"]),
      makeEntry("ccc", ["ddd"]),
      makeEntry("bbb", ["eee"]),
      makeEntry("ddd", ["eee"]),
      makeEntry("eee", []),
    ];
    const result = assignLanes(entries);

    const edgeAtoB = findEdgesFrom(result, "aaa");
    assert.strictEqual(edgeAtoB.length, 1);
    assert.strictEqual(edgeAtoB[0].toId, "bbb");

    const edgeBtoE = findEdgesFrom(result, "bbb");
    assert.strictEqual(edgeBtoE.length, 1);
    assert.strictEqual(edgeBtoE[0].toId, "eee");
  });

  it("root node: no outgoing edges", () => {
    const entries = [makeEntry("aaa", [])];
    const result = assignLanes(entries);

    assert.strictEqual(result.nodes.length, 1);
    assert.strictEqual(result.nodes[0].lane, 0);
    assert.strictEqual(result.edges.length, 0);
  });

  it("colors are distinct for independent branches", () => {
    const entries = [
      makeEntry("aaa", ["ccc"]),
      makeEntry("bbb", ["ddd"]),
      makeEntry("ccc", []),
      makeEntry("ddd", []),
    ];
    const result = assignLanes(entries);

    assert.notStrictEqual(
      result.nodes[0].colorIndex,
      result.nodes[1].colorIndex,
    );
  });

  it("lanes converge when commit is consumed", () => {
    const entries = [
      makeEntry("aaa", ["ccc"]),
      makeEntry("bbb", ["ccc"]),
      makeEntry("ccc", ["ddd"]),
      makeEntry("ddd", []),
    ];
    const result = assignLanes(entries);

    const toC = findEdgesTo(result, "ccc");
    assert.strictEqual(toC.length, 2);

    const fromA = findEdgesFrom(result, "aaa");
    assert.strictEqual(fromA.length, 1);
    assert.strictEqual(fromA[0].toId, "ccc");

    const fromB = findEdgesFrom(result, "bbb");
    assert.strictEqual(fromB.length, 1);
    assert.strictEqual(fromB[0].toId, "ccc");
  });

  it("small branches reuse the lane", () => {
    const entries = [
      makeEntry("aaa", ["ddd"]),
      makeEntry("bbb", ["ddd"]),
      makeEntry("ccc", ["ddd"]),
      makeEntry("ddd", []),
    ];
    const result = assignLanes(entries);

    // Assert that bbb and ccc are both in lane 1
    const nodeB = findNodeByChangeId(result, "bbb");
    const nodeC = findNodeByChangeId(result, "ccc");
    assert.ok(nodeB);
    assert.ok(nodeC);
    assert.strictEqual(nodeB.lane, 1);
    assert.strictEqual(nodeC.lane, 1);
  });

  it("assigns three branches to three lanes", () => {
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

    assert.strictEqual(result.nodes.length, 8);

    const nodeA = findNodeByChangeId(result, "aaa");
    assert.ok(nodeA);
    assert.strictEqual(nodeA.lane, 0);

    const fromA = findEdgesFrom(result, "aaa");
    assert.strictEqual(fromA.length, 2);
    const edgeAToBbb = fromA.find((e) => e.toId === "bbb");
    const edgeAToCcc = fromA.find((e) => e.toId === "ccc");
    assert.ok(edgeAToBbb);
    assert.ok(edgeAToCcc);
    assert.strictEqual(edgeAToBbb.lanePath.length, 5);
    assert.strictEqual(edgeAToCcc.lanePath.length, 2);
    assert.strictEqual(edgeAToBbb.lanePath[0], 0);
    assert.strictEqual(edgeAToCcc.lanePath[0], 0);

    const nodeC = findNodeByChangeId(result, "ccc");
    assert.ok(nodeC);
    const fromC = findEdgesFrom(result, "ccc");
    assert.strictEqual(fromC.length, 2);
    const edgeCToDdd = fromC.find((e) => e.toId === "ddd");
    const edgeCToEee = fromC.find((e) => e.toId === "eee");
    assert.ok(edgeCToDdd);
    assert.ok(edgeCToEee);
    assert.strictEqual(edgeCToDdd.lanePath.length, 3);
    assert.strictEqual(edgeCToEee.lanePath.length, 2);

    const nodeE = findNodeByChangeId(result, "eee");
    assert.ok(nodeE);
    const fromE = findEdgesFrom(result, "eee");
    assert.strictEqual(fromE.length, 1);
    assert.strictEqual(fromE[0].toId, "hhh");
    assert.strictEqual(fromE[0].lanePath.length, 6);

    const nodeD = findNodeByChangeId(result, "ddd");
    assert.ok(nodeD);
    const fromD = findEdgesFrom(result, "ddd");
    assert.strictEqual(fromD.length, 1);
    assert.strictEqual(fromD[0].toId, "fff");
    assert.strictEqual(fromD[0].lanePath.length, 3);

    const nodeB = findNodeByChangeId(result, "bbb");
    assert.ok(nodeB);
    const fromB = findEdgesFrom(result, "bbb");
    assert.strictEqual(fromB.length, 1);
    assert.strictEqual(fromB[0].toId, "fff");
    assert.strictEqual(fromB[0].lanePath.length, 2);

    const toF = findEdgesTo(result, "fff");
    assert.strictEqual(toF.length, 2);

    const nodeF = findNodeByChangeId(result, "fff");
    assert.ok(nodeF);
    const fromF = findEdgesFrom(result, "fff");
    assert.strictEqual(fromF.length, 1);
    assert.strictEqual(fromF[0].toId, "ggg");
    assert.strictEqual(fromF[0].lanePath.length, 2);

    const nodeG = findNodeByChangeId(result, "ggg");
    assert.ok(nodeG);
    const fromG = findEdgesFrom(result, "ggg");
    assert.strictEqual(fromG.length, 1);
    assert.strictEqual(fromG[0].toId, "hhh");
    assert.strictEqual(fromG[0].lanePath.length, 2);

    const nodeH = findNodeByChangeId(result, "hhh");
    assert.ok(nodeH);
    assert.strictEqual(findEdgesFrom(result, "hhh").length, 0);

    const toH = findEdgesTo(result, "hhh");
    assert.strictEqual(toH.length, 2);
    assert.ok(toH.every((e) => e.lanePath.length >= 2));
  });
});
