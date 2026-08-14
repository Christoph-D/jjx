/* eslint-disable @typescript-eslint/no-floating-promises */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  buildSplitFileEntry,
  buildSplitHunks,
  buildSplitLines,
  createSplitCheckboxState,
  getFileCheckState,
  getHunkCheckState,
  getLineChecked,
  lineKey,
  reconstructRightSides,
  setFileChecked,
  setHunkChecked,
  setLineChecked,
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

  it("falls back to whole-file contents for add, delete, rename, binary, and conflict leaves", () => {
    const added = buildSplitFileEntry({ path: "new.txt", status: "A", right: Buffer.from("a\n") });
    assert.equal(added.hunks, undefined);
    assert.equal(added.leftBase64, undefined);
    assert.equal(added.rightBase64, Buffer.from("a\n").toString("base64"));

    const deleted = buildSplitFileEntry({ path: "old.txt", status: "D", left: Buffer.from("a\n") });
    assert.equal(deleted.hunks, undefined);
    assert.equal(deleted.rightBase64, undefined);

    const renamed = buildSplitFileEntry({
      path: "new.txt",
      renamedFrom: "old.txt",
      status: "R",
      left: Buffer.from("a\n"),
      right: Buffer.from("b\n"),
    });
    assert.equal(renamed.hunks, undefined);
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
    const entry = buildSplitFileEntry({ path: "new.txt", status: "A", right: Buffer.from("a\n") });
    const state = createSplitCheckboxState();
    assert.equal(getFileCheckState(entry, state), true);
    setFileChecked(entry.path, state, false);
    assert.equal(getFileCheckState(entry, state), false);
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

  it("reconstructs added, deleted, renamed, and binary leaves via whole-file state", () => {
    const added = buildSplitFileEntry({ path: "added.txt", status: "A", right: Buffer.from("a\n") });
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
    assert.deepEqual(result.get("added.txt"), Buffer.from("a\n"));
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

describe("lineKey Test Suite", () => {
  it("keys deleted lines by old line and added lines by new line", () => {
    const lines = buildSplitLines("a\nb\n", "a\nx\n");
    assert.deepEqual(
      lines.map((l) => lineKey(l)),
      ["context:1-1", "del:2", "add:2"],
    );
  });
});
