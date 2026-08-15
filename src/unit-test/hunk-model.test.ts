/* eslint-disable @typescript-eslint/no-floating-promises */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  buildSplitFileEntry,
  buildSplitHunks,
  buildSplitLines,
  createSplitCheckboxState,
  getAllFilesCheckState,
  getFileCheckState,
  getHunkCheckState,
  getLineChecked,
  getModeChecked,
  getRenameChecked,
  isSplitCheckboxStatePristine,
  lineKey,
  reconstructRightModes,
  reconstructRightSides,
  setAllFilesChecked,
  setFileChecked,
  setHunkChecked,
  setLineChecked,
  setModeChecked,
  setRenameChecked,
  splitFileLines,
} from "../split/hunk-model";
import type { SplitFileEntry, SplitLine } from "../split/hunk-model";

function textEntry(path: string, left: string, right: string): SplitFileEntry {
  return buildSplitFileEntry({
    path,
    status: "M",
    left: Buffer.from(left, "utf8"),
    right: Buffer.from(right, "utf8"),
  });
}

function addLineOf(entry: SplitFileEntry, hunkIndex: number, text: string): SplitLine {
  const line = entry.hunks?.[hunkIndex].lines.find((l) => l.kind === "add" && l.text === text);
  assert.ok(line, `no added line with text ${JSON.stringify(text)} in hunk ${hunkIndex}`);
  return line;
}

function delLineOf(entry: SplitFileEntry, hunkIndex: number, text: string): SplitLine {
  const line = entry.hunks?.[hunkIndex].lines.find((l) => l.kind === "del" && l.text === text);
  assert.ok(line, `no deleted line with text ${JSON.stringify(text)} in hunk ${hunkIndex}`);
  return line;
}

describe("splitFileLines Test Suite", () => {
  it("splits lines keeping LF and CRLF terminators", () => {
    assert.deepEqual(splitFileLines("a\nb\r\nc\n"), ["a\n", "b\r\n", "c\n"]);
  });

  it("keeps a final line without trailing newline", () => {
    assert.deepEqual(splitFileLines("a\nb"), ["a\n", "b"]);
  });

  it("returns no lines for empty content", () => {
    assert.deepEqual(splitFileLines(""), []);
  });

  it("keeps empty lines", () => {
    assert.deepEqual(splitFileLines("a\n\nb\n"), ["a\n", "\n", "b\n"]);
  });
});

describe("buildSplitLines Test Suite", () => {
  it("assigns old/new line numbers to context, added, and deleted lines", () => {
    const lines = buildSplitLines("a\nb\nc\n", "a\nx\nc\nd\n");
    assert.deepEqual(
      lines.map((l) => ({ kind: l.kind, oldLine: l.oldLine, newLine: l.newLine, text: l.text })),
      [
        { kind: "context", oldLine: 1, newLine: 1, text: "a\n" },
        { kind: "del", oldLine: 2, newLine: undefined, text: "b\n" },
        { kind: "add", oldLine: undefined, newLine: 2, text: "x\n" },
        { kind: "context", oldLine: 3, newLine: 3, text: "c\n" },
        { kind: "add", oldLine: undefined, newLine: 4, text: "d\n" },
      ],
    );
  });

  it("treats a missing trailing newline as a line change", () => {
    const lines = buildSplitLines("a\nb\n", "a\nb");
    assert.deepEqual(
      lines.map((l) => l.kind),
      ["context", "del", "add"],
    );
    assert.equal(lines[1].text, "b\n");
    assert.equal(lines[2].text, "b");
  });
});

describe("buildSplitHunks Test Suite", () => {
  it("returns no hunks for identical content", () => {
    assert.deepEqual(buildSplitHunks("a\nb\n", "a\nb\n"), []);
  });

  it("groups maximal runs of changed lines separated by context", () => {
    const hunks = buildSplitHunks("a\nb\nc\nd\ne\n", "a\nB\nc\nd\nE\n");
    assert.equal(hunks.length, 2);
    assert.deepEqual(
      hunks[0].lines.map((l) => l.kind),
      ["del", "add"],
    );
    assert.deepEqual(
      hunks[1].lines.map((l) => l.kind),
      ["del", "add"],
    );
  });

  it("keeps a del/add pair in one hunk", () => {
    const hunks = buildSplitHunks("a\nb\nc\n", "a\nx\ny\nc\n");
    assert.equal(hunks.length, 1);
    assert.deepEqual(
      hunks[0].lines.map((l) => [l.kind, l.text]),
      [
        ["del", "b\n"],
        ["add", "x\n"],
        ["add", "y\n"],
      ],
    );
  });

  it("groups pure insertions and pure deletions", () => {
    const hunks = buildSplitHunks("a\nb\nc\nd\n", "a\nb2\nc\nd\ne\n");
    // "b" -> "b2" is a replace hunk; the appended "e" is a pure insertion hunk.
    assert.equal(hunks.length, 2);
    assert.deepEqual(
      hunks[1].lines.map((l) => [l.kind, l.newLine, l.text]),
      [["add", 5, "e\n"]],
    );

    const delHunks = buildSplitHunks("a\nb\nc\n", "a\nc\n");
    assert.equal(delHunks.length, 1);
    assert.deepEqual(
      delHunks[0].lines.map((l) => [l.kind, l.oldLine, l.text]),
      [["del", 2, "b\n"]],
    );
  });

  it("pairs a modified line surrounded by equal lines into one hunk", () => {
    // The differ pairs the second "5346" with the new side's "5346", splitting the single
    // modification into an addition and a deletion around an unchanged line; the split view
    // slides them together like git's diff does (issue: renamed file with a non-empty diff).
    const left = "34\n6546\n5\n346\n5\n56\n6546\n36\n5346\n5346\n5\n346\n53\n46\n534\n65\n4\n6\n";
    const right = left.replace("5346\n5346\n5\n", "53465\n5346\n5\n");
    const hunks = buildSplitHunks(left, right);
    assert.equal(hunks.length, 1);
    assert.deepEqual(
      hunks[0].lines.map((l) => [l.kind, l.oldLine, l.newLine, l.text]),
      [
        ["del", 9, undefined, "5346\n"],
        ["add", undefined, 9, "53465\n"],
      ],
    );
  });

  it("pairs a deletion and an addition around a re-pairable unchanged line", () => {
    // The deletion of the second "b" and the addition of the second "c" stay apart in the
    // differ's pairing; the unchanged "c" between them lets them slide together.
    const hunks = buildSplitHunks("a\nb\nb\nc\n", "a\nb\nc\nc\n");
    assert.equal(hunks.length, 1);
    assert.deepEqual(
      hunks[0].lines.map((l) => [l.kind, l.oldLine, l.newLine, l.text]),
      [
        ["del", 3, undefined, "b\n"],
        ["add", undefined, 3, "c\n"],
      ],
    );
  });

  it("keeps changed lines apart when no unchanged line re-pairs them", () => {
    // The deleted "x" and the added "y" cannot slide through the unchanged "b" between them.
    const hunks = buildSplitHunks("a\nx\nx\nb\n", "a\nx\nb\ny\n");
    assert.equal(hunks.length, 2);
    assert.deepEqual(
      hunks.map((hunk) => hunk.lines.map((l) => [l.kind, l.oldLine, l.newLine, l.text])),
      [[["del", 3, undefined, "x\n"]], [["add", undefined, 4, "y\n"]]],
    );
  });

  it("handles empty left or right content", () => {
    assert.deepEqual(
      buildSplitHunks("", "a\nb\n").map((h) => h.lines.map((l) => [l.kind, l.newLine])),
      [
        [
          ["add", 1],
          ["add", 2],
        ],
      ],
    );
    assert.deepEqual(
      buildSplitHunks("a\nb\n", "").map((h) => h.lines.map((l) => [l.kind, l.oldLine])),
      [
        [
          ["del", 1],
          ["del", 2],
        ],
      ],
    );
    assert.deepEqual(buildSplitHunks("", ""), []);
  });
});

