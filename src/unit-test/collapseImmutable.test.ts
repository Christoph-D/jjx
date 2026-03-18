/* eslint-disable @typescript-eslint/no-floating-promises */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { collapseImmutableEntries } from "../collapser";
import type { LogEntry, ParentRef } from "../repository";

function makeEntry(change_id: string, parents: string[] | ParentRef[], overrides: Partial<LogEntry> = {}): LogEntry {
  const parentRefs: ParentRef[] = parents.map((p) =>
    typeof p === "string" ? { change_id: p, divergent: false, change_offset: "" } : p,
  );
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
    divergent: false,
    change_offset: "",
    description: `commit ${change_id}`,
    author: { name: "Test", email: "test@test.com", timestamp: "2025-01-01" },
    committer: {
      name: "Test",
      email: "test@test.com",
      timestamp: "2025-01-01",
    },
    diff: { total_added: 0, total_removed: 0, files: [] },
    parents: parentRefs,
    local_bookmarks: [],
    remote_bookmarks: [],
    local_tags: [],
    remote_tags: [],
    working_copies: [],
    ...overrides,
  };
}

describe("collapseImmutableEntries", () => {
  it("returns entries unchanged when no immutable entries", () => {
    const entries = [makeEntry("aaa", ["bbb"]), makeEntry("bbb", ["ccc"]), makeEntry("ccc", [])];
    const { entries: result, elidedMap } = collapseImmutableEntries(entries);

    assert.strictEqual(result.length, 3);
    assert.strictEqual(elidedMap.size, 0);
    assert.strictEqual(result[0].change_id, "aaa");
    assert.strictEqual(result[1].change_id, "bbb");
    assert.strictEqual(result[2].change_id, "ccc");
  });

  it("returns entries unchanged when empty", () => {
    const { entries: result, elidedMap } = collapseImmutableEntries([]);

    assert.strictEqual(result.length, 0);
    assert.strictEqual(elidedMap.size, 0);
  });

  it("does not collapse immutable entry with mutable child but collapses deeper ones", () => {
    // aaa (mutable) → bbb (immutable) → ccc (immutable)
    // bbb has mutable child → shown
    // ccc has only immutable child bbb → elided
    const entries = [
      makeEntry("aaa", ["bbb"]),
      makeEntry("bbb", ["ccc"], { immutable: true }),
      makeEntry("ccc", [], { immutable: true }),
    ];
    const { entries: result, elidedMap } = collapseImmutableEntries(entries);

    assert.strictEqual(result.length, 3);
    assert.strictEqual(result[0].change_id, "aaa");
    assert.strictEqual(result[1].change_id, "bbb");
    assert.ok(result[2].change_id.startsWith("__elided_"));
    assert.strictEqual(elidedMap.size, 1);
    const info = elidedMap.get(result[2].change_id);
    assert.ok(info);
    assert.strictEqual(info.count, 1);
  });

  it("does not collapse immutable entry with mutable child", () => {
    // aaa (mutable) → bbb (immutable, shown because has mutable child)
    const entries = [makeEntry("aaa", ["bbb"]), makeEntry("bbb", [], { immutable: true })];
    const { entries: result, elidedMap } = collapseImmutableEntries(entries);

    assert.strictEqual(result.length, 2);
    assert.strictEqual(elidedMap.size, 0);
    assert.strictEqual(result[0].change_id, "aaa");
    assert.strictEqual(result[1].change_id, "bbb");
  });

  it("collapses linear chain of immutables after a shown immutable", () => {
    // mutable_A → immutable_B → immutable_C → immutable_D
    // B has mutable child A → shown
    // C has one immutable child B → elided
    // D has one immutable child C → elided
    const entries = [
      makeEntry("aaa", ["bbb"]),
      makeEntry("bbb", ["ccc"], { immutable: true }),
      makeEntry("ccc", ["ddd"], { immutable: true }),
      makeEntry("ddd", [], { immutable: true }),
    ];
    const { entries: result, elidedMap } = collapseImmutableEntries(entries);

    assert.strictEqual(result.length, 3);
    assert.strictEqual(result[0].change_id, "aaa");
    assert.strictEqual(result[1].change_id, "bbb");
    assert.ok(result[2].change_id.startsWith("__elided_"));
    assert.strictEqual(elidedMap.size, 1);
    const elidedInfo = elidedMap.get(result[2].change_id);
    assert.ok(elidedInfo);
    assert.strictEqual(elidedInfo.count, 2);
  });

  it("does not collapse immutable entry with zero children in visible set", () => {
    const entries = [makeEntry("aaa", ["bbb"], { immutable: true })];
    const { entries: result, elidedMap } = collapseImmutableEntries(entries);

    assert.strictEqual(result.length, 1);
    assert.strictEqual(elidedMap.size, 0);
    assert.strictEqual(result[0].change_id, "aaa");
  });

  it("does not collapse immutable with mixed mutable/immutable children", () => {
    // mutable_A → immutable_C
    // immutable_B → immutable_C
    // C has one mutable child → shown
    const entries = [
      makeEntry("aaa", ["ccc"]),
      makeEntry("bbb", ["ccc"], { immutable: true }),
      makeEntry("ccc", [], { immutable: true }),
    ];
    const { entries: result, elidedMap } = collapseImmutableEntries(entries);

    assert.strictEqual(result.length, 3);
    assert.strictEqual(elidedMap.size, 0);
  });

  it("collapses immutable with multiple immutable children", () => {
    // immutable_A → immutable_C
    // immutable_B → immutable_C
    // mutable_X → immutable_A
    // mutable_Y → immutable_B
    // C has two immutable children (A, B) → elided
    const entries = [
      makeEntry("xxx", ["aaa"]),
      makeEntry("yyy", ["bbb"]),
      makeEntry("aaa", ["ccc"], { immutable: true }),
      makeEntry("bbb", ["ccc"], { immutable: true }),
      makeEntry("ccc", [], { immutable: true }),
    ];
    const { entries: result, elidedMap } = collapseImmutableEntries(entries);

    assert.strictEqual(elidedMap.size, 1);
    const shownIds = result.map((e) => e.change_id);
    assert.ok(shownIds.includes("xxx"));
    assert.ok(shownIds.includes("yyy"));
    assert.ok(shownIds.includes("aaa"));
    assert.ok(shownIds.includes("bbb"));
    assert.ok(!shownIds.includes("ccc"));
    const elidedEntry = result.find((e) => e.change_id.startsWith("__elided_"));
    assert.ok(elidedEntry);
    const info = elidedMap.get(elidedEntry.change_id);
    assert.ok(info);
    assert.strictEqual(info.count, 1);
  });

  it("remaps parent references to point at elided group", () => {
    const entries = [
      makeEntry("aaa", ["bbb"]),
      makeEntry("bbb", ["ccc"], { immutable: true }),
      makeEntry("ccc", ["ddd"], { immutable: true }),
      makeEntry("ddd", ["eee"], { immutable: true }),
    ];
    const { entries: result } = collapseImmutableEntries(entries);

    // B's parent was C, which is elided. Should now point to the elided entry.
    const bEntry = result.find((e) => e.change_id === "bbb");
    assert.ok(bEntry);
    assert.strictEqual(bEntry.parents.length, 1);
    assert.ok(bEntry.parents[0].change_id.startsWith("__elided_"));

    // The elided entry's parent should be "eee" (the parent of "ddd", the last in the group)
    const elidedEntry = result.find((e) => e.change_id.startsWith("__elided_"));
    assert.ok(elidedEntry);
    assert.strictEqual(elidedEntry.parents.length, 1);
    assert.strictEqual(elidedEntry.parents[0].change_id, "eee");
  });

  it("deduplicates parent references after remapping when in same group", () => {
    // A has two parents B and C, both immutable and consecutive in the same group
    // B → D, C → D, so B and C are both elided. If they form a contiguous chain they merge.
    // But B→D and C→D means B and C are siblings, not a chain, so they become separate groups.
    // For dedup to happen, both parents must map to the SAME elided group.
    // Arrange: B and C consecutive, B→C chain so they merge into one group
    const entries = [
      makeEntry("aaa", ["bbb", "ccc"], { immutable: true }),
      makeEntry("xxx", ["aaa"]),
      makeEntry("bbb", ["ccc"], { immutable: true }),
      makeEntry("ccc", [], { immutable: true }),
    ];
    const { entries: result } = collapseImmutableEntries(entries);

    const aEntry = result.find((e) => e.change_id === "aaa");
    assert.ok(aEntry);
    // A's parents B and C are both in the same elided group, so should be deduped to 1
    const elidedParents = aEntry.parents.filter((p) => p.change_id.startsWith("__elided_"));
    assert.strictEqual(elidedParents.length, 1);
  });

  it("never collapses working copy even if immutable", () => {
    const entries = [
      makeEntry("aaa", ["bbb"], { immutable: true, current_working_copy: true }),
      makeEntry("bbb", [], { immutable: true }),
    ];
    const { entries: result, elidedMap } = collapseImmutableEntries(entries);

    assert.strictEqual(result.length, 2);
    assert.strictEqual(elidedMap.size, 0);
  });

  it("never collapses root even if immutable", () => {
    const entries = [
      makeEntry("aaa", ["bbb"], { immutable: true }),
      makeEntry("bbb", [], { immutable: true, root: true }),
    ];
    const { entries: result, elidedMap } = collapseImmutableEntries(entries);

    assert.strictEqual(result.length, 2);
    assert.strictEqual(elidedMap.size, 0);
  });

  it("creates multiple elided groups for non-contiguous runs", () => {
    // Branch 1: mut_A → imm_B → imm_C
    // Branch 2: mut_D → imm_E → imm_F
    // B shown (has mutable child), C elided
    // E shown (has mutable child), F elided
    const entries = [
      makeEntry("aaa", ["bbb"]),
      makeEntry("bbb", ["ccc"], { immutable: true }),
      makeEntry("ddd", ["eee"]),
      makeEntry("eee", ["fff"], { immutable: true }),
      makeEntry("ccc", [], { immutable: true }),
      makeEntry("fff", [], { immutable: true }),
    ];
    const { entries: result, elidedMap } = collapseImmutableEntries(entries);

    // ccc and fff are in separate contiguous runs (if ordered: aaa, bbb, ddd, eee, ccc, fff)
    // They should become separate elided groups
    const elidedEntries = result.filter((e) => e.change_id.startsWith("__elided_"));
    assert.strictEqual(elidedEntries.length, 2);
    assert.strictEqual(elidedMap.size, 2);
  });

  it("handles single immutable in chain (not elided alone)", () => {
    // mutable → immutable (single, has no immutable-only child chain)
    const entries = [makeEntry("aaa", ["bbb"]), makeEntry("bbb", [], { immutable: true })];
    const { entries: result, elidedMap } = collapseImmutableEntries(entries);

    // bbb has a mutable child aaa → shown
    assert.strictEqual(result.length, 2);
    assert.strictEqual(elidedMap.size, 0);
  });

  it("preserves the synthetic entry description", () => {
    const entries = [
      makeEntry("aaa", ["bbb"]),
      makeEntry("bbb", ["ccc"], { immutable: true }),
      makeEntry("ccc", ["ddd"], { immutable: true }),
      makeEntry("ddd", ["eee"], { immutable: true }),
      makeEntry("eee", [], { immutable: true }),
    ];
    const { entries: result, elidedMap } = collapseImmutableEntries(entries);

    const elidedEntry = result.find((e) => e.change_id.startsWith("__elided_"));
    assert.ok(elidedEntry);
    assert.strictEqual(elidedEntry.description, "3 elided");
    const info = elidedMap.get(elidedEntry.change_id);
    assert.ok(info);
    assert.strictEqual(info.count, 3);
  });
});
