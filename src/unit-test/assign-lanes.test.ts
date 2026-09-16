/* eslint-disable @typescript-eslint/no-floating-promises */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { assignLanes } from "../lane-assigner";
import type { LogEntry, ParentRef } from "../repository";

function makeEntry(change_id: string, parents: string[] | ParentRef[], overrides: Partial<LogEntry> = {}): LogEntry {
  const parentRefs: ParentRef[] = parents.map((p) =>
    typeof p === "string" ? { change_id: p, divergent: false, change_offset: "" } : p,
  );
  return {
    change_id,
    change_id_shortest: change_id.slice(0, 4),
    commit_id: "c" + change_id,
    commit_id_short: "c" + change_id.slice(0, 7),
    immutable: false,
    mine: true,
    empty: false,
    current_working_copy: false,
    root: false,
    conflict: false,
    divergent: false,
    hidden: false,
    change_offset: "",
    description: `commit ${change_id}`,
    author: { name: "Test", email: "test@test.com", timestamp: "2025-01-01" },
    committer: {
      name: "Test",
      email: "test@test.com",
      timestamp: "2025-01-01",
    },
    parents: parentRefs,
    local_bookmarks: [],
    remote_bookmarks: [],
    local_tags: [],
    remote_tags: [],
    working_copies: [],
    ...overrides,
  };
}