describe("buildSplitFileEntry Test Suite", () => {
  it("builds hunks for modified text files", () => {
    const entry = textEntry("f.txt", "a\n", "b\n");
    assert.equal(entry.status, "M");
    assert.equal(entry.binary, false);
    assert.equal(entry.conflict, false);
    assert.equal(entry.hunks?.length, 1);
    assert.equal(entry.leftBase64, Buffer.from("a\n", "utf8").toString("base64"));
    assert.equal(entry.rightBase64, Buffer.from("b\n", "utf8").toString("base64"));
  });

  it("falls back to whole-file contents for empty add, binary delete, pure rename, binary, and conflict leaves", () => {
    const addedEmpty = buildSplitFileEntry({ path: "added-empty.txt", status: "A", right: Buffer.from("") });
    assert.equal(addedEmpty.hunks, undefined);
    assert.equal(addedEmpty.leftBase64, undefined);
    assert.equal(addedEmpty.rightBase64, Buffer.from("").toString("base64"));

    const deletedBinary = buildSplitFileEntry({
      path: "old.dat",
      status: "D",
      binary: true,
      left: Buffer.from([0x00]),
    });
    assert.equal(deletedBinary.hunks, undefined);
    assert.equal(deletedBinary.rightBase64, undefined);

    const deletedEmpty = buildSplitFileEntry({ path: "empty.txt", status: "D", left: Buffer.from("") });
    assert.equal(deletedEmpty.hunks, undefined);

    const renamed = buildSplitFileEntry({
      path: "new.txt",
      renamedFrom: "old.txt",
      status: "R",
      left: Buffer.from("a\n"),
      right: Buffer.from("a\n"),
    });
    // Identical sides produce no content hunks (an empty hunk list), only the rename remains.
    assert.deepEqual(renamed.hunks, []);
    assert.equal(renamed.renamedFrom, "old.txt");

    const binary = buildSplitFileEntry({
      path: "img.png",
      status: "M",
      binary: true,
      left: Buffer.from([0x89, 0x50]),
      right: Buffer.from([0x89, 0x51]),
    });
    assert.equal(binary.binary, true);
    assert.equal(binary.hunks, undefined);

    const conflict = buildSplitFileEntry({
      path: "c.txt",
      status: "M",
      conflict: true,
      left: Buffer.from("a\n"),
      right: Buffer.from("b\n"),
    });
    assert.equal(conflict.conflict, true);
    assert.equal(conflict.hunks, undefined);
  });

  it("builds a single full-removal hunk for deleted text files", () => {
    const deleted = buildSplitFileEntry({ path: "old.txt", status: "D", left: Buffer.from("a\nb\n") });
    assert.equal(deleted.rightBase64, undefined);
    assert.equal(deleted.hunks?.length, 1);
    assert.deepEqual(
      deleted.hunks[0].lines.map((l) => [l.kind, l.oldLine, l.text]),
      [
        ["del", 1, "a\n"],
        ["del", 2, "b\n"],
      ],
    );
  });

  it("builds a single full-addition hunk for added text files", () => {
    const added = buildSplitFileEntry({ path: "new.txt", status: "A", right: Buffer.from("a\nb\n") });
    assert.equal(added.leftBase64, undefined);
    assert.equal(added.hunks?.length, 1);
    assert.deepEqual(
      added.hunks[0].lines.map((l) => [l.kind, l.newLine, l.text]),
      [
        ["add", 1, "a\n"],
        ["add", 2, "b\n"],
      ],
    );
  });

  it("carries mode changes through while building content hunks", () => {
    const entry = buildSplitFileEntry({
      path: "f.sh",
      status: "M",
      modeChangedFrom: "100644",
      modeChangedTo: "100755",
      left: Buffer.from("a\n"),
      right: Buffer.from("b\n"),
    });
    assert.equal(entry.modeChangedFrom, "100644");
    assert.equal(entry.modeChangedTo, "100755");
    assert.equal(entry.hunks?.length, 1);

    const modeOnly = buildSplitFileEntry({
      path: "g.sh",
      status: "M",
      modeChangedFrom: "100644",
      modeChangedTo: "100755",
      left: Buffer.from("a\n"),
      right: Buffer.from("a\n"),
    });
    // A mode-only change has identical contents, so it carries no content hunks.
    assert.deepEqual(modeOnly.hunks, []);
    assert.equal(modeOnly.modeChangedTo, "100755");
  });

  it("builds content hunks for renames that come with content changes", () => {
    const renamed = buildSplitFileEntry({
      path: "new.txt",
      renamedFrom: "old.txt",
      status: "R",
      left: Buffer.from("a\nb\nc\n"),
      right: Buffer.from("a\nB\nc\nX\n"),
    });
    assert.equal(renamed.hunks?.length, 2);
    assert.deepEqual(
      renamed.hunks.map((hunk) => hunk.lines.map((l) => [l.kind, l.text])),
      [
        [
          ["del", "b\n"],
          ["add", "B\n"],
        ],
        [["add", "X\n"]],
      ],
    );
  });

  it("pairs a modified line of a renamed file into a single hunk", () => {
    // Rename test.txt → test-renamed.txt with one changed line ("5346" → "53465") where the
    // old line repeats right after; the modification must show up as one del/add hunk.
    const left = "34\n6546\n5\n346\n5\n56\n6546\n36\n5346\n5346\n5\n346\n53\n46\n534\n65\n4\n6\n";
    const right = left.replace("5346\n5346\n5\n", "53465\n5346\n5\n");
    const renamed = buildSplitFileEntry({
      path: "test-renamed.txt",
      renamedFrom: "test.txt",
      status: "R",
      left: Buffer.from(left, "utf8"),
      right: Buffer.from(right, "utf8"),
    });
    assert.equal(renamed.hunks?.length, 1);
    assert.deepEqual(
      renamed.hunks[0].lines.map((l) => [l.kind, l.oldLine, l.newLine, l.text]),
      [
        ["del", 9, undefined, "5346\n"],
        ["add", undefined, 9, "53465\n"],
      ],
    );

    // Reconstruction keeps working on the re-paired lines: fully selected yields the right side,
    // and excluding the whole hunk reverts the modification.
    const state = createSplitCheckboxState();
    assert.equal(reconstructRightSides([renamed], state).get("test-renamed.txt")?.toString("utf8"), right);
    setHunkChecked("test-renamed.txt", renamed.hunks[0], state, false);
    assert.equal(reconstructRightSides([renamed], state).get("test-renamed.txt")?.toString("utf8"), left);
    assert.equal(reconstructRightSides([renamed], state).get("test.txt"), undefined);
  });
});

