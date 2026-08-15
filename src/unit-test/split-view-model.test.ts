/* eslint-disable @typescript-eslint/no-floating-promises */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  buildSplitHunks,
  createSplitCheckboxState,
  getFileCheckState,
  getHunkCheckState,
  getLineChecked,
  getModeChecked,
  getRenameChecked,
  setLineChecked,
} from "../split/hunk-model";
import {
  buildSplitFileViewModels,
  hasExpandableSplitEntries,
  isExpandableSplitEntry,
  modeChangeOf,
  toggleSplitFileChecked,
  toggleSplitHunkChecked,
  toggleSplitModeChecked,
  toggleSplitRenameChecked,
} from "../webview/split/view-model";
import type { SplitCheckboxState } from "../split/hunk-model";
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

  it("pairs a modified line of a renamed file into a single hunk group", () => {
    // One changed line ("5346" → "53465") with the old line repeating after it: the split view
    // must show one del/add hunk, not an addition and a deletion separated by context.
    const leftText = "34\n6546\n5\n346\n5\n56\n6546\n36\n5346\n5346\n5\n346\n53\n46\n534\n65\n4\n6\n";
    const rightText = leftText.replace("5346\n5346\n5\n", "53465\n5346\n5\n");
    const [model] = buildSplitFileViewModels([
      {
        path: "test-renamed.txt",
        renamedFrom: "test.txt",
        status: "R",
        binary: false,
        conflict: false,
        leftText,
        rightText,
      },
    ]);
    assert.equal(model.hunkGroups.length, 1);
    assert.deepEqual(model.contextCounts, [8, 9]);
    assert.equal(model.hunkGroups[0].removedCount, 1);
    assert.equal(model.hunkGroups[0].addedCount, 1);
    assert.deepEqual(
      model.hunkGroups[0].hunk.lines.map((l) => [l.kind, l.text]),
      [
        ["del", "5346\n"],
        ["add", "53465\n"],
      ],
    );
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

  it("expands modified files with only a mode change", () => {
    const [model] = buildSplitFileViewModels([
      {
        path: "f.sh",
        status: "M",
        binary: false,
        conflict: false,
        modeChangedFrom: "100644",
        modeChangedTo: "100755",
        leftText: "#!/bin/sh\n",
        rightText: "#!/bin/sh\n",
      },
    ]);
    // Identical contents leave no content hunks; the mode change is the only checkable.
    assert.equal(isExpandableSplitEntry(model.entry), true);
    assert.equal(hasExpandableSplitEntries(model), true);
    assert.equal(modeChangeOf(model.entry), "100755");
    assert.equal(model.hunkGroups.length, 0);
  });

  it("expands a mode change on top of content hunks and renames", () => {
    const models = buildSplitFileViewModels([
      {
        path: "f.sh",
        status: "M",
        binary: false,
        conflict: false,
        modeChangedFrom: "100644",
        modeChangedTo: "100755",
        leftText: "a\n",
        rightText: "b\n",
      },
      {
        path: "new.sh",
        renamedFrom: "old.sh",
        status: "R",
        binary: false,
        conflict: false,
        modeChangedFrom: "100755",
        modeChangedTo: "100644",
        leftText: "a\n",
        rightText: "a\n",
      },
    ]);
    assert.equal(modeChangeOf(models[0].entry), "100755");
    assert.equal(models[0].hunkGroups.length, 1);
    assert.equal(hasExpandableSplitEntries(models[0]), true);
    assert.equal(modeChangeOf(models[1].entry), "100644");
    assert.equal(models[1].hunkGroups.length, 0);
    assert.equal(hasExpandableSplitEntries(models[1]), true);
  });

  it("offers no mode-change entry for files without a mode change or without both sides", () => {
    const models = buildSplitFileViewModels([
      modifiedEntry("same.txt", "a\n", "a\n"),
      { path: "added.txt", status: "A", binary: false, conflict: false, rightText: "a\n" },
      { path: "gone.txt", status: "D", binary: false, conflict: false, leftText: "a\n" },
    ]);
    for (const model of models) {
      assert.equal(modeChangeOf(model.entry), undefined);
      assert.equal(
        hasExpandableSplitEntries(model),
        model.entry.path === "added.txt" || model.entry.path === "gone.txt",
      );
    }
  });
});