function findNodeByChangeId(graph: ReturnType<typeof assignLanes>, changeId: string) {
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
      makeEntry("aaa", ["bbb"]), //
      makeEntry("bbb", ["ccc"]), //
      makeEntry("ccc", []), //
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
      makeEntry("aaa", ["ccc"]), //
      makeEntry("bbb", ["ccc"]), //
      makeEntry("ccc", []), //
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
      makeEntry("aaa", ["ccc"]), //
      makeEntry("bbb", ["ddd"]), //
      makeEntry("ccc", []), //
      makeEntry("ddd", []), //
    ];
    const result = assignLanes(entries);

    assert.notStrictEqual(result.nodes[0].colorIndex, result.nodes[1].colorIndex);
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

  it("reuses lanes closed by a change", () => {
    const entries = [
      makeEntry("aaa", ["ddd"]),
      makeEntry("bbb", ["ddd", "ccc"]),
      makeEntry("ccc", ["ddd"]),
      makeEntry("ddd", []),
    ];
    const result = assignLanes(entries);

    const nodeC = findNodeByChangeId(result, "ccc");
    assert.ok(nodeC);
    assert.strictEqual(nodeC.lane, 1);

    const edgeC = findEdgesTo(result, "ccc")[0];
    assert.strictEqual(edgeC.lanePath[0], 1);
    assert.strictEqual(edgeC.lanePath[1], 1);
  });

  it("repositions a shared parent into the lane of a change further left", () => {
    // A merge of four changes that all share the same parent.
    // The shared parent should be repositioned one lane to the left per
    // consuming change, so a single connection can turn left multiple times.
    const entries = [
      makeEntry("0", ["1", "2", "3", "4"]),
      makeEntry("4", ["5"]),
      makeEntry("3", ["5"]),
      makeEntry("2", ["5"]),
      makeEntry("1", ["5"]),
      makeEntry("5", []),
    ];
    const result = assignLanes(entries);

    assert.strictEqual(findNodeByChangeId(result, "0")!.lane, 0);
    assert.strictEqual(findNodeByChangeId(result, "4")!.lane, 3);
    assert.strictEqual(findNodeByChangeId(result, "3")!.lane, 2);
    assert.strictEqual(findNodeByChangeId(result, "2")!.lane, 1);
    assert.strictEqual(findNodeByChangeId(result, "1")!.lane, 0);
    assert.strictEqual(findNodeByChangeId(result, "5")!.lane, 0);

    const from4 = findEdgesFrom(result, "4");
    assert.strictEqual(from4.length, 1);
    assert.deepStrictEqual(from4[0].lanePath, [3, 3, 2, 1, 0]);

    const from3 = findEdgesFrom(result, "3");
    assert.deepStrictEqual(from3[0].lanePath, [2, 2, 1, 0]);

    const from2 = findEdgesFrom(result, "2");
    assert.deepStrictEqual(from2[0].lanePath, [1, 1, 0]);

    const from1 = findEdgesFrom(result, "1");
    assert.deepStrictEqual(from1[0].lanePath, [0, 0]);
  });

  it("repositioning a parent may cross occupied lanes", () => {
    // "N" sits in lane 0 while its parent "5" is tracked in lane 2, with the
    // "7" edge occupying lane 1 in between. "5" still repositions into lane 0.
    const entries = [
      makeEntry("m", ["A", "B", "C"]),
      makeEntry("C", ["5"]),
      makeEntry("B", ["7"]),
      makeEntry("7", []),
      makeEntry("A", ["N"]),
      makeEntry("N", ["5"]),
      makeEntry("5", []),
    ];
    const result = assignLanes(entries);

    assert.strictEqual(findNodeByChangeId(result, "N")!.lane, 0);
    assert.strictEqual(findNodeByChangeId(result, "5")!.lane, 0);

    const fromN = findEdgesFrom(result, "N");
    assert.deepStrictEqual(fromN[0].lanePath, [0, 0]);

    const fromC = findEdgesFrom(result, "C");
    assert.deepStrictEqual(fromC[0].lanePath, [2, 2, 2, 2, 2, 0]);
  });

  it("does not reposition a non-first parent", () => {
    // "X" is a merge whose first parent "A" is untracked and whose second
    // parent "5" is already tracked in a lane to the right. Only the first
    // parent takes over the node's lane; "5" stays where it is.
    const entries = [
      makeEntry("m1", ["X", "s1", "s2"]),
      makeEntry("s2", ["5"]),
      makeEntry("s1", ["6"]),
      makeEntry("6", []),
      makeEntry("X", ["A", "5"]),
      makeEntry("5", []),
      makeEntry("A", ["9"]),
      makeEntry("9", []),
    ];
    const result = assignLanes(entries);

    assert.strictEqual(findNodeByChangeId(result, "X")!.lane, 0);
    assert.strictEqual(findNodeByChangeId(result, "5")!.lane, 2);

    const fromX = findEdgesFrom(result, "X");
    const edgeXToA = fromX.find((edge) => edge.toId === "A");
    const edgeXTo5 = fromX.find((edge) => edge.toId === "5");
    assert.deepStrictEqual(edgeXToA!.lanePath, [0, 0, 0]);
    assert.deepStrictEqual(edgeXTo5!.lanePath, [0, 2]);
  });

  it("invisible parent nodes free their lane", () => {
    // Simulates the output of addInvisibleParentNodes:
    // "aaa" has a parent "bbb" outside the visible set, so a synthetic
    // parentless entry for "bbb" is inserted right after "aaa".
    // "ccc" is an independent branch below.
    // The lane used by "bbb" should be freed so "ccc" doesn't see extra lanes.
    const entries = [makeEntry("aaa", ["bbb"]), makeEntry("bbb", []), makeEntry("ccc", ["ddd"]), makeEntry("ddd", [])];
    const result = assignLanes(entries);

    const nodeC = findNodeByChangeId(result, "ccc");
    assert.ok(nodeC);
    assert.strictEqual(nodeC.numLanesActiveVisually, 1);

    const nodeD = findNodeByChangeId(result, "ddd");
    assert.ok(nodeD);
    assert.strictEqual(nodeD.numLanesActiveVisually, 1);
  });

  it("invisible parent on a side lane frees that lane", () => {
    // "aaa" has two parents: "bbb" (visible) and "xxx" (invisible, synthetic).
    // After "xxx" is processed (parentless), its lane should be freed.
    const entries = [
      makeEntry("aaa", ["bbb", "xxx"]),
      makeEntry("xxx", []),
      makeEntry("bbb", ["ccc"]),
      makeEntry("ccc", []),
    ];
    const result = assignLanes(entries);

    const nodeB = findNodeByChangeId(result, "bbb");
    assert.ok(nodeB);
    assert.strictEqual(nodeB.numLanesActiveVisually, 1);

    const nodeC = findNodeByChangeId(result, "ccc");
    assert.ok(nodeC);
    assert.strictEqual(nodeC.numLanesActiveVisually, 1);
  });
});