describe("tri-state Test Suite", () => {
  it("defaults to fully checked", () => {
    const entry = textEntry("f.txt", "a\nb\nc\n", "a\nx\nc\ny\n");
    const state = createSplitCheckboxState();
    assert.equal(getFileCheckState(entry, state), true);
    for (const hunk of entry.hunks ?? []) {
      assert.equal(getHunkCheckState(entry.path, hunk, state), true);
    }
    assert.equal(getLineChecked(entry.path, delLineOf(entry, 0, "b\n"), state), true);
  });

  it("marks hunk and file rows indeterminate when lines are mixed", () => {
    const entry = textEntry("f.txt", "a\nb\nc\n", "a\nx\nc\n");
    const state = createSplitCheckboxState();
    setLineChecked(entry.path, delLineOf(entry, 0, "b\n"), state, false);
    assert.equal(getHunkCheckState(entry.path, entry.hunks![0], state), "indeterminate");
    assert.equal(getFileCheckState(entry, state), "indeterminate");
  });

  it("marks rows unchecked only when all descendant lines are unchecked", () => {
    const entry = textEntry("f.txt", "a\nb\nc\nd\ne\n", "a\nB\nc\nD\ne\n");
    const state = createSplitCheckboxState();
    setHunkChecked(entry.path, entry.hunks![0], state, false);
    assert.equal(getHunkCheckState(entry.path, entry.hunks![0], state), false);
    assert.equal(getHunkCheckState(entry.path, entry.hunks![1], state), true);
    assert.equal(getFileCheckState(entry, state), "indeterminate");

    setHunkChecked(entry.path, entry.hunks![1], state, false);
    assert.equal(getFileCheckState(entry, state), false);
  });

  it("derives leaf rows from the whole-file state", () => {
    const entry = buildSplitFileEntry({
      path: "renamed-to.txt",
      renamedFrom: "renamed-from.txt",
      status: "R",
      left: Buffer.from("a\n"),
      right: Buffer.from("a\n"),
    });
    const state = createSplitCheckboxState();
    assert.equal(getFileCheckState(entry, state), true);
    setFileChecked(entry.path, state, false);
    assert.equal(getFileCheckState(entry, state), false);
  });

  it("keeps the whole-file state and the full-removal hunk of a deleted file in sync", () => {
    const deleted = buildSplitFileEntry({ path: "old.txt", status: "D", left: Buffer.from("a\nb\n") });
    const state = createSplitCheckboxState();
    assert.equal(getFileCheckState(deleted, state), true);
    assert.equal(getHunkCheckState(deleted.path, deleted.hunks![0], state), true);

    setFileChecked(deleted.path, state, false);
    assert.equal(getFileCheckState(deleted, state), false);
    assert.equal(getHunkCheckState(deleted.path, deleted.hunks![0], state), false);

    setHunkChecked(deleted.path, deleted.hunks![0], state, true);
    assert.equal(getHunkCheckState(deleted.path, deleted.hunks![0], state), true);
    assert.equal(getFileCheckState(deleted, state), true);
  });

  it("keeps the whole-file state and the full-addition hunk of an added file in sync", () => {
    const added = buildSplitFileEntry({ path: "new.txt", status: "A", right: Buffer.from("a\nb\n") });
    const state = createSplitCheckboxState();
    assert.equal(getFileCheckState(added, state), true);
    assert.equal(getHunkCheckState(added.path, added.hunks![0], state), true);

    setFileChecked(added.path, state, false);
    assert.equal(getFileCheckState(added, state), false);
    assert.equal(getHunkCheckState(added.path, added.hunks![0], state), false);

    setHunkChecked(added.path, added.hunks![0], state, true);
    assert.equal(getHunkCheckState(added.path, added.hunks![0], state), true);
    assert.equal(getFileCheckState(added, state), true);
  });

  it("combines a renamed file's rename checkbox with its content hunks", () => {
    const renamed = buildSplitFileEntry({
      path: "new.txt",
      renamedFrom: "old.txt",
      status: "R",
      left: Buffer.from("a\nb\n"),
      right: Buffer.from("a\nB\n"),
    });
    const state = createSplitCheckboxState();
    assert.equal(getFileCheckState(renamed, state), true);

    // Unchecking only the rename leaves the content hunks selected and the file indeterminate.
    setRenameChecked("new.txt", state, false);
    assert.equal(getRenameChecked("new.txt", state), false);
    assert.equal(getHunkCheckState("new.txt", renamed.hunks![0], state), true);
    assert.equal(getFileCheckState(renamed, state), "indeterminate");

    // Unchecking the hunks as well clears the file-level state.
    setHunkChecked("new.txt", renamed.hunks![0], state, false);
    assert.equal(getFileCheckState(renamed, state), false);

    // Re-checking the rename alone leaves the file indeterminate again.
    setRenameChecked("new.txt", state, true);
    assert.equal(getFileCheckState(renamed, state), "indeterminate");
  });

  it("toggles a renamed file's rename and hunks together via the file checkbox", () => {
    const renamed = buildSplitFileEntry({
      path: "new.txt",
      renamedFrom: "old.txt",
      status: "R",
      left: Buffer.from("a\nb\n"),
      right: Buffer.from("a\nB\n"),
    });
    const state = createSplitCheckboxState();
    setFileChecked("new.txt", state, false);
    assert.equal(getRenameChecked("new.txt", state), false);
    assert.equal(getHunkCheckState("new.txt", renamed.hunks![0], state), false);
    assert.equal(getFileCheckState(renamed, state), false);

    setFileChecked("new.txt", state, true);
    assert.equal(getRenameChecked("new.txt", state), true);
    assert.equal(getHunkCheckState("new.txt", renamed.hunks![0], state), true);
  });

  it("derives pure-rename leaves from the rename state", () => {
    const renamed = buildSplitFileEntry({
      path: "new.txt",
      renamedFrom: "old.txt",
      status: "R",
      left: Buffer.from("a\n"),
      right: Buffer.from("a\n"),
    });
    const state = createSplitCheckboxState();
    assert.deepEqual(renamed.hunks, []);
    assert.equal(getFileCheckState(renamed, state), true);

    setRenameChecked("new.txt", state, false);
    assert.equal(getFileCheckState(renamed, state), false);

    setFileChecked("new.txt", state, true);
    assert.equal(getRenameChecked("new.txt", state), true);
    assert.equal(getFileCheckState(renamed, state), true);
  });
  it("combines a file's mode-change checkbox with its content hunks", () => {
    const entry = buildSplitFileEntry({
      path: "f.sh",
      status: "M",
      modeChangedFrom: "100644",
      modeChangedTo: "100755",
      left: Buffer.from("a\n"),
      right: Buffer.from("b\n"),
    });
    const state = createSplitCheckboxState();
    assert.equal(getFileCheckState(entry, state), true);

    // Unchecking only the mode change leaves the content hunks selected and the file indeterminate.
    setModeChecked("f.sh", state, false);
    assert.equal(getModeChecked("f.sh", state), false);
    assert.equal(getHunkCheckState("f.sh", entry.hunks![0], state), true);
    assert.equal(getFileCheckState(entry, state), "indeterminate");

    // Unchecking the hunks as well clears the file-level state.
    setHunkChecked("f.sh", entry.hunks![0], state, false);
    assert.equal(getFileCheckState(entry, state), false);

    // Re-checking the mode change alone leaves the file indeterminate again.
    setModeChecked("f.sh", state, true);
    assert.equal(getFileCheckState(entry, state), "indeterminate");
  });

  it("toggles a file's mode change and hunks together via the file checkbox", () => {
    const entry = buildSplitFileEntry({
      path: "f.sh",
      status: "M",
      modeChangedFrom: "100644",
      modeChangedTo: "100755",
      left: Buffer.from("a\n"),
      right: Buffer.from("b\n"),
    });
    const state = createSplitCheckboxState();
    setFileChecked("f.sh", state, false);
    assert.equal(getModeChecked("f.sh", state), false);
    assert.equal(getHunkCheckState("f.sh", entry.hunks![0], state), false);
    assert.equal(getFileCheckState(entry, state), false);

    setFileChecked("f.sh", state, true);
    assert.equal(getModeChecked("f.sh", state), true);
    assert.equal(getHunkCheckState("f.sh", entry.hunks![0], state), true);
  });

  it("derives mode-only change files from the mode state", () => {
    const entry = buildSplitFileEntry({
      path: "f.sh",
      status: "M",
      modeChangedFrom: "100644",
      modeChangedTo: "100755",
      left: Buffer.from("#!/bin/sh\n"),
      right: Buffer.from("#!/bin/sh\n"),
    });
    const state = createSplitCheckboxState();
    assert.deepEqual(entry.hunks, []);
    assert.equal(getFileCheckState(entry, state), true);

    setModeChecked("f.sh", state, false);
    assert.equal(getFileCheckState(entry, state), false);

    setFileChecked("f.sh", state, true);
    assert.equal(getModeChecked("f.sh", state), true);
    assert.equal(getFileCheckState(entry, state), true);
  });
  it("lets the whole-file state win over line states", () => {
    const entry = textEntry("f.txt", "a\nb\nc\n", "a\nx\nc\n");
    const state = createSplitCheckboxState();
    setLineChecked(entry.path, delLineOf(entry, 0, "b\n"), state, false);
    setFileChecked(entry.path, state, true);
    assert.equal(getLineChecked(entry.path, delLineOf(entry, 0, "b\n"), state), true);
    assert.equal(getFileCheckState(entry, state), true);

    setFileChecked(entry.path, state, false);
    assert.equal(getLineChecked(entry.path, addLineOf(entry, 0, "x\n"), state), false);
    assert.equal(getHunkCheckState(entry.path, entry.hunks![0], state), false);
    assert.equal(getFileCheckState(entry, state), false);
  });

  it("selects only a single line after deselecting the whole file", () => {
    const entry = textEntry("f.txt", "a\nb\nc\nd\n", "a\nx\nc\ny\n");
    const state = createSplitCheckboxState();
    setFileChecked(entry.path, state, false);
    assert.equal(getLineChecked(entry.path, addLineOf(entry, 1, "y\n"), state), false);

    setLineChecked(entry.path, addLineOf(entry, 1, "y\n"), state, true);
    assert.equal(getLineChecked(entry.path, addLineOf(entry, 1, "y\n"), state), true);
    // Every other line keeps the deselected whole-file state instead of reverting to checked.
    assert.equal(getLineChecked(entry.path, delLineOf(entry, 0, "b\n"), state), false);
    assert.equal(getLineChecked(entry.path, addLineOf(entry, 0, "x\n"), state), false);
    assert.equal(getHunkCheckState(entry.path, entry.hunks![0], state), false);
    assert.equal(getHunkCheckState(entry.path, entry.hunks![1], state), "indeterminate");
    assert.equal(getFileCheckState(entry, state), "indeterminate");
  });

  it("deselects only a single line after selecting the whole file", () => {
    const entry = textEntry("f.txt", "a\nb\nc\nd\n", "a\nx\nc\ny\n");
    const state = createSplitCheckboxState();
    setFileChecked(entry.path, state, true);

    setLineChecked(entry.path, delLineOf(entry, 0, "b\n"), state, false);
    assert.equal(getLineChecked(entry.path, delLineOf(entry, 0, "b\n"), state), false);
    // Every other line keeps the selected whole-file state.
    assert.equal(getLineChecked(entry.path, addLineOf(entry, 0, "x\n"), state), true);
    assert.equal(getLineChecked(entry.path, delLineOf(entry, 1, "d\n"), state), true);
    assert.equal(getLineChecked(entry.path, addLineOf(entry, 1, "y\n"), state), true);
    assert.equal(getHunkCheckState(entry.path, entry.hunks![0], state), "indeterminate");
    assert.equal(getHunkCheckState(entry.path, entry.hunks![1], state), true);
    assert.equal(getFileCheckState(entry, state), "indeterminate");
  });

  it("marks select-everything checked, mixed, or unchecked across every entry", () => {
    const modified = textEntry("f.txt", "a\nb\nc\n", "a\nx\nc\n");
    const added = buildSplitFileEntry({ path: "new.txt", status: "A", right: Buffer.from("a\n") });
    const state = createSplitCheckboxState();
    assert.equal(getAllFilesCheckState([modified, added], state), true);

    setLineChecked(modified.path, delLineOf(modified, 0, "b\n"), state, false);
    assert.equal(getAllFilesCheckState([modified, added], state), "indeterminate");

    setFileChecked(modified.path, state, false);
    setFileChecked(added.path, state, false);
    assert.equal(getAllFilesCheckState([modified, added], state), false);
  });

  it("toggles every entry, rename, and line together via select-everything", () => {
    const modified = textEntry("f.txt", "a\nb\nc\n", "a\nx\nc\n");
    const renamed = buildSplitFileEntry({
      path: "new.txt",
      renamedFrom: "old.txt",
      status: "R",
      left: Buffer.from("a\n"),
      right: Buffer.from("b\n"),
    });
    const entries = [modified, renamed];
    const state = createSplitCheckboxState();

    setAllFilesChecked(entries, state, false);
    assert.equal(getAllFilesCheckState(entries, state), false);
    assert.equal(getLineChecked(modified.path, delLineOf(modified, 0, "b\n"), state), false);
    assert.equal(getRenameChecked(renamed.path, state), false);

    setLineChecked(modified.path, addLineOf(modified, 0, "x\n"), state, true);
    assert.equal(getAllFilesCheckState(entries, state), "indeterminate");

    setAllFilesChecked(entries, state, true);
    assert.equal(getAllFilesCheckState(entries, state), true);
    // The whole-file state replaces any per-line selection underneath.
    assert.equal(getLineChecked(modified.path, delLineOf(modified, 0, "b\n"), state), true);
    assert.equal(getRenameChecked(renamed.path, state), true);
  });
});

