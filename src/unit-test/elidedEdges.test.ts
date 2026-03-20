/* eslint-disable @typescript-eslint/no-floating-promises */
import { describe, it } from "node:test";
import assert from "node:assert";
import { classifyEdges, insertSyntheticNodes, getUniqueEntryId, getParentUniqueId } from "../elidedEdges";
import type { LogEntry, ParentRef } from "../types";

function createEntry(changeId: string, parents: ParentRef[] = [], extra: Partial<LogEntry> = {}): LogEntry {
  return {
    change_id: changeId,
    change_id_short: changeId.slice(0, 4),
    change_id_shortest: changeId.slice(0, 4),
    commit_id_short: changeId.slice(0, 8),
    immutable: false,
    mine: false,
    empty: false,
    current_working_copy: false,
    root: false,
    conflict: false,
    divergent: false,
    change_offset: "",
    description: `Commit ${changeId}`,
    author: { name: "Test", email: "test@test.com", timestamp: "2024-01-01" },
    committer: { name: "Test", email: "test@test.com", timestamp: "2024-01-01" },
    diff: { total_added: 0, total_removed: 0, files: [] },
    parents,
    local_bookmarks: [],
    remote_bookmarks: [],
    local_tags: [],
    remote_tags: [],
    working_copies: [],
    ...extra,
  };
}

function parentRef(changeId: string): ParentRef {
  return { change_id: changeId, divergent: false, change_offset: "" };
}

function rb(name: string) {
  return { name, remote: "origin" };
}

