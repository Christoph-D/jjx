/* eslint-disable @typescript-eslint/no-floating-promises */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  filepathToFileset,
  filepathToRootFileset,
  formatAtRevTitle,
  formatChangeIdShort,
  formatDiffTitle,
  formatWorkingCopyLabel,
  formatWorkingCopyTitle,
} from "../utils";
import type { FullChangeId } from "../types";

describe("filepathToFileset Test Suite", () => {
  it("wraps a plain path in an exact-file fileset", () => {
    assert.equal(filepathToFileset("example"), 'file:"example"');
  });

  it("escapes backslashes and double quotes", () => {
    assert.equal(filepathToFileset('a"b\\c'), 'file:"a\\"b\\\\c"');
  });
});

describe("filepathToRootFileset Test Suite", () => {
  it("wraps a plain path in a path-prefix fileset that recurses into directories", () => {
    assert.equal(filepathToRootFileset("example"), 'root:"example"');
  });

  it("escapes backslashes and double quotes", () => {
    assert.equal(filepathToRootFileset('a"b\\c'), 'root:"a\\"b\\\\c"');
  });
});

describe("formatDiffTitle Test Suite", () => {
  it("formats a diff title with only a target rev", () => {
    assert.equal(formatDiffTitle(undefined, "new.ts", undefined, "Working Copy"), "new.ts (Parent → Working Copy)");
  });

  it("formats a diff title between two revs", () => {
    assert.equal(formatDiffTitle(undefined, "new.ts", "rev-a", "rev-b"), "new.ts (rev-a → rev-b)");
  });

  it("prefixes the rename source basename when the file was renamed", () => {
    assert.equal(formatDiffTitle("src/foo/old.ts", "new.ts", "rev-a", "rev-b"), "old.ts → new.ts (rev-a → rev-b)");
  });

  it("keeps a top-level rename source as-is", () => {
    assert.equal(formatDiffTitle("old.ts", "new.ts", undefined, "xy1234"), "old.ts → new.ts (Parent → xy1234)");
  });

  it("supports a custom label such as Interdiff", () => {
    assert.equal(
      formatDiffTitle(undefined, "new.ts", "rev-a", "rev-b", "interdiff"),
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

  it("formats the working copy title", () => {
    assert.equal(formatWorkingCopyTitle(), "@");
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