describe("split file/hunk toggle Test Suite", () => {
  /** A modified file with two single-line hunks (b → B and e → E) around unchanged lines. */
  function twoHunkModel() {
    return buildSplitFileViewModels([modifiedEntry("f.txt", "a\nb\nc\nd\ne\nf\n", "a\nB\nc\nd\nE\nf\n")])[0];
  }

  it("toggling a fully checked file unchecks every line, and toggling again re-checks them", () => {
    const model = twoHunkModel();
    const state: SplitCheckboxState = createSplitCheckboxState();
    assert.equal(getFileCheckState(model.entry, state), true);

    toggleSplitFileChecked(model, state);
    assert.equal(getFileCheckState(model.entry, state), false);
    for (const group of model.hunkGroups) {
      assert.equal(getHunkCheckState("f.txt", group.hunk, state), false);
      for (const line of group.hunk.lines) {
        assert.equal(getLineChecked("f.txt", line, state), false);
      }
    }

    toggleSplitFileChecked(model, state);
    assert.equal(getFileCheckState(model.entry, state), true);
    for (const group of model.hunkGroups) {
      assert.equal(getHunkCheckState("f.txt", group.hunk, state), true);
    }
  });

  it("toggling a partially checked file unchecks its remaining lines", () => {
    const model = twoHunkModel();
    const state: SplitCheckboxState = createSplitCheckboxState();
    // One excluded line leaves the file checkbox indeterminate.
    setLineChecked("f.txt", model.hunkGroups[0].hunk.lines[0], state, false);
    assert.equal(getFileCheckState(model.entry, state), "indeterminate");

    toggleSplitFileChecked(model, state);
    assert.equal(getFileCheckState(model.entry, state), false);
    for (const group of model.hunkGroups) {
      for (const line of group.hunk.lines) {
        assert.equal(getLineChecked("f.txt", line, state), false);
      }
    }
  });

  it("toggling a hunk unchecks only that hunk's lines and turns the file indeterminate", () => {
    const model = twoHunkModel();
    const state: SplitCheckboxState = createSplitCheckboxState();

    toggleSplitHunkChecked("f.txt", model.hunkGroups[0].hunk, state);
    assert.equal(getHunkCheckState("f.txt", model.hunkGroups[0].hunk, state), false);
    assert.equal(getHunkCheckState("f.txt", model.hunkGroups[1].hunk, state), true);
    for (const line of model.hunkGroups[0].hunk.lines) {
      assert.equal(getLineChecked("f.txt", line, state), false);
    }
    for (const line of model.hunkGroups[1].hunk.lines) {
      assert.equal(getLineChecked("f.txt", line, state), true);
    }
    assert.equal(getFileCheckState(model.entry, state), "indeterminate");
  });

  it("toggling a partially checked hunk unchecks its remaining lines", () => {
    const model = twoHunkModel();
    const state: SplitCheckboxState = createSplitCheckboxState();
    setLineChecked("f.txt", model.hunkGroups[0].hunk.lines[0], state, false);
    assert.equal(getHunkCheckState("f.txt", model.hunkGroups[0].hunk, state), "indeterminate");

    toggleSplitHunkChecked("f.txt", model.hunkGroups[0].hunk, state);
    assert.equal(getHunkCheckState("f.txt", model.hunkGroups[0].hunk, state), false);
    for (const line of model.hunkGroups[0].hunk.lines) {
      assert.equal(getLineChecked("f.txt", line, state), false);
    }

    // A fully unchecked hunk toggles back to fully checked.
    toggleSplitHunkChecked("f.txt", model.hunkGroups[0].hunk, state);
    assert.equal(getHunkCheckState("f.txt", model.hunkGroups[0].hunk, state), true);
  });

  it("toggling a file covers its rename, mode change, and content hunks", () => {
    const [model] = buildSplitFileViewModels([
      {
        path: "new.sh",
        renamedFrom: "old.sh",
        status: "R",
        binary: false,
        conflict: false,
        modeChangedFrom: "100644",
        modeChangedTo: "100755",
        leftText: "a\n",
        rightText: "b\n",
      },
    ]);
    assert.equal(model.hunkGroups.length, 1);

    const state: SplitCheckboxState = createSplitCheckboxState();
    toggleSplitFileChecked(model, state);
    assert.equal(getFileCheckState(model.entry, state), false);
    assert.equal(getRenameChecked("new.sh", state), false);
    assert.equal(getModeChecked("new.sh", state), false);
    assert.equal(getHunkCheckState("new.sh", model.hunkGroups[0].hunk, state), false);

    toggleSplitFileChecked(model, state);
    assert.equal(getFileCheckState(model.entry, state), true);
    assert.equal(getRenameChecked("new.sh", state), true);
    assert.equal(getModeChecked("new.sh", state), true);
    assert.equal(getHunkCheckState("new.sh", model.hunkGroups[0].hunk, state), true);
  });

  it("toggling a rename row flips only the rename, leaving content hunks and the mode change checked", () => {
    const [model] = buildSplitFileViewModels([
      {
        path: "new.sh",
        renamedFrom: "old.sh",
        status: "R",
        binary: false,
        conflict: false,
        modeChangedFrom: "100644",
        modeChangedTo: "100755",
        leftText: "a\n",
        rightText: "b\n",
      },
    ]);
    const state: SplitCheckboxState = createSplitCheckboxState();

    toggleSplitRenameChecked("new.sh", state);
    assert.equal(getRenameChecked("new.sh", state), false);
    assert.equal(getModeChecked("new.sh", state), true);
    assert.equal(getHunkCheckState("new.sh", model.hunkGroups[0].hunk, state), true);
    assert.equal(getFileCheckState(model.entry, state), "indeterminate");

    toggleSplitRenameChecked("new.sh", state);
    assert.equal(getRenameChecked("new.sh", state), true);
    assert.equal(getFileCheckState(model.entry, state), true);
  });

  it("toggling a mode-change row flips only the mode change, leaving content hunks and the rename checked", () => {
    const [model] = buildSplitFileViewModels([
      {
        path: "new.sh",
        renamedFrom: "old.sh",
        status: "R",
        binary: false,
        conflict: false,
        modeChangedFrom: "100644",
        modeChangedTo: "100755",
        leftText: "a\n",
        rightText: "b\n",
      },
    ]);
    const state: SplitCheckboxState = createSplitCheckboxState();

    toggleSplitModeChecked("new.sh", state);
    assert.equal(getModeChecked("new.sh", state), false);
    assert.equal(getRenameChecked("new.sh", state), true);
    assert.equal(getHunkCheckState("new.sh", model.hunkGroups[0].hunk, state), true);
    assert.equal(getFileCheckState(model.entry, state), "indeterminate");

    toggleSplitModeChecked("new.sh", state);
    assert.equal(getModeChecked("new.sh", state), true);
    assert.equal(getFileCheckState(model.entry, state), true);
  });

  it("toggling a whole-file leaf records the file-level state", () => {
    const [model] = buildSplitFileViewModels([{ path: "b.bin", status: "M", binary: true, conflict: false }]);
    assert.equal(model.hunkGroups.length, 0);

    const state: SplitCheckboxState = createSplitCheckboxState();
    toggleSplitFileChecked(model, state);
    assert.equal(state.files["b.bin"], false);
    assert.equal(getFileCheckState(model.entry, state), false);

    toggleSplitFileChecked(model, state);
    assert.equal(state.files["b.bin"], true);
    assert.equal(getFileCheckState(model.entry, state), true);
  });
});