describe("elidedEdges", () => {
  describe("getUniqueEntryId", () => {
    it("returns change_id for non-divergent entries", () => {
      const entry = createEntry("abc123");
      assert.strictEqual(getUniqueEntryId(entry), "abc123");
    });

    it("returns change_id/offset for divergent entries", () => {
      const entry = createEntry("abc123", [], { divergent: true, change_offset: "1" });
      assert.strictEqual(getUniqueEntryId(entry), "abc123/1");
    });
  });

  describe("getParentUniqueId", () => {
    it("returns change_id for non-divergent parents", () => {
      const parent = parentRef("xyz789");
      assert.strictEqual(getParentUniqueId(parent), "xyz789");
    });

    it("returns change_id/offset for divergent parents", () => {
      const parent = { change_id: "xyz789", divergent: true, change_offset: "2" };
      assert.strictEqual(getParentUniqueId(parent), "xyz789/2");
    });
  });

  describe("classifyEdges", () => {
    it("classifies direct edges for visible parents", () => {
      const entries: LogEntry[] = [
        createEntry("A", [parentRef("B")]),
        createEntry("B", [parentRef("C")]),
        createEntry("C", []),
      ];

      const { edges, syntheticNodes } = classifyEdges(entries);

      assert.strictEqual(edges.size, 3);
      assert.deepStrictEqual(edges.get("A"), [{ targetId: "B", edgeType: "direct" }]);
      assert.deepStrictEqual(edges.get("B"), [{ targetId: "C", edgeType: "direct" }]);
      assert.deepStrictEqual(edges.get("C"), []);
      assert.strictEqual(syntheticNodes.size, 0);
    });

    it("classifies missing edges for non-visible parents with no path to visible", () => {
      const entries: LogEntry[] = [createEntry("A", [parentRef("B")]), createEntry("B", [parentRef("X")])];

      const { edges, syntheticNodes } = classifyEdges(entries);

      assert.strictEqual(edges.size, 2);
      assert.deepStrictEqual(edges.get("A"), [{ targetId: "B", edgeType: "direct" }]);
      assert.deepStrictEqual(edges.get("B"), [{ targetId: "X", edgeType: "missing" }]);
      assert.strictEqual(syntheticNodes.size, 1);
      assert.strictEqual(syntheticNodes.get("X")?.edgeType, "missing");
    });

    it("classifies indirect edges when parent path leads to visible commit", () => {
      const entries: LogEntry[] = [
        createEntry("A", [parentRef("X")]),
        createEntry("B", [parentRef("X")]),
        createEntry("X", [parentRef("C")]),
        createEntry("C", []),
      ];

      const { edges, syntheticNodes } = classifyEdges(entries);

      assert.strictEqual(edges.size, 4);
      assert.deepStrictEqual(edges.get("A"), [{ targetId: "X", edgeType: "direct" }]);
      assert.deepStrictEqual(edges.get("B"), [{ targetId: "X", edgeType: "direct" }]);
      assert.deepStrictEqual(edges.get("X"), [{ targetId: "C", edgeType: "direct" }]);
      assert.strictEqual(syntheticNodes.size, 0);
    });

    it("creates synthetic node for missing edge", () => {
      const entries: LogEntry[] = [createEntry("A", [parentRef("B"), parentRef("X")]), createEntry("B", [])];

      const { edges, syntheticNodes } = classifyEdges(entries);

      const aEdges = edges.get("A");
      assert.ok(aEdges);
      assert.strictEqual(aEdges.length, 2);
      assert.ok(aEdges.some((e) => e.targetId === "B" && e.edgeType === "direct"));
      assert.ok(aEdges.some((e) => e.targetId === "X" && e.edgeType === "missing"));

      const synthNode = syntheticNodes.get("X");
      assert.ok(synthNode);
      assert.strictEqual(synthNode.edgeType, "missing");
    });

    it("removes transitive indirect edges when target is reachable via direct edge", () => {
      const entries: LogEntry[] = [
        createEntry("A", [parentRef("B"), parentRef("x")], { immutable: true, remote_bookmarks: [rb("main")] }),
        createEntry("B", [parentRef("C")], { immutable: true, remote_bookmarks: [rb("dev")] }),
        createEntry("C", [], { immutable: true, remote_bookmarks: [rb("base")] }),
        createEntry("x", [parentRef("C")], { immutable: true }),
      ];

      const { edges } = classifyEdges(entries);

      const aEdges = edges.get("A");
      assert.ok(aEdges);
      assert.strictEqual(aEdges.length, 1, "A should only have direct(B), indirect(C) removed as transitive");
      assert.deepStrictEqual(aEdges[0], { targetId: "B", edgeType: "direct" });
    });

    it("removes indirect edge when target is reachable via direct edge path through parentMap", () => {
      const entries: LogEntry[] = [
        createEntry("A", [parentRef("B"), parentRef("x")], { immutable: true, remote_bookmarks: [rb("main")] }),
        createEntry("B", [parentRef("y")], { immutable: true, remote_bookmarks: [rb("dev")] }),
        createEntry("C", [], { immutable: true, remote_bookmarks: [rb("base")] }),
        createEntry("x", [parentRef("C")], { immutable: true }),
        createEntry("y", [parentRef("C")], { immutable: true }),
      ];

      const { edges } = classifyEdges(entries);

      const aEdges = edges.get("A");
      assert.ok(aEdges);
      assert.strictEqual(aEdges.length, 1, "A should only have direct edge to B (indirect to C removed via B->y->C)");
      assert.deepStrictEqual(aEdges[0], { targetId: "B", edgeType: "direct" });
    });

    it("removes indirect edge when target is reachable via another indirect edge", () => {
      const entries: LogEntry[] = [
        createEntry("A", [parentRef("x"), parentRef("y")], { immutable: true, remote_bookmarks: [rb("main")] }),
        createEntry("C", [], { immutable: true, remote_bookmarks: [rb("base")] }),
        createEntry("x", [parentRef("C")], { immutable: true }),
        createEntry("y", [parentRef("C")], { immutable: true }),
      ];

      const { edges } = classifyEdges(entries);

      const aEdges = edges.get("A");
      assert.ok(aEdges);
      assert.strictEqual(aEdges.length, 1, "A should only have one edge (deduped to C)");
      assert.strictEqual(aEdges[0].edgeType, "indirect");
      assert.strictEqual(aEdges[0].targetId, "C");
    });

    it("deduplicates edges when multiple parents lead to same ancestor", () => {
      const entries: LogEntry[] = [
        createEntry("A", [parentRef("B"), parentRef("C")]),
        createEntry("B", [parentRef("D")]),
        createEntry("C", [parentRef("D")]),
        createEntry("D", []),
      ];

      const { edges } = classifyEdges(entries);

      const aEdges = edges.get("A");
      assert.ok(aEdges);
      assert.strictEqual(aEdges.length, 2, "A should have edges to B and C, not duplicate to D");
      const targets = aEdges.map((e) => e.targetId).sort();
      assert.deepStrictEqual(targets, ["B", "C"]);
    });

    it("keeps missing edges even when target is reachable", () => {
      const entries: LogEntry[] = [
        createEntry("A", [parentRef("B"), parentRef("X")]),
        createEntry("B", [parentRef("X")]),
      ];

      const { edges } = classifyEdges(entries);

      const aEdges = edges.get("A");
      assert.ok(aEdges);
      assert.strictEqual(aEdges.length, 2);
      assert.ok(aEdges.some((e) => e.targetId === "B" && e.edgeType === "direct"));
      assert.ok(aEdges.some((e) => e.targetId === "X" && e.edgeType === "missing"));
    });

    it("classifies dead-end nodes as missing instead of indirect", () => {
      const entries: LogEntry[] = [
        createEntry("A", [parentRef("x")], { immutable: true, remote_bookmarks: [rb("main")] }),
        createEntry("x", [parentRef("deadend")], { immutable: true }),
        createEntry("deadend", [], { immutable: true }),
      ];

      const { edges } = classifyEdges(entries);

      const aEdges = edges.get("A");
      assert.ok(aEdges);
      assert.strictEqual(aEdges.length, 1);
      assert.deepStrictEqual(aEdges[0], { targetId: "x", edgeType: "missing" });
    });

    it("collapses all-missing paths to single missing edge pointing to external parent", () => {
      const entries: LogEntry[] = [
        createEntry("A", [parentRef("x")], { immutable: true, remote_bookmarks: [rb("main")] }),
        createEntry("x", [parentRef("y")], { immutable: true }),
        createEntry("y", [], { immutable: true }),
      ];

      const { edges } = classifyEdges(entries);

      const aEdges = edges.get("A");
      assert.ok(aEdges);
      assert.strictEqual(aEdges.length, 1);
      assert.deepStrictEqual(aEdges[0], { targetId: "x", edgeType: "missing" });
    });

    it("removes direct transitive edge when indirect edges are also present", () => {
      const entries: LogEntry[] = [
        createEntry("A", [parentRef("B"), parentRef("x"), parentRef("C")], {
          immutable: true,
          remote_bookmarks: [rb("main")],
        }),
        createEntry("B", [parentRef("C")], { immutable: true, remote_bookmarks: [rb("dev")] }),
        createEntry("C", [], { immutable: true, remote_bookmarks: [rb("base")] }),
        createEntry("x", [parentRef("C")], { immutable: true }),
      ];

      const { edges } = classifyEdges(entries);

      const aEdges = edges.get("A");
      assert.ok(aEdges);
      assert.strictEqual(
        aEdges.length,
        1,
        "A should only have direct(B), both indirect(C) and direct(C) removed as transitive",
      );
      assert.deepStrictEqual(aEdges[0], { targetId: "B", edgeType: "direct" });
    });

    it("jj linearized: fork and merge collapses to single indirect edge", () => {
      const entries: LogEntry[] = [
        createEntry("D", [parentRef("b"), parentRef("c")], { immutable: true, remote_bookmarks: [rb("main")] }),
        createEntry("A", [], { immutable: true, remote_bookmarks: [rb("base")] }),
        createEntry("b", [parentRef("A")], { immutable: true }),
        createEntry("c", [parentRef("A")], { immutable: true }),
      ];

      const { edges } = classifyEdges(entries);

      const dEdges = edges.get("D");
      assert.ok(dEdges);
      assert.strictEqual(dEdges.length, 1, "D should have single indirect edge to A");
      assert.deepStrictEqual(dEdges[0], { targetId: "A", edgeType: "indirect" });
    });

    it("jj virtual octopus: external merges create more edges than original parents", () => {
      const entries: LogEntry[] = [
        createEntry("F", [parentRef("d"), parentRef("e")], { immutable: true, remote_bookmarks: [rb("main")] }),
        createEntry("A", [], { immutable: true, remote_bookmarks: [rb("a")] }),
        createEntry("B", [], { immutable: true, remote_bookmarks: [rb("b")] }),
        createEntry("C", [], { immutable: true, remote_bookmarks: [rb("c")] }),
        createEntry("d", [parentRef("A"), parentRef("B")], { immutable: true }),
        createEntry("e", [parentRef("B"), parentRef("C")], { immutable: true }),
      ];

      const { edges } = classifyEdges(entries);

      const fEdges = edges.get("F");
      assert.ok(fEdges);
      assert.strictEqual(fEdges.length, 3, "F should have 3 indirect edges (virtual octopus)");
      assert.ok(fEdges.some((e) => e.targetId === "A" && e.edgeType === "indirect"));
      assert.ok(fEdges.some((e) => e.targetId === "B" && e.edgeType === "indirect"));
      assert.ok(fEdges.some((e) => e.targetId === "C" && e.edgeType === "indirect"));
    });

    it("jj edge_to_ancestor: transitive edge to ancestor is removed", () => {
      const entries: LogEntry[] = [
        createEntry("F", [parentRef("D"), parentRef("e")], { immutable: true, remote_bookmarks: [rb("main")] }),
        createEntry("D", [parentRef("b"), parentRef("C")], { immutable: true, remote_bookmarks: [rb("dev")] }),
        createEntry("C", [parentRef("a")], { immutable: true, remote_bookmarks: [rb("base")] }),
        createEntry("e", [parentRef("C")], { immutable: true }),
        createEntry("b", [], { immutable: true }),
        createEntry("a", [], { immutable: true }),
      ];

      const { edges } = classifyEdges(entries);

      const fEdges = edges.get("F");
      assert.ok(fEdges);
      assert.strictEqual(fEdges.length, 1, "F should only have direct(D), indirect(C) removed as transitive");
      assert.deepStrictEqual(fEdges[0], { targetId: "D", edgeType: "direct" });

      const dEdges = edges.get("D");
      assert.ok(dEdges);
      assert.strictEqual(dEdges.length, 2);
      assert.ok(dEdges.some((e) => e.targetId === "b" && e.edgeType === "missing"));
      assert.ok(dEdges.some((e) => e.targetId === "C" && e.edgeType === "direct"));

      const cEdges = edges.get("C");
      assert.ok(cEdges);
      assert.strictEqual(cEdges.length, 1);
      assert.deepStrictEqual(cEdges[0], { targetId: "a", edgeType: "missing" });
    });

    it("jj edge_escapes_from: complex transitive edge removal through external merges", () => {
      const entries: LogEntry[] = [
        createEntry("J", [parentRef("G"), parentRef("i")], { immutable: true, remote_bookmarks: [rb("main")] }),
        createEntry("G", [parentRef("b")], { immutable: true, remote_bookmarks: [rb("g")] }),
        createEntry("H", [parentRef("f")], { immutable: true, remote_bookmarks: [rb("h")] }),
        createEntry("D", [parentRef("b")], { immutable: true, remote_bookmarks: [rb("d")] }),
        createEntry("A", [], { immutable: true, remote_bookmarks: [rb("a")] }),
        createEntry("b", [parentRef("A")], { immutable: true }),
        createEntry("c", [parentRef("A")], { immutable: true }),
        createEntry("e", [parentRef("D")], { immutable: true }),
        createEntry("f", [parentRef("D"), parentRef("c")], { immutable: true }),
        createEntry("i", [parentRef("e"), parentRef("H")], { immutable: true }),
      ];

      const { edges } = classifyEdges(entries);

      const jEdges = edges.get("J");
      assert.ok(jEdges);
      assert.strictEqual(jEdges.length, 2, "J should have direct(G) and indirect(H)");
      assert.ok(jEdges.some((e) => e.targetId === "G" && e.edgeType === "direct"));
      assert.ok(jEdges.some((e) => e.targetId === "H" && e.edgeType === "indirect"));

      const hEdges = edges.get("H");
      assert.ok(hEdges);
      assert.strictEqual(hEdges.length, 1, "H should only have indirect(D), indirect(A) removed as transitive");
      assert.deepStrictEqual(hEdges[0], { targetId: "D", edgeType: "indirect" });

      const gEdges = edges.get("G");
      assert.ok(gEdges);
      assert.strictEqual(gEdges.length, 1);
      assert.deepStrictEqual(gEdges[0], { targetId: "A", edgeType: "indirect" });

      const dEdges = edges.get("D");
      assert.ok(dEdges);
      assert.strictEqual(dEdges.length, 1);
      assert.deepStrictEqual(dEdges[0], { targetId: "A", edgeType: "indirect" });

      const aEdges = edges.get("A");
      assert.ok(aEdges);
      assert.strictEqual(aEdges.length, 0, "A has no parents in the set");
    });

    it("applies transitive edge removal at intermediate external merge commits", () => {
      const entries: LogEntry[] = [
        createEntry("X", [parentRef("m")], { immutable: true, remote_bookmarks: [rb("main")] }),
        createEntry("A", [], { immutable: true, remote_bookmarks: [rb("a")] }),
        createEntry("B", [], { immutable: true, remote_bookmarks: [rb("b")] }),
        createEntry("m", [parentRef("n"), parentRef("B")], { immutable: true }),
        createEntry("n", [parentRef("A"), parentRef("B")], { immutable: true }),
      ];

      const { edges } = classifyEdges(entries);

      const xEdges = edges.get("X");
      assert.ok(xEdges);
      assert.strictEqual(
        xEdges.length,
        2,
        "X should have indirect(A) and indirect(B) after intermediate merge transitive removal at m prunes duplicates through n",
      );
      assert.ok(xEdges.some((e) => e.targetId === "A" && e.edgeType === "indirect"));
      assert.ok(xEdges.some((e) => e.targetId === "B" && e.edgeType === "indirect"));
    });
  });

  describe("insertSyntheticNodes", () => {
    it("returns entries unchanged when no synthetic nodes", () => {
      const entries: LogEntry[] = [createEntry("A", [parentRef("B")]), createEntry("B", [])];

      const { edges, syntheticNodes, visibleIds } = classifyEdges(entries);
      const result = insertSyntheticNodes(entries, syntheticNodes, edges, visibleIds);

      assert.strictEqual(result.length, 2);
    });

    it("inserts synthetic node after commit with missing parent", () => {
      const entries: LogEntry[] = [createEntry("A", [parentRef("X")]), createEntry("B", [])];

      const { edges, syntheticNodes, visibleIds } = classifyEdges(entries);
      const result = insertSyntheticNodes(entries, syntheticNodes, edges, visibleIds);

      assert.strictEqual(result.length, 3);
      assert.strictEqual(result[0].change_id, "A");
      assert.strictEqual(result[1].change_id, "X");

      const synthNode = result[1];
      assert.strictEqual(synthNode.parents.length, 0);
    });

    it("inserts synthetic node with parent for indirect edge", () => {
      const entries: LogEntry[] = [
        createEntry("A", [parentRef("Y")]),
        createEntry("B", [parentRef("Y")]),
        createEntry("Y", [parentRef("C")]),
        createEntry("C", []),
      ];

      const { edges, syntheticNodes, visibleIds } = classifyEdges(entries);
      const result = insertSyntheticNodes(entries, syntheticNodes, edges, visibleIds);

      assert.strictEqual(result.length, 4);
    });

    it("synthetic node for missing edge has no parents", () => {
      const entries: LogEntry[] = [createEntry("A", [parentRef("X")]), createEntry("B", [])];

      const { edges, syntheticNodes, visibleIds } = classifyEdges(entries);
      const result = insertSyntheticNodes(entries, syntheticNodes, edges, visibleIds);

      const synthEntry = result.find((e) => e.change_id === "X");
      assert.ok(synthEntry);
      assert.deepStrictEqual(synthEntry.parents, []);
    });

    it("collapses synthetic nodes", () => {
      const entries: LogEntry[] = [
        createEntry("A", [parentRef("B")]),
        createEntry("B", [parentRef("C")], { immutable: true }),
        createEntry("C", [parentRef("D")], { immutable: true }),
        createEntry("D", [parentRef("E")], { immutable: true }),
      ];

      const { syntheticNodes } = classifyEdges(entries);

      assert.strictEqual(syntheticNodes.size, 1, "There should be one synthetic node");
    });

    it("collapses synthetic nodes over simple merges", () => {
      const entries: LogEntry[] = [
        createEntry("A", [parentRef("left-B"), parentRef("right-B")]),
        createEntry("right-B", [parentRef("C")], { immutable: true }),
        createEntry("left-B", [parentRef("C")], { immutable: true }),
        createEntry("C", [parentRef("X")], { immutable: true }),
      ];

      const { syntheticNodes } = classifyEdges(entries);

      assert.strictEqual(syntheticNodes.size, 1);
    });

    it("collapses synthetic nodes over longer merges", () => {
      const entries: LogEntry[] = [
        createEntry("A", [parentRef("left-B"), parentRef("right-B")]),
        createEntry("right-B", [parentRef("right-C")], { immutable: true }),
        createEntry("right-C", [parentRef("D")], { immutable: true }),
        createEntry("left-B", [parentRef("left-C")], { immutable: true }),
        createEntry("left-C", [parentRef("D")], { immutable: true }),
        createEntry("D", [parentRef("X")], { immutable: true }),
        createEntry("X", [], { immutable: true }),
      ];

      const { edges, syntheticNodes, visibleIds } = classifyEdges(entries);

      assert.strictEqual(syntheticNodes.size, 2);
      assert.ok(syntheticNodes.has("left-C"), "left-C should be a synthetic node");
      assert.ok(syntheticNodes.has("right-C"), "right-C should be a synthetic node");
      assert.strictEqual(syntheticNodes.get("left-C")?.edgeType, "missing");
      assert.strictEqual(syntheticNodes.get("right-C")?.edgeType, "missing");

      const result = insertSyntheticNodes(entries, syntheticNodes, edges, visibleIds);

      assert.strictEqual(result.length, 5, "should have 5 entries: A, left-B, right-B, ~left-C, ~right-C");
      const changeIds = result.map((e) => e.change_id);
      assert.ok(changeIds.includes("A"), "A should be included");
      assert.ok(changeIds.includes("left-B"), "left-B should be included");
      assert.ok(changeIds.includes("right-B"), "right-B should be included");
      assert.ok(changeIds.includes("left-C"), "left-C synthetic should be included");
      assert.ok(changeIds.includes("right-C"), "right-C synthetic should be included");
      assert.ok(!changeIds.includes("D"), "D should be filtered out");
      assert.ok(!changeIds.includes("X"), "X should be filtered out");
    });

    it("creates synthetic nodes if one side if immutable", () => {
      const entries: LogEntry[] = [
        createEntry("A", [parentRef("left-B"), parentRef("right-B")]),
        createEntry("right-B", [parentRef("right-C")], { immutable: true }),
        createEntry("right-C", [parentRef("D")], { immutable: true }),
        createEntry("left-B", [parentRef("D")]),
        createEntry("D", [], { immutable: true }),
      ];

      const { edges, syntheticNodes, visibleIds } = classifyEdges(entries);

      assert.deepStrictEqual([...visibleIds].sort(), ["A", "D", "left-B", "right-B"]);

      const bEdges = edges.get("right-B")!;
      assert.strictEqual(bEdges.length, 1);
      assert.strictEqual(bEdges[0].edgeType, "direct");
      assert.strictEqual(bEdges[0].targetId, "right-C");

      assert.strictEqual(syntheticNodes.size, 1);
      assert.ok(syntheticNodes.has("right-C"));
      assert.strictEqual(syntheticNodes.get("right-C")?.edgeType, "indirect");
      assert.strictEqual(syntheticNodes.get("right-C")?.targetId, "D");

      const result = insertSyntheticNodes(entries, syntheticNodes, edges, visibleIds);

      const changeIds = result.map((e) => e.change_id);
      assert.deepStrictEqual(changeIds, ["A", "right-B", "right-C", "left-B", "D"]);

      const synthEntry = result.find((e) => e.change_id === "right-C");
      assert.ok(synthEntry);
      assert.deepStrictEqual(synthEntry.parents, [{ change_id: "D", divergent: false, change_offset: "" }]);
    });

    it("creates synthetic nodes for elided commits in a more complex case", () => {
      const entries: LogEntry[] = [
        createEntry("A", [parentRef("B")]),
        createEntry("B", [parentRef("C"), parentRef("X")], { immutable: true }),
        createEntry("X", [parentRef("G")], { immutable: true }),
        createEntry("C", [parentRef("D")], { immutable: true }),
        createEntry("Z", [parentRef("D")]),
        createEntry("D", [parentRef("E")], { immutable: true }),
        createEntry("E", [parentRef("F")], { immutable: true }),
        createEntry("F", [parentRef("G")], { immutable: true }),
        createEntry("G", [], { immutable: true }),
      ];

      const { edges, syntheticNodes, visibleIds } = classifyEdges(entries);

      assert.deepStrictEqual([...visibleIds].sort(), ["A", "B", "D", "Z"]);

      const bEdges = edges.get("B")!;
      assert.strictEqual(bEdges.length, 2);
      bEdges.sort((a, b) => a.targetId.localeCompare(b.targetId));
      assert.deepStrictEqual(bEdges, [
        { targetId: "C", edgeType: "direct" },
        { targetId: "X", edgeType: "missing" },
      ]);

      assert.deepStrictEqual([...syntheticNodes.keys()].sort(), ["C", "E", "X"]);
      assert.strictEqual(syntheticNodes.get("C")?.edgeType, "indirect");
      assert.strictEqual(syntheticNodes.get("E")?.edgeType, "missing");
      assert.strictEqual(syntheticNodes.get("X")?.edgeType, "missing");

      const result = insertSyntheticNodes(entries, syntheticNodes, edges, visibleIds);

      const changeIds = result.map((e) => e.change_id);
      assert.deepStrictEqual(changeIds, ["A", "B", "X", "C", "Z", "D", "E"]);

      const synthEntry = result.find((e) => e.change_id === "C");
      assert.ok(synthEntry);
      assert.deepStrictEqual(synthEntry.parents, [{ change_id: "D", divergent: false, change_offset: "" }]);
    });
  });
});
