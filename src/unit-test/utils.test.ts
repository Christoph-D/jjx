/* eslint-disable @typescript-eslint/no-floating-promises */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { formatChangeIdSuffix, formatDiffTitle, formatWorkingCopySuffix } from "../utils";
import type { FullChangeId } from "../types";

describe("formatDiffTitle Test Suite", () => {
  it("formats a plain diff title with the suffix", () => {
    assert.equal(formatDiffTitle(undefined, "new.ts", "(Working Copy)"), "new.ts (Working Copy)");
  });

  it("prefixes the rename source basename when the file was renamed", () => {
    assert.equal(formatDiffTitle("src/foo/old.ts", "new.ts", "(xy1234)"), "old.ts → new.ts (xy1234)");
  });

  it("keeps a top-level rename source as-is", () => {
    assert.equal(formatDiffTitle("old.ts", "new.ts", "(xy1234)"), "old.ts → new.ts (xy1234)");
  });
});

describe("formatSuffix Test Suite", () => {
  it("formats the working copy suffix", () => {
    assert.equal(formatWorkingCopySuffix(), "(Working Copy)");
  });

  it("formats a change ID suffix", () => {
    assert.equal(
      formatChangeIdSuffix({
        changeId: "xy1234" as FullChangeId,
        changeIdPrefix: "xy",
        changeIdSuffix: "1234",
        changeOffset: null,
      }),
      "(xy1234)",
    );
  });
});