describe("reconstructRightSides Test Suite", () => {
  it("reproduces the right side when everything is checked", () => {
    const left = "a\nb\nc\nd\ne\nf\n";
    const right = "a\nB\nc\nd\nE\nF2\n";
    const entry = textEntry("f.txt", left, right);
    const state = createSplitCheckboxState();
    const result = reconstructRightSides([entry], state);
    assert.deepEqual(result.get("f.txt"), Buffer.from(right, "utf8"));
  });

  it("reproduces the left side when every line is unchecked", () => {
    const left = "a\nb\nc\nd\ne\nf\n";
    const right = "a\nB\nc\nd\nE\nF2\n";
    const entry = textEntry("f.txt", left, right);
    const state = createSplitCheckboxState();
    setFileChecked("f.txt", state, false);
    const result = reconstructRightSides([entry], state);
    assert.deepEqual(result.get("f.txt"), Buffer.from(left, "utf8"));
  });

  it("reconstructs partial hunks line by line", () => {
    const entry = textEntry("f.txt", "a\nb\nc\nd\n", "a\nx\ny\nc\nB\n");
    const state = createSplitCheckboxState();

    // Keep the deletion of "b" but only the addition of "y".
    setLineChecked(entry.path, delLineOf(entry, 0, "b\n"), state, true);
    setLineChecked(entry.path, addLineOf(entry, 0, "x\n"), state, false);
    setLineChecked(entry.path, addLineOf(entry, 0, "y\n"), state, true);
    // Keep the addition of "B" but not the deletion of "d".
    setLineChecked(entry.path, delLineOf(entry, 1, "d\n"), state, false);
    setLineChecked(entry.path, addLineOf(entry, 1, "B\n"), state, true);

    const result = reconstructRightSides([entry], state);
    assert.deepEqual(result.get("f.txt"), Buffer.from("a\ny\nc\nd\nB\n", "utf8"));
  });

  it("puts kept deleted lines before checked added lines within a hunk", () => {
    const entry = textEntry("f.txt", "a\nb\n", "a\nx\n");
    const state = createSplitCheckboxState();
    setLineChecked(entry.path, delLineOf(entry, 0, "b\n"), state, false);
    setLineChecked(entry.path, addLineOf(entry, 0, "x\n"), state, true);
    const result = reconstructRightSides([entry], state);
    assert.deepEqual(result.get("f.txt"), Buffer.from("a\nb\nx\n", "utf8"));
  });

  it("handles pure insertions and pure deletions at file start and end", () => {
    const entry = textEntry("f.txt", "m\n", "a\nm\nz\n");
    const state = createSplitCheckboxState();
    assert.deepEqual(reconstructRightSides([entry], state).get("f.txt"), Buffer.from("a\nm\nz\n", "utf8"));

    setLineChecked(entry.path, addLineOf(entry, 0, "a\n"), state, false);
    setLineChecked(entry.path, addLineOf(entry, 1, "z\n"), state, false);
    assert.deepEqual(reconstructRightSides([entry], state).get("f.txt"), Buffer.from("m\n", "utf8"));
  });

  it("reconstructs a single line selected after deselecting the whole file", () => {
    const entry = textEntry("f.txt", "a\nb\nc\nd\n", "a\nx\nc\ny\n");
    const state = createSplitCheckboxState();
    setFileChecked(entry.path, state, false);
    setLineChecked(entry.path, addLineOf(entry, 1, "y\n"), state, true);
    // Only the "y" addition is applied; everything else stays on the left side.
    assert.deepEqual(reconstructRightSides([entry], state).get("f.txt"), Buffer.from("a\nb\nc\nd\ny\n", "utf8"));
  });

  it("reconstructs a single line deselected after selecting the whole file", () => {
    const entry = textEntry("f.txt", "a\nb\nc\nd\n", "a\nx\nc\ny\n");
    const state = createSplitCheckboxState();
    setFileChecked(entry.path, state, true);
    setLineChecked(entry.path, delLineOf(entry, 0, "b\n"), state, false);
    // The deletion of "b" is skipped; the "x" and "y" changes are applied.
    assert.deepEqual(reconstructRightSides([entry], state).get("f.txt"), Buffer.from("a\nb\nx\nc\ny\n", "utf8"));
  });

  it("reconstructs whole-file toggles of hunk-model files byte-exactly", () => {
    const entry = textEntry("f.txt", "a\nb\n", "a\nx\n");
    const state = createSplitCheckboxState();
    setFileChecked("f.txt", state, true);
    assert.deepEqual(reconstructRightSides([entry], state).get("f.txt"), Buffer.from("a\nx\n", "utf8"));
    setFileChecked("f.txt", state, false);
    assert.deepEqual(reconstructRightSides([entry], state).get("f.txt"), Buffer.from("a\nb\n", "utf8"));
  });

  it("reconstructs deleted text files with the deletion applied only when selected", () => {
    const deleted = buildSplitFileEntry({ path: "old.txt", status: "D", left: Buffer.from("a\nb\n") });

    // Default (deletion checked): the file is absent on the reconstructed right side.
    assert.equal(reconstructRightSides([deleted], createSplitCheckboxState()).get("old.txt"), undefined);

    // Unchecking the deletion keeps the file in the first commit.
    let state = createSplitCheckboxState();
    setFileChecked("old.txt", state, false);
    assert.deepEqual(reconstructRightSides([deleted], state).get("old.txt"), Buffer.from("a\nb\n", "utf8"));

    // Unchecking the full-removal hunk also keeps the file.
    state = createSplitCheckboxState();
    setHunkChecked("old.txt", deleted.hunks![0], state, false);
    assert.deepEqual(reconstructRightSides([deleted], state).get("old.txt"), Buffer.from("a\nb\n", "utf8"));

    // Re-checking the hunk removes the whole file again.
    setHunkChecked("old.txt", deleted.hunks![0], state, true);
    assert.equal(reconstructRightSides([deleted], state).get("old.txt"), undefined);

    // A partially unchecked hunk keeps the surviving lines.
    state = createSplitCheckboxState();
    setLineChecked("old.txt", deleted.hunks![0].lines[1], state, false);
    assert.deepEqual(reconstructRightSides([deleted], state).get("old.txt"), Buffer.from("b\n", "utf8"));
  });

  it("reconstructs added text files with the addition applied only when selected", () => {
    const added = buildSplitFileEntry({ path: "new.txt", status: "A", right: Buffer.from("a\nb\n") });

    // Default (checked): the whole file goes into the first commit.
    assert.deepEqual(
      reconstructRightSides([added], createSplitCheckboxState()).get("new.txt"),
      Buffer.from("a\nb\n", "utf8"),
    );

    // Unchecking the whole file keeps it out of the first commit.
    let state = createSplitCheckboxState();
    setFileChecked("new.txt", state, false);
    assert.equal(reconstructRightSides([added], state).get("new.txt"), undefined);

    // Unchecking the full-addition hunk also keeps the file out.
    state = createSplitCheckboxState();
    setHunkChecked("new.txt", added.hunks![0], state, false);
    assert.equal(reconstructRightSides([added], state).get("new.txt"), undefined);

    // Re-checking the hunk adds the whole file again.
    setHunkChecked("new.txt", added.hunks![0], state, true);
    assert.deepEqual(reconstructRightSides([added], state).get("new.txt"), Buffer.from("a\nb\n", "utf8"));

    // A partially unchecked hunk adds only the selected lines.
    state = createSplitCheckboxState();
    setLineChecked("new.txt", added.hunks![0].lines[0], state, false);
    assert.deepEqual(reconstructRightSides([added], state).get("new.txt"), Buffer.from("b\n", "utf8"));
  });

  it("reconstructs renamed files with the rename independent of the content hunks", () => {
    const renamed = buildSplitFileEntry({
      path: "new.txt",
      renamedFrom: "old.txt",
      status: "R",
      left: Buffer.from("a\nb\n"),
      right: Buffer.from("a\nB\nc\n"),
    });

    // Default: the rename and the content edits go into the first commit.
    let state = createSplitCheckboxState();
    let result = reconstructRightSides([renamed], state);
    assert.equal(result.get("old.txt"), undefined);
    assert.deepEqual(result.get("new.txt"), Buffer.from("a\nB\nc\n"));

    // Rename unchecked, hunks checked: the edits apply to the old path in the first commit;
    // the rename itself falls to the second commit.
    state = createSplitCheckboxState();
    setRenameChecked("new.txt", state, false);
    result = reconstructRightSides([renamed], state);
    assert.deepEqual(result.get("old.txt"), Buffer.from("a\nB\nc\n"));
    assert.equal(result.get("new.txt"), undefined);

    // Rename checked, hunks unchecked: the first commit holds a pure rename; the edits fall
    // to the second commit.
    state = createSplitCheckboxState();
    setHunkChecked("new.txt", renamed.hunks![0], state, false);
    result = reconstructRightSides([renamed], state);
    assert.equal(result.get("old.txt"), undefined);
    assert.deepEqual(result.get("new.txt"), Buffer.from("a\nb\n"));

    // Partially selected hunks follow whichever path the file lives on.
    state = createSplitCheckboxState();
    setRenameChecked("new.txt", state, false);
    setLineChecked("new.txt", delLineOf(renamed, 0, "b\n"), state, false);
    setLineChecked("new.txt", addLineOf(renamed, 0, "B\n"), state, false);
    result = reconstructRightSides([renamed], state);
    assert.deepEqual(result.get("old.txt"), Buffer.from("a\nb\nc\n"));
    assert.equal(result.get("new.txt"), undefined);
  });

  it("reconstructs pure renames via the rename state", () => {
    const renamed = buildSplitFileEntry({
      path: "new.txt",
      renamedFrom: "old.txt",
      status: "R",
      left: Buffer.from("a\n"),
      right: Buffer.from("a\n"),
    });

    const state = createSplitCheckboxState();
    assert.equal(reconstructRightSides([renamed], state).get("old.txt"), undefined);
    assert.deepEqual(reconstructRightSides([renamed], state).get("new.txt"), Buffer.from("a\n"));

    setRenameChecked("new.txt", state, false);
    const result = reconstructRightSides([renamed], state);
    assert.deepEqual(result.get("old.txt"), Buffer.from("a\n"));
    assert.equal(result.get("new.txt"), undefined);
  });
  it("preserves CRLF line endings", () => {
    const entry = textEntry("f.txt", "a\r\nb\r\nc\r\n", "a\r\nX\r\nc\r\n");
    const state = createSplitCheckboxState();
    assert.deepEqual(reconstructRightSides([entry], state).get("f.txt"), Buffer.from("a\r\nX\r\nc\r\n", "utf8"));

    setLineChecked(entry.path, delLineOf(entry, 0, "b\r\n"), state, false);
    setLineChecked(entry.path, addLineOf(entry, 0, "X\r\n"), state, false);
    assert.deepEqual(reconstructRightSides([entry], state).get("f.txt"), Buffer.from("a\r\nb\r\nc\r\n", "utf8"));
  });

  it("handles a missing trailing newline", () => {
    const entry = textEntry("f.txt", "a\nb", "a\nb\nc");
    const state = createSplitCheckboxState();
    assert.deepEqual(reconstructRightSides([entry], state).get("f.txt"), Buffer.from("a\nb\nc", "utf8"));

    // Unchecking drops the added "c" and restores the newline-less left line.
    setLineChecked(entry.path, addLineOf(entry, 0, "c"), state, false);
    setLineChecked(entry.path, delLineOf(entry, 0, "b"), state, false);
    setLineChecked(entry.path, addLineOf(entry, 0, "b\n"), state, false);
    assert.deepEqual(reconstructRightSides([entry], state).get("f.txt"), Buffer.from("a\nb", "utf8"));
  });

  it("handles empty files", () => {
    const emptied = textEntry("f.txt", "a\nb\n", "");
    const state = createSplitCheckboxState();
    assert.deepEqual(reconstructRightSides([emptied], state).get("f.txt"), Buffer.from("", "utf8"));

    setFileChecked("f.txt", state, false);
    assert.deepEqual(reconstructRightSides([emptied], state).get("f.txt"), Buffer.from("a\nb\n", "utf8"));

    const filled = textEntry("g.txt", "", "a\n");
    assert.deepEqual(
      reconstructRightSides([filled], createSplitCheckboxState()).get("g.txt"),
      Buffer.from("a\n", "utf8"),
    );

    const unchanged = textEntry("h.txt", "", "");
    assert.deepEqual(
      reconstructRightSides([unchanged], createSplitCheckboxState()).get("h.txt"),
      Buffer.from("", "utf8"),
    );
  });

  it("reconstructs empty-add, deleted, renamed, and binary leaves via whole-file state", () => {
    const added = buildSplitFileEntry({ path: "added.txt", status: "A", right: Buffer.from("") });
    const deleted = buildSplitFileEntry({ path: "deleted.txt", status: "D", left: Buffer.from("a\n") });
    const renamed = buildSplitFileEntry({
      path: "renamed-to.txt",
      renamedFrom: "renamed-from.txt",
      status: "R",
      left: Buffer.from("a\n"),
      right: Buffer.from("b\n"),
    });
    const binary = buildSplitFileEntry({
      path: "img.png",
      status: "M",
      binary: true,
      left: Buffer.from([1, 2]),
      right: Buffer.from([3, 4]),
    });

    let state = createSplitCheckboxState();
    let result = reconstructRightSides([added, deleted, renamed, binary], state);
    assert.deepEqual(result.get("added.txt"), Buffer.from(""));
    assert.deepEqual(result.get("deleted.txt"), undefined);
    assert.deepEqual(result.get("renamed-from.txt"), undefined); // rename applied: old name gone
    assert.deepEqual(result.get("renamed-to.txt"), Buffer.from("b\n"));
    assert.deepEqual(result.get("img.png"), Buffer.from([3, 4]));

    state = createSplitCheckboxState();
    setFileChecked("added.txt", state, false);
    setFileChecked("deleted.txt", state, false);
    setFileChecked("renamed-to.txt", state, false);
    setFileChecked("img.png", state, false);
    result = reconstructRightSides([added, deleted, renamed, binary], state);
    assert.deepEqual(result.get("added.txt"), undefined); // addition skipped: file absent
    assert.deepEqual(result.get("deleted.txt"), Buffer.from("a\n")); // deletion skipped: file kept
    assert.deepEqual(result.get("renamed-from.txt"), Buffer.from("a\n")); // rename skipped: old name kept
    assert.deepEqual(result.get("renamed-to.txt"), undefined);
    assert.deepEqual(result.get("img.png"), Buffer.from([1, 2]));
  });

  it("reconstructs multiple entries independently", () => {
    const a = textEntry("a.txt", "1\n", "2\n");
    const b = textEntry("b.txt", "x\n", "y\n");
    const state = createSplitCheckboxState();
    setFileChecked("a.txt", state, false);
    const result = reconstructRightSides([a, b], state);
    assert.deepEqual(result.get("a.txt"), Buffer.from("1\n", "utf8"));
    assert.deepEqual(result.get("b.txt"), Buffer.from("y\n", "utf8"));
  });
});

