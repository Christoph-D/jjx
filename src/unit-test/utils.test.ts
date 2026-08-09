/* eslint-disable @typescript-eslint/no-floating-promises */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { formatComparisonRev } from "../utils";
import type { ChangeId } from "../types";

function makeChangeId(changeId: string, opts: { short?: string; changeOffset?: string | null } = {}): ChangeId {
  const short = opts.short ?? changeId.substring(0, 8);
  return {
    changeId,
    changeIdPrefix: short,
    changeIdSuffix: "",
    changeOffset: opts.changeOffset ?? null,
  };
}

describe("formatComparisonRev Test Suite", () => {
  it("renders @ for the working copy side regardless of its change ID", () => {
    // The working copy is identified by its flag, not by change-ID matching, so
    // even though the real change ID is passed in it must collapse to "@".
    assert.equal(formatComparisonRev(makeChangeId("kxurvqky12345678"), true), "@");
  });

  it("renders the short change ID when not the working copy", () => {
    assert.equal(formatComparisonRev(makeChangeId("xyz12345abcdef", { short: "xyz12345" }), false), "xyz12345");
  });

  it("includes the change offset for divergent, non-working-copy changes", () => {
    assert.equal(
      formatComparisonRev(makeChangeId("xyz12345abcdef", { short: "xyz12345", changeOffset: "0" }), false),
      "xyz12345/0",
    );
  });

  it("prefers @ over the divergent change offset when the working copy is divergent", () => {
    assert.equal(
      formatComparisonRev(makeChangeId("xyz12345abcdef", { short: "xyz12345", changeOffset: "1" }), true),
      "@",
    );
  });

  it("from-side substitution yields a leading @", () => {
    const from = formatComparisonRev(makeChangeId("zzz", { short: "zzz" }), true);
    const to = formatComparisonRev(makeChangeId("abc12345", { short: "abc12345" }), false);
    assert.equal(`Diff ${from} → ${to}`, "Diff @ → abc12345");
  });

  it("to-side substitution yields a trailing @", () => {
    const from = formatComparisonRev(makeChangeId("abc12345", { short: "abc12345" }), false);
    const to = formatComparisonRev(makeChangeId("zzz", { short: "zzz" }), true);
    assert.equal(`Interdiff ${from} → ${to}`, "Interdiff abc12345 → @");
  });

  it("renders a custom working-copy label for the SCM section header", () => {
    const from = formatComparisonRev(makeChangeId("zzz", { short: "zzz" }), true, "Working Copy");
    const to = formatComparisonRev(makeChangeId("abc12345", { short: "abc12345" }), false);
    assert.equal(`Diff ${from} → ${to}`, "Diff Working Copy → abc12345");
  });

  it("uses the custom working-copy label even for divergent changes", () => {
    assert.equal(
      formatComparisonRev(
        makeChangeId("xyz12345abcdef", { short: "xyz12345", changeOffset: "1" }),
        true,
        "Working Copy",
      ),
      "Working Copy",
    );
  });
});
