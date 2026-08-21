/* eslint-disable @typescript-eslint/no-floating-promises */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { computeSelection, elidedRangeSelectionWarning } from "../webview/graph/selection";
import type { ChangeNode, FullChangeId, RegularChangeNode } from "../graph-protocol";

function full(id: string): FullChangeId {
  return id as FullChangeId;
}

function regular(id: string): RegularChangeNode {
  return {
    id: {
      changeId: full(id),
      changeIdPrefix: id.slice(0, 4),
      changeIdSuffix: "",
      changeOffset: null,
    },
    commitId: id,
    label: id,
    description: id,
    tooltip: id,
    currentWorkingCopy: false,
    localBookmarks: [],
    remoteBookmarks: [],
    localTags: [],
    remoteTags: [],
    workingCopies: [],
    branchType: "○",
    authorName: "Test",
    authorEmail: "test@test.com",
    authorTimestamp: "2024-01-01",
    fullDescription: id,
    mine: true,
    conflict: false,
    isEmpty: false,
  };
}

function elided(fakeId: string): ChangeNode {
  return { fakeId, branchType: "~" };
}

function ids(selection: Set<FullChangeId>): string[] {
  return [...selection].sort();
}

describe("computeSelection", () => {
  const plain = { shiftKey: false, toggleKey: false };
  const shift = { shiftKey: true, toggleKey: false };
  const toggle = { shiftKey: false, toggleKey: true };

  it("selects only the clicked change on plain click and sets the anchor", () => {
    const changes: ChangeNode[] = [regular("a"), regular("b"), regular("c")];
    const outcome = computeSelection(changes, 2, null, new Set([full("a")]), plain);

    assert.equal(outcome.kind, "applied");
    if (outcome.kind === "applied") {
      assert.deepEqual(ids(outcome.selection), ["c"]);
      assert.equal(outcome.anchor, full("c"));
    }
  });

  it("toggles a single change in on ctrl+click", () => {
    const changes: ChangeNode[] = [regular("a"), regular("b"), regular("c")];
    const outcome = computeSelection(changes, 1, full("a"), new Set([full("a")]), toggle);

    assert.equal(outcome.kind, "applied");
    if (outcome.kind === "applied") {
      assert.deepEqual(ids(outcome.selection), ["a", "b"]);
      assert.equal(outcome.anchor, full("b"));
    }
  });

  it("toggles a single change out on ctrl+click", () => {
    const changes: ChangeNode[] = [regular("a"), regular("b"), regular("c")];
    const outcome = computeSelection(changes, 1, full("c"), new Set([full("b"), full("c")]), toggle);

    assert.equal(outcome.kind, "applied");
    if (outcome.kind === "applied") {
      assert.deepEqual(ids(outcome.selection), ["c"]);
      assert.equal(outcome.anchor, full("b"));
    }
  });

  it("selects a contiguous range on shift+click", () => {
    const changes: ChangeNode[] = [regular("a"), regular("b"), regular("c"), regular("d")];
    const outcome = computeSelection(changes, 3, full("b"), new Set([full("b")]), shift);

    assert.equal(outcome.kind, "applied");
    if (outcome.kind === "applied") {
      assert.deepEqual([...outcome.selection], [full("b"), full("c"), full("d")]);
      assert.equal(outcome.anchor, full("b"));
    }
  });

  it("selects a contiguous range backwards on shift+click, ordered from the anchor", () => {
    const changes: ChangeNode[] = [regular("a"), regular("b"), regular("c"), regular("d")];
    const outcome = computeSelection(changes, 0, full("c"), new Set([full("c")]), shift);

    assert.equal(outcome.kind, "applied");
    if (outcome.kind === "applied") {
      assert.deepEqual([...outcome.selection], [full("c"), full("b"), full("a")]);
      assert.equal(outcome.anchor, full("c"));
    }
  });

  it("replaces the selection when shift+clicking a new range", () => {
    const changes: ChangeNode[] = [regular("a"), regular("b"), regular("c"), regular("d")];
    const outcome = computeSelection(changes, 3, full("a"), new Set([full("b"), full("c")]), shift);

    assert.equal(outcome.kind, "applied");
    if (outcome.kind === "applied") {
      assert.deepEqual([...outcome.selection], [full("a"), full("b"), full("c"), full("d")]);
    }
  });

  it("warns when the range contains an elided change", () => {
    const changes: ChangeNode[] = [regular("a"), elided("e1"), regular("c"), regular("d")];
    const outcome = computeSelection(changes, 3, full("a"), new Set([full("a")]), shift);

    assert.deepEqual(outcome, { kind: "warning", message: elidedRangeSelectionWarning });
  });

  it("warns when a backwards range contains an elided change", () => {
    const changes: ChangeNode[] = [regular("a"), elided("e1"), regular("c"), regular("d")];
    const outcome = computeSelection(changes, 0, full("d"), new Set([full("d")]), shift);

    assert.deepEqual(outcome, { kind: "warning", message: elidedRangeSelectionWarning });
  });

  it("warns when shift+clicking an elided change directly", () => {
    const changes: ChangeNode[] = [regular("a"), elided("e1"), regular("c")];
    const outcome = computeSelection(changes, 1, full("a"), new Set([full("a")]), shift);

    assert.deepEqual(outcome, { kind: "warning", message: elidedRangeSelectionWarning });
  });

  it("selects only the clicked change on shift+click without an anchor", () => {
    const changes: ChangeNode[] = [regular("a"), regular("b"), regular("c")];
    const outcome = computeSelection(changes, 1, null, new Set(), shift);

    assert.equal(outcome.kind, "applied");
    if (outcome.kind === "applied") {
      assert.deepEqual(ids(outcome.selection), ["b"]);
      assert.equal(outcome.anchor, full("b"));
    }
  });

  it("selects only the clicked change when the anchor is no longer visible", () => {
    const changes: ChangeNode[] = [regular("a"), regular("b"), regular("c")];
    const outcome = computeSelection(changes, 1, full("zzz"), new Set(), shift);

    assert.equal(outcome.kind, "applied");
    if (outcome.kind === "applied") {
      assert.deepEqual(ids(outcome.selection), ["b"]);
      assert.equal(outcome.anchor, full("b"));
    }
  });

  it("selects a single change when shift+clicking the anchor itself", () => {
    const changes: ChangeNode[] = [regular("a"), regular("b"), regular("c")];
    const outcome = computeSelection(changes, 1, full("b"), new Set([full("a"), full("b"), full("c")]), shift);

    assert.equal(outcome.kind, "applied");
    if (outcome.kind === "applied") {
      assert.deepEqual(ids(outcome.selection), ["b"]);
      assert.equal(outcome.anchor, full("b"));
    }
  });
});