describe("reconstructRightModes Test Suite", () => {
  it("applies the new mode when checked and the old mode when unchecked", () => {
    const entry = buildSplitFileEntry({
      path: "f.sh",
      status: "M",
      modeChangedFrom: "100644",
      modeChangedTo: "100755",
      left: Buffer.from("a\n"),
      right: Buffer.from("b\n"),
    });

    // Default: the mode change goes into the first commit.
    assert.equal(reconstructRightModes([entry], createSplitCheckboxState()).get("f.sh"), "100755");

    // Unchecked: the first commit keeps the old mode.
    const state = createSplitCheckboxState();
    setModeChecked("f.sh", state, false);
    assert.equal(reconstructRightModes([entry], state).get("f.sh"), "100644");

    // Unchecking the whole file unchecks the mode change with it.
    setFileChecked("f.sh", state, true);
    setFileChecked("f.sh", state, false);
    assert.equal(reconstructRightModes([entry], state).get("f.sh"), "100644");
  });

  it("records no mode for files without a mode change", () => {
    const entries = [
      textEntry("f.txt", "a\n", "b\n"),
      buildSplitFileEntry({ path: "added.txt", status: "A", right: Buffer.from("a\n") }),
      buildSplitFileEntry({ path: "gone.txt", status: "D", left: Buffer.from("a\n") }),
    ];
    const modes = reconstructRightModes(entries, createSplitCheckboxState());
    assert.equal(modes.size, 0);
  });

  it("carries symlink modes so type changes reconstruct as links", () => {
    const toLink = buildSplitFileEntry({
      path: "f.txt",
      status: "M",
      modeChangedFrom: "100644",
      modeChangedTo: "120000",
      left: Buffer.from("regular\n"),
      right: Buffer.from("target.txt"),
    });
    // Default: the selected type change recreates the link in the first commit.
    assert.equal(reconstructRightModes([toLink], createSplitCheckboxState()).get("f.txt"), "120000");

    // Unchecked: the first commit keeps the regular file.
    const state = createSplitCheckboxState();
    setFileChecked("f.txt", state, false);
    assert.equal(reconstructRightModes([toLink], state).get("f.txt"), "100644");

    // The reverse type change keeps the link when unchecked.
    const toFile = buildSplitFileEntry({
      path: "l.txt",
      status: "M",
      modeChangedFrom: "120000",
      modeChangedTo: "100644",
      left: Buffer.from("target.txt"),
      right: Buffer.from("regular\n"),
    });
    setFileChecked("l.txt", state, false);
    assert.equal(reconstructRightModes([toFile], state).get("l.txt"), "120000");
  });

  it("keeps the symlink mode of a retargeted link", () => {
    const retargeted = buildSplitFileEntry({
      path: "r.txt",
      status: "M",
      modeChangedFrom: "120000",
      modeChangedTo: "120000",
      left: Buffer.from("old.txt"),
      right: Buffer.from("new.txt"),
    });
    // The mode did not change, but the reconstruction still needs it to recreate the link
    // whichever target string the selection keeps.
    assert.equal(reconstructRightModes([retargeted], createSplitCheckboxState()).get("r.txt"), "120000");
  });

  it("applies a renamed file's mode change to whichever path it lives on", () => {
    const renamed = buildSplitFileEntry({
      path: "new.sh",
      renamedFrom: "old.sh",
      status: "R",
      modeChangedFrom: "100644",
      modeChangedTo: "100755",
      left: Buffer.from("a\n"),
      right: Buffer.from("b\n"),
    });

    // Default: the rename and the mode change both go into the first commit.
    let state = createSplitCheckboxState();
    assert.equal(reconstructRightModes([renamed], state).get("new.sh"), "100755");
    assert.equal(reconstructRightModes([renamed], state).has("old.sh"), false);

    // Rename unchecked: the file lives at the old path, so the mode applies there.
    state = createSplitCheckboxState();
    setRenameChecked("new.sh", state, false);
    assert.equal(reconstructRightModes([renamed], state).get("old.sh"), "100755");
    assert.equal(reconstructRightModes([renamed], state).has("new.sh"), false);
  });
});

