/* eslint-disable @typescript-eslint/no-floating-promises */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { convertJJErrors, DivergentOperationsError, StaleWorkingCopyError, extractJJWarning } from "../errors";

function processError(stderr: string): Error & { stderr: string } {
  const err = new Error(`Command failed with exit code 1.\nstderr: ${stderr}`) as Error & { stderr: string };
  err.stderr = stderr;
  return err;
}

describe("convertJJErrors Test Suite", () => {
  it("converts divergent operations error", () => {
    const err = processError(
      'Error: The "@" expression resolved to more than one operation\n' +
        "Hint: Try specifying one of the operations by ID: c8af35ffdef5, 801df1b86ae7",
    );
    assert.throws(() => convertJJErrors(err), DivergentOperationsError);
  });

  it("converts stale working copy error", () => {
    const err = processError("Error: The working copy is stale");
    assert.throws(() => convertJJErrors(err), StaleWorkingCopyError);
  });

  it("rethrows unknown errors unchanged", () => {
    const err = processError("Error: something unexpected");
    assert.throws(
      () => convertJJErrors(err),
      (thrown: unknown) => thrown === err,
    );
  });
});

describe("extractJJWarning Test Suite", () => {
  it("returns undefined for empty stderr", () => {
    assert.equal(extractJJWarning(""), undefined);
    assert.equal(extractJJWarning("   \n  "), undefined);
  });

  it("returns undefined when there is no Warning: line", () => {
    assert.equal(extractJJWarning("Working copy changes:\nM file.txt"), undefined);
    assert.equal(extractJJWarning("some hint text"), undefined);
  });

  it("extracts the full export-failure warning verbatim", () => {
    const stderr =
      "Warning: Failed to export some bookmarks:\n" +
      '  "a\\nb"@git: Failed to set: The ref name or path is not a valid ref name: Reference name contains invalid byte: "\\n"\n' +
      "Warning: Failed to export some tags:\n" +
      '  "a\\ntag"@git: Failed to set: The ref name or path is not a valid ref name: Reference name contains invalid byte: "\\n"\n';
    assert.equal(extractJJWarning(stderr), stderr.trim());
  });

  it("keeps unrelated warning entries (e.g. from earlier bookmarks)", () => {
    const stderr =
      "Warning: Failed to export some bookmarks:\n" +
      '  "old\\nref"@git: Failed to set: The ref name or path is not a valid ref name\n';
    const result = extractJJWarning(stderr);
    assert.ok(result);
    assert.ok(result.includes('"old\\nref"@git'));
  });

  it("drops uninteresting warnings such as config-migration notices", () => {
    assert.equal(
      extractJJWarning("Warning: Your config file has been migrated from a to b. Edit with `jj config edit`"),
      undefined,
    );
    assert.equal(extractJJWarning("Warning: use of deprecated template function `foo`"), undefined);
  });

  it("surfaces export-failure warnings but drops interleaved deprecation notices", () => {
    const exportWarning =
      "Warning: Failed to export some bookmarks:\n" +
      '  "a\\nb"@git: Failed to set: The ref name or path is not a valid ref name';
    const stderr =
      "Warning: Your config file has been migrated from a to b\n" +
      exportWarning +
      "\nWarning: template alias 'foo' is deprecated\n";
    const result = extractJJWarning(stderr);
    assert.ok(result, "expected the export-failure warning to be surfaced");
    assert.equal(result, exportWarning);
    assert.ok(!result.includes("migrated"));
    assert.ok(!result.includes("deprecated"));
  });

  it("keeps both bookmark and tag export warnings when both are present alongside noise", () => {
    const stderr =
      "Warning: deprecated thing\n" +
      "Warning: Failed to export some bookmarks:\n" +
      '  "bm"@git: failed\n' +
      "Warning: Failed to export some tags:\n" +
      '  "tg"@git: failed\n';
    const result = extractJJWarning(stderr);
    assert.ok(result);
    assert.ok(result.includes("Failed to export some bookmarks"));
    assert.ok(result.includes("Failed to export some tags"));
    assert.ok(result.includes('"bm"@git'));
    assert.ok(result.includes('"tg"@git'));
    assert.ok(!result.includes("deprecated thing"));
  });
});
