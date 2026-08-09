/* eslint-disable @typescript-eslint/no-floating-promises */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { formatAtRevTitle, formatChangeIdShort, formatDiffTitle, formatWorkingCopyLabel } from "../utils";
import type { FullChangeId } from "../types";

describe("formatDiffTitle Test Suite", () => {
  it("formats a diff title with only a target rev", () => {
    assert.equal(formatDiffTitle(undefined, "new.ts", undefined, "Working Copy"), "new.ts (Diff → Working Copy)");
  });

  it("formats a diff title between two revs", () => {
    assert.equal(formatDiffTitle(undefined, "new.ts", "rev-a", "rev-b"), "new.ts (Diff rev-a → rev-b)");
  });

  it("prefixes the rename source basename when the file was renamed", () => {
    assert.equal(formatDiffTitle("src/foo/old.ts", "new.ts", "rev-a", "rev-b"), "old.ts → new.ts (Diff rev-a → rev-b)");
  });

  it("keeps a top-level rename source as-is", () => {
    assert.equal(formatDiffTitle("old.ts", "new.ts", undefined, "xy1234"), "old.ts → new.ts (Diff → xy1234)");
  });

  it("supports a custom label such as Interdiff", () => {
    assert.equal(
      formatDiffTitle(undefined, "new.ts", "rev-a", "rev-b", "Interdiff"),
      "new.ts (Interdiff rev-a → rev-b)",
    );
  });
});

describe("formatAtRevTitle Test Suite", () => {
  it("formats an at-revision file title", () => {
    assert.equal(formatAtRevTitle("atrev.ts", "rev-a"), "atrev.ts (rev-a)");
  });
});

describe("Rev Label Test Suite", () => {
  it("formats the working copy label", () => {
    assert.equal(formatWorkingCopyLabel(), "Working Copy");
  });

  it("formats a change ID label", () => {
    assert.equal(
      formatChangeIdShort({
        changeId: "xy1234" as FullChangeId,
        changeIdPrefix: "xy",
        changeIdSuffix: "1234",
        changeOffset: null,
      }),
      "xy1234",
    );
  });
});