describe("lineKey Test Suite", () => {
  it("keys deleted lines by old line and added lines by new line", () => {
    const lines = buildSplitLines("a\nb\n", "a\nx\n");
    assert.deepEqual(
      lines.map((l) => lineKey(l)),
      ["context:1-1", "del:2", "add:2"],
    );
  });
});

describe("isSplitCheckboxStatePristine Test Suite", () => {
  it("holds for a freshly created state", () => {
    assert.equal(isSplitCheckboxStatePristine(createSplitCheckboxState()), true);
  });

  it("fails once any checkable was recorded, even with its default value", () => {
    let state = createSplitCheckboxState();
    setFileChecked("f.txt", state, true);
    assert.equal(isSplitCheckboxStatePristine(state), false);

    state = createSplitCheckboxState();
    const lines = buildSplitLines("a\nb\n", "a\nx\n");
    setLineChecked("f.txt", lines[1], state, true);
    assert.equal(isSplitCheckboxStatePristine(state), false);

    state = createSplitCheckboxState();
    setRenameChecked("new.txt", state, true);
    assert.equal(isSplitCheckboxStatePristine(state), false);

    state = createSplitCheckboxState();
    setModeChecked("f.sh", state, true);
    assert.equal(isSplitCheckboxStatePristine(state), false);
  });
});
