/* eslint-disable @typescript-eslint/no-floating-promises */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import { parseFileStatuses } from "../parseFileStatuses";
import type { DiffFileEntry } from "../types";

const repoRoot = process.platform === "win32" ? "C:\\repo" : "/repo";

function diffFile(partial: Partial<DiffFileEntry> & Pick<DiffFileEntry, "status_char" | "target_path">): DiffFileEntry {
  return {
    status_char: partial.status_char,
    source_path: partial.source_path ?? partial.target_path,
    target_path: partial.target_path,
    is_conflict: partial.is_conflict ?? false,
  };
}

describe("parseFileStatuses Test Suite", () => {
  it("maps Added/Modified/Deleted entries", () => {
    const { fileStatuses } = parseFileStatuses(
      [
        diffFile({ status_char: "A", target_path: "src/new.ts" }),
        diffFile({ status_char: "M", target_path: "README.md" }),
        diffFile({ status_char: "D", target_path: "old.txt" }),
      ],
      undefined,
      repoRoot,
    );

    assert.equal(fileStatuses.length, 3);
    assert.deepEqual(
      fileStatuses.map((f) => f.type),
      ["A", "M", "D"],
    );
    assert.equal(fileStatuses[0].file, "new.ts");
    assert.equal(path.relative(repoRoot, fileStatuses[0].path), path.normalize("src/new.ts"));
  });

  it("maps Renamed entries with renamedFrom", () => {
    const { fileStatuses } = parseFileStatuses(
      [diffFile({ status_char: "R", source_path: "old.ts", target_path: "new.ts" })],
      undefined,
      repoRoot,
    );

    assert.equal(fileStatuses.length, 1);
    const f = fileStatuses[0];
    assert.equal(f.type, "R");
    assert.equal(f.file, "new.ts");
    assert.equal(f.renamedFrom, "old.ts");
  });

  it("maps Copied entries with renamedFrom", () => {
    const { fileStatuses } = parseFileStatuses(
      [diffFile({ status_char: "C", source_path: "orig.ts", target_path: "copy.ts" })],
      undefined,
      repoRoot,
    );

    assert.equal(fileStatuses.length, 1);
    assert.equal(fileStatuses[0].type, "C");
    assert.equal(fileStatuses[0].renamedFrom, "orig.ts");
  });

  it("synthesizes an X entry for conflicted paths not present in diff", () => {
    const { fileStatuses, conflictedFiles } = parseFileStatuses(
      [diffFile({ status_char: "M", target_path: "changed.txt" })],
      ["conflict-only.txt"],
      repoRoot,
    );

    assert.equal(fileStatuses.length, 2);
    const synth = fileStatuses.find((f) => f.type === "X");
    assert.ok(synth, "expected synthesized X entry");
    assert.equal(synth.file, "conflict-only.txt");
    assert.equal(conflictedFiles.size, 1);
  });

  it("does not duplicate entries when conflicted path is already in diff", () => {
    const { fileStatuses } = parseFileStatuses(
      [diffFile({ status_char: "M", target_path: "both.txt" })],
      ["both.txt"],
      repoRoot,
    );

    assert.equal(fileStatuses.length, 1);
    assert.equal(fileStatuses[0].type, "M");
  });

  it("returns empty results for empty input", () => {
    const { fileStatuses, conflictedFiles } = parseFileStatuses([], undefined, repoRoot);
    assert.equal(fileStatuses.length, 0);
    assert.equal(conflictedFiles.size, 0);
  });
});
