/* eslint-disable @typescript-eslint/no-floating-promises */
import { describe, it } from "node:test";
import assert from "node:assert";
import { classifyEdges, insertSyntheticNodes, getUniqueEntryId, getParentUniqueId } from "../elidedEdges";
import type { ClassifiedEdge } from "../elidedEdges";
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
    hidden: false,
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

    it("returns change_id/offset when offset present even if divergent is false", () => {
      const parent = { change_id: "xyz789", divergent: false, change_offset: "1" };
      assert.strictEqual(getParentUniqueId(parent), "xyz789/1");
    });
  });

  describe("getUniqueEntryId with divergent=false commits", () => {
    it("returns change_id/offset when offset present even if divergent is false", () => {
      const entry = createEntry("abc123", [], { divergent: false, change_offset: "1" });
      assert.strictEqual(getUniqueEntryId(entry), "abc123/1");
    });

    it("returns change_id/0 when offset is 0", () => {
      const entry = createEntry("abc123", [], { divergent: false, change_offset: "0" });
      assert.strictEqual(getUniqueEntryId(entry), "abc123/0");
    });
  });

  describe("classifyEdges", () => {
    it("classifies direct edges for visible parents", () => {
      const entries: LogEntry[] = [
        createEntry("A", [parentRef("B")]),
        createEntry("B", [parentRef("C")]),
        createEntry("C", []),
      ];

      const { edges } = classifyEdges(entries);

      assert.strictEqual(edges.size, 3);
      assert.deepStrictEqual(edges.get("A"), [{ targetId: "B", edgeType: "direct" }]);
      assert.deepStrictEqual(edges.get("B"), [{ targetId: "C", edgeType: "direct" }]);
      assert.deepStrictEqual(edges.get("C"), []);
    });

    it("classifies missing edges for non-visible parents with no path to visible", () => {
      const entries: LogEntry[] = [createEntry("A", [parentRef("B")]), createEntry("B", [parentRef("X")])];

      const { edges } = classifyEdges(entries);

      assert.strictEqual(edges.size, 2);
      assert.deepStrictEqual(edges.get("A"), [{ targetId: "B", edgeType: "direct" }]);
      assert.deepStrictEqual(edges.get("B"), [{ targetId: "X", edgeType: "missing" }]);
    });

    it("classifies indirect edges when parent path leads to visible commit", () => {
      const entries: LogEntry[] = [
        createEntry("A", [parentRef("X")]),
        createEntry("B", [parentRef("X")]),
        createEntry("X", [parentRef("C")]),
        createEntry("C", []),
      ];

      const { edges } = classifyEdges(entries);

      assert.strictEqual(edges.size, 4);
      assert.deepStrictEqual(edges.get("A"), [{ targetId: "X", edgeType: "direct" }]);
      assert.deepStrictEqual(edges.get("B"), [{ targetId: "X", edgeType: "direct" }]);
      assert.deepStrictEqual(edges.get("X"), [{ targetId: "C", edgeType: "direct" }]);
    });

    it("creates synthetic node for missing edge", () => {
      const entries: LogEntry[] = [createEntry("A", [parentRef("B"), parentRef("X")]), createEntry("B", [])];

      const { edges } = classifyEdges(entries);

      const aEdges = edges.get("A");
      assert.ok(aEdges);
      assert.strictEqual(aEdges.length, 2);
      assert.ok(aEdges.some((e) => e.targetId === "B" && e.edgeType === "direct"));
      assert.ok(aEdges.some((e) => e.targetId === "X" && e.edgeType === "missing"));
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

    it("handles divergent commits with divergent=false flag", () => {
      const entries: LogEntry[] = [
        createEntry("abc123", [], { divergent: false, change_offset: "0" }),
        createEntry("abc123", [], { divergent: false, change_offset: "1" }),
      ];

      const { edges, visibleIds } = classifyEdges(entries);

      assert.ok(visibleIds.has("abc123/0"), "visibleIds should contain abc123/0");
      assert.ok(visibleIds.has("abc123/1"), "visibleIds should contain abc123/1");
      assert.strictEqual(edges.size, 2, "Should have separate edges for each divergent commit");
    });

    it("handles parent refs with divergent=false and non-zero offset", () => {
      const divergentParent = { change_id: "xyz789", divergent: false, change_offset: "1" };
      const entries: LogEntry[] = [
        createEntry("A", [divergentParent]),
        createEntry("xyz789", [], { divergent: false, change_offset: "1" }),
      ];

      const { edges, visibleIds } = classifyEdges(entries);

      assert.ok(visibleIds.has("xyz789/1"), "visibleIds should contain xyz789/1");
      const aEdges = edges.get("A");
      assert.ok(aEdges, "Should have edges for A");
      assert.strictEqual(aEdges.length, 1, "A should have one edge to xyz789/1");
      assert.strictEqual(aEdges[0].targetId, "xyz789/1", "Edge should target xyz789/1");
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

      const { edges, visibleIds } = classifyEdges(entries);
      const result = insertSyntheticNodes(entries, edges, visibleIds);

      assert.strictEqual(result.length, 2);
    });

    it("inserts synthetic node after commit with missing parent", () => {
      const entries: LogEntry[] = [createEntry("A", [parentRef("X")]), createEntry("B", [])];

      const { edges, visibleIds } = classifyEdges(entries);
      const result = insertSyntheticNodes(entries, edges, visibleIds);

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

      const { edges, visibleIds } = classifyEdges(entries);
      const result = insertSyntheticNodes(entries, edges, visibleIds);

      assert.strictEqual(result.length, 4);
    });

    it("synthetic node for missing edge has no parents", () => {
      const entries: LogEntry[] = [createEntry("A", [parentRef("X")]), createEntry("B", [])];

      const { edges, visibleIds } = classifyEdges(entries);
      const result = insertSyntheticNodes(entries, edges, visibleIds);

      const synthEntry = result.find((e) => e.change_id === "X");
      assert.ok(synthEntry);
      assert.deepStrictEqual(synthEntry.parents, []);
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

      const { edges, visibleIds } = classifyEdges(entries);

      const result = insertSyntheticNodes(entries, edges, visibleIds);

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

      const { edges, visibleIds } = classifyEdges(entries);

      assert.deepStrictEqual([...visibleIds].sort(), ["A", "D", "left-B", "right-B"]);

      const bEdges = edges.get("right-B")!;
      assert.strictEqual(bEdges.length, 1);
      assert.strictEqual(bEdges[0].edgeType, "indirect");
      assert.strictEqual(bEdges[0].targetId, "D");

      const result = insertSyntheticNodes(entries, edges, visibleIds);

      const changeIds = result.map((e) => e.change_id);
      assert.deepStrictEqual(changeIds, ["A", "right-B", "~right-B~D", "left-B", "D"]);
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

      const { edges, visibleIds } = classifyEdges(entries);

      assert.deepStrictEqual([...visibleIds].sort(), ["A", "B", "D", "Z"]);

      const bEdges = edges.get("B")!;
      assert.strictEqual(bEdges.length, 2);
      bEdges.sort((a, b) => a.targetId.localeCompare(b.targetId));
      assert.deepStrictEqual(bEdges, [
        { targetId: "D", edgeType: "indirect" },
        { targetId: "X", edgeType: "missing" },
      ]);

      const result = insertSyntheticNodes(entries, edges, visibleIds);

      const changeIds = result.map((e) => e.change_id);
      assert.deepStrictEqual(changeIds, ["A", "B", "X", "~B~D", "Z", "D", "E"]);

      const bEntry = result.find((e) => e.change_id === "B");
      assert.ok(bEntry);
      assert.deepStrictEqual(bEntry.parents, [
        { change_id: "~B~D", divergent: false, change_offset: "" },
        { change_id: "X", divergent: false, change_offset: "" },
      ]);
    });

    it("real-world repo with missing parent", () => {
      const entries: LogEntry[] = [
        createEntry("qs", [parentRef("wt")], { current_working_copy: true }),
        createEntry("wt", [{ change_id: "oq", divergent: false, change_offset: "0" }], {
          immutable: true,
        }),
        createEntry("oq", [{ change_id: "nx", divergent: false, change_offset: "0" }, parentRef("ww")], {
          immutable: true,
          change_offset: "0",
        }),
        createEntry("nx", [{ change_id: "zz", divergent: false, change_offset: "0" }], {
          immutable: true,
          change_offset: "0",
        }),
        createEntry("vw", [parentRef("ww")], {}),
        createEntry("ww", [{ change_id: "zz", divergent: false, change_offset: "0" }], {
          immutable: true,
        }),
        createEntry("zz/0", [], { immutable: true, root: true, empty: true }),
      ];

      const { edges, visibleIds } = classifyEdges(entries);

      assert.deepStrictEqual([...visibleIds].sort(), ["qs", "vw", "wt", "ww"]);

      const wtEdges = edges.get("wt")!;
      assert.strictEqual(wtEdges.length, 2);
      assert.deepStrictEqual(wtEdges, [
        { targetId: "nx/0", edgeType: "missing" },
        { targetId: "ww", edgeType: "indirect" },
      ]);

      const result = insertSyntheticNodes(entries, edges, visibleIds);

      const wtEntry = result[1];
      assert.strictEqual(wtEntry.change_id, "wt");
      assert.strictEqual(wtEntry.parents.length, 2);
      assert.deepStrictEqual(wtEntry.parents[0].change_id, "nx");
      assert.deepStrictEqual(wtEntry.parents[1].change_id, "~wt~ww");

      const changeIds = result.map((e) => e.change_id);
      assert.deepStrictEqual(changeIds, ["qs", "wt", "~wt~ww", "nx/0", "vw", "ww", "zz/0"]);
    });

    it("rewrites parents of visible entries to match classified edges", () => {
      const entries: LogEntry[] = [
        createEntry("A", [parentRef("H1")]),
        createEntry("H1", [parentRef("C")], { immutable: true }),
        createEntry("C", []),
      ];

      const edges = new Map<string, ClassifiedEdge[]>([["A", [{ targetId: "C", edgeType: "indirect" }]]]);
      const visibleIds = new Set(["A", "C"]);

      const result = insertSyntheticNodes(entries, edges, visibleIds);

      assert.deepStrictEqual(
        result.map((e) => e.change_id),
        ["A", "~A~C", "C"],
      );
      assert.deepStrictEqual(
        result[0].parents,
        [{ change_id: "~A~C", divergent: false, change_offset: "" }],
        "A's parent should be rewritten from hidden H1 to synthetic ~A~C",
      );
    });

    it("rewrites parents with change_offset from classified edge target", () => {
      const entries: LogEntry[] = [
        createEntry("A", [parentRef("B"), parentRef("C")]),
        createEntry("B", [parentRef("D")], {}),
        createEntry("D", [parentRef("Z")], {}),
        createEntry("Z", []),
      ];

      const edges = new Map<string, ClassifiedEdge[]>([["A", [{ targetId: "D", edgeType: "indirect" }]]]);
      const visibleIds = new Set(["A", "D"]);

      const result = insertSyntheticNodes(entries, edges, visibleIds);

      assert.strictEqual(result[0].change_id, "A");
      assert.deepStrictEqual(result[0].parents, [{ change_id: "~A~D", divergent: false, change_offset: "" }]);
    });

    it("rewrites parents from classified edge target with non-zero change offsets", () => {
      const entries: LogEntry[] = [
        createEntry("w", [parentRef("zyo"), parentRef("s")]),
        createEntry("s", [parentRef("zyo")]),
        createEntry("zyo", [parentRef("p")]),
        createEntry("kk", [parentRef("p")]),
        createEntry("p", [parentRef("xlyl")], { immutable: true }),
        createEntry("l", [{ change_id: "zyu", divergent: false, change_offset: "1" }], { change_offset: "1" }),
        createEntry("zyu", [{ change_id: "vw", divergent: false, change_offset: "1" }], {
          immutable: true,
          change_offset: "1",
        }),
      ];

      const { edges, visibleIds } = classifyEdges(entries);
      const result = insertSyntheticNodes(entries, edges, visibleIds);

      assert.strictEqual(result[0].change_id, "w");
      assert.deepStrictEqual(result[0].parents, [
        { change_id: "zyo", divergent: false, change_offset: "" },
        { change_id: "s", divergent: false, change_offset: "" },
      ]);
    });

    it("rewrites parents and inserts synthetic nodes simultaneously", () => {
      const entries: LogEntry[] = [
        createEntry("A", [parentRef("H1")]),
        createEntry("H1", [parentRef("X")], { immutable: true }),
        createEntry("C", [parentRef("X")]),
      ];

      const edges = new Map<string, ClassifiedEdge[]>([
        ["A", [{ targetId: "X", edgeType: "indirect" }]],
        ["C", [{ targetId: "X", edgeType: "missing" }]],
      ]);
      const visibleIds = new Set(["A", "C"]);

      const result = insertSyntheticNodes(entries, edges, visibleIds);

      assert.deepStrictEqual(
        result.map((e) => e.change_id),
        ["A", "~A~X", "C", "X"],
      );
      assert.deepStrictEqual(
        result[0].parents,
        [{ change_id: "~A~X", divergent: false, change_offset: "" }],
        "A's parent should be rewritten to ~A~X",
      );
      assert.deepStrictEqual(
        result[2].parents,
        [{ change_id: "X", divergent: false, change_offset: "" }],
        "C's parent should be rewritten from original X to match classified edge",
      );
    });

    it("distinguishes divergent commits", () => {
      const entries: LogEntry[] = [
        createEntry("A", [parentRef("C")], { divergent: true, change_offset: "0" }),
        createEntry("A", [parentRef("C")], { divergent: true, change_offset: "1" }),
        createEntry("C", [], { immutable: true }),
      ];

      const { edges, visibleIds } = classifyEdges(entries);

      assert.deepStrictEqual([...visibleIds].sort(), ["A/0", "A/1", "C"]);

      const a0Edges = edges.get("A/0")!;
      assert.strictEqual(a0Edges.length, 1);
      assert.strictEqual(a0Edges[0].edgeType, "direct");
      assert.strictEqual(a0Edges[0].targetId, "C");

      const a1Edges = edges.get("A/1")!;
      assert.strictEqual(a1Edges.length, 1);
      assert.strictEqual(a1Edges[0].edgeType, "direct");
      assert.strictEqual(a1Edges[0].targetId, "C");

      const result = insertSyntheticNodes(entries, edges, visibleIds);

      assert.deepStrictEqual(
        result.map((e) => e.change_id),
        ["A", "A", "C"],
      );
      assert.deepStrictEqual(
        result.map((e) => e.divergent),
        [true, true, false],
      );
    });
  });
});
