/* eslint-disable @typescript-eslint/no-floating-promises */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { buildSplitHunks } from "../split/hunk-model";
import { buildSplitFileViewModels, isExpandableSplitEntry } from "../webview/split/view-model";
import type { SplitViewFileEntry } from "../split-protocol";

function modifiedEntry(path: string, left: string, right: string): SplitViewFileEntry {
  return { path, status: "M", binary: false, conflict: false, leftText: left, rightText: right };
}

describe("buildSplitFileViewModels Test Suite", () => {
  it("groups changed lines into hunks with unchanged separator counts", () => {
    const left = "a\nb\nc\nd\ne\nf\ng\nh\n";
    const right = "a\nB\nc\nd\ne\nf\nG\nh\nX\n";
    const [model] = buildSplitFileViewModels([modifiedEntry("f.txt", left, right)]);

    assert.equal(model.hunkGroups.length, 3);
    // Leading context a, hunk b→B, context c-f, hunk g→G, context h, hunk +X.
    assert.deepEqual(model.contextCounts, [1, 4, 1, 0]);
    assert.deepEqual(
      model.hunkGroups.map((group) => [group.addedCount, group.removedCount]),
      [
        [1, 1],
        [1, 1],
        [1, 0],
      ],
    );
    // The attached hunks match the hunk model's own grouping.
    assert.deepEqual(model.entry.hunks, buildSplitHunks(left, right));
  });

  it("separates trailing context after a change at the start of the file", () => {
    const [model] = buildSplitFileViewModels([modifiedEntry("f.txt", "a\n", "b\na\n")]);
    assert.equal(model.hunkGroups.length, 1);
    assert.deepEqual(model.contextCounts, [0, 1]);
  });

  it("keeps non-modified, binary, and conflicted files as whole-file leaves", () => {
    const entries: SplitViewFileEntry[] = [
      { path: "added.bin", status: "A", binary: true, conflict: false },
      { path: "deleted.bin", status: "D", binary: true, conflict: false },
      { path: "renamed.txt", renamedFrom: "old.txt", status: "R", binary: false, conflict: false, leftText: "x\n" },
      {
        path: "renamed.bin",
        renamedFrom: "old.bin",
        status: "R",
        binary: true,
        conflict: false,
        leftText: "x\n",
        rightText: "y\n",
      },
      { path: "bin.dat", status: "M", binary: true, conflict: false, leftText: "a\n", rightText: "b\n" },
      { path: "conflict.txt", status: "M", binary: false, conflict: true, leftText: "a\n", rightText: "b\n" },
    ];
    const models = buildSplitFileViewModels(entries);
    for (const model of models) {
      assert.equal(model.hunkGroups.length, 0);
      assert.equal(model.entry.hunks, undefined);
    }
    assert.deepEqual(entries.map(isExpandableSplitEntry), [false, false, false, false, false, false]);
  });

  it("expands renames with content changes like modified files", () => {
    const [model] = buildSplitFileViewModels([
      {
        path: "new.txt",
        renamedFrom: "old.txt",
        status: "R",
        binary: false,
        conflict: false,
        leftText: "a\nb\nc\n",
        rightText: "a\nB\nc\n",
      },
    ]);
    assert.equal(isExpandableSplitEntry(model.entry), true);
    assert.equal(model.hunkGroups.length, 1);
    assert.deepEqual(model.contextCounts, [1, 1]);
    assert.equal(model.hunkGroups[0].addedCount, 1);
    assert.equal(model.hunkGroups[0].removedCount, 1);
    assert.deepEqual(model.entry.hunks, buildSplitHunks("a\nb\nc\n", "a\nB\nc\n"));
  });

  it("keeps pure renames as leaves with a rename but no content hunks", () => {
    const [model] = buildSplitFileViewModels([
      {
        path: "new.txt",
        renamedFrom: "old.txt",
        status: "R",
        binary: false,
        conflict: false,
        leftText: "a\nb\n",
        rightText: "a\nb\n",
      },
    ]);
    // Both sides are present, so the entry qualifies as expandable, but the identical
    // contents leave nothing to pick beyond the "File Renamed" checkbox.
    assert.equal(isExpandableSplitEntry(model.entry), true);
    assert.equal(model.hunkGroups.length, 0);
    assert.equal(model.entry.hunks, undefined);
  });

  it("expands deleted text files into a single hunk removing all lines", () => {
    const [model] = buildSplitFileViewModels([
      { path: "gone.txt", status: "D", binary: false, conflict: false, leftText: "x\ny\n" },
    ]);
    assert.equal(isExpandableSplitEntry(model.entry), true);
    assert.equal(model.hunkGroups.length, 1);
    assert.deepEqual(model.contextCounts, [0, 0]);
    assert.equal(model.hunkGroups[0].addedCount, 0);
    assert.equal(model.hunkGroups[0].removedCount, 2);
    assert.deepEqual(
      model.entry.hunks?.[0].lines.map((l) => [l.kind, l.oldLine, l.text]),
      [
        ["del", 1, "x\n"],
        ["del", 2, "y\n"],
      ],
    );
  });

  it("expands added text files into a single hunk adding all lines", () => {
    const [model] = buildSplitFileViewModels([
      { path: "new.txt", status: "A", binary: false, conflict: false, rightText: "x\ny\n" },
    ]);
    assert.equal(isExpandableSplitEntry(model.entry), true);
    assert.equal(model.hunkGroups.length, 1);
    assert.deepEqual(model.contextCounts, [0, 0]);
    assert.equal(model.hunkGroups[0].addedCount, 2);
    assert.equal(model.hunkGroups[0].removedCount, 0);
    assert.deepEqual(
      model.entry.hunks?.[0].lines.map((l) => [l.kind, l.newLine, l.text]),
      [
        ["add", 1, "x\n"],
        ["add", 2, "y\n"],
      ],
    );
  });

  it("drops added files without any lines", () => {
    const [model] = buildSplitFileViewModels([
      { path: "empty.txt", status: "A", binary: false, conflict: false, rightText: "" },
    ]);
    assert.equal(model.hunkGroups.length, 0);
    assert.equal(model.entry.hunks, undefined);
  });

  it("drops modified files without any changed lines", () => {
    const [model] = buildSplitFileViewModels([modifiedEntry("same.txt", "a\n", "a\n")]);
    assert.equal(model.hunkGroups.length, 0);
    assert.equal(isExpandableSplitEntry(model.entry), true);
  });
});
