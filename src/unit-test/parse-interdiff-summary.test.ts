/* eslint-disable @typescript-eslint/no-floating-promises */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import { parseInterdiffSummary } from "../parse-interdiff-summary";

const repoRoot = process.platform === "win32" ? "C:\\repo" : "/repo";

describe("parseInterdiffSummary Test Suite", () => {
  it("parses Added/Modified/Deleted lines", () => {
    const output = ["A src/new.ts", "M README.md", "D old.txt"].join("\n");
    const fileStatuses = parseInterdiffSummary(output, repoRoot);

    assert.equal(fileStatuses.length, 3);
    assert.deepEqual(
      fileStatuses.map((f) => f.type),
      ["A", "M", "D"],
    );
    assert.equal(fileStatuses[0].file, "new.ts");
    assert.equal(path.relative(repoRoot, fileStatuses[0].path), path.normalize("src/new.ts"));
  });

  it("parses rename and copy lines with renamedFrom", () => {
    const output = ["R {old/name.ts => new/name.ts}", "C {src/a.ts => src/b.ts}"].join("\n");
    const fileStatuses = parseInterdiffSummary(output, repoRoot);

    assert.equal(fileStatuses.length, 2);
    assert.equal(fileStatuses[0].type, "R");
    assert.equal(fileStatuses[0].renamedFrom, path.normalize("old/name.ts").replace(/\\/g, "/"));
    assert.equal(fileStatuses[1].type, "C");
    assert.equal(fileStatuses[1].file, "b.ts");
  });

  it("preserves literal backslashes in file names on macOS/Linux", () => {
    const output = "M literal\\backslash.txt";
    const fileStatuses = parseInterdiffSummary(output, repoRoot);

    assert.equal(fileStatuses.length, 1);
    assert.equal(fileStatuses[0].file, process.platform === "win32" ? "backslash.txt" : "literal\\backslash.txt");
  });

  it("ignores blank lines and trims whitespace", () => {
    const output = "\n  M a.txt  \n\n";
    const fileStatuses = parseInterdiffSummary(output, repoRoot);

    assert.equal(fileStatuses.length, 1);
    assert.equal(fileStatuses[0].type, "M");
    assert.equal(fileStatuses[0].file, "a.txt");
  });

  it("returns empty for empty output", () => {
    assert.deepEqual(parseInterdiffSummary("", repoRoot), []);
    assert.deepEqual(parseInterdiffSummary("   \n  \n", repoRoot), []);
  });
});
