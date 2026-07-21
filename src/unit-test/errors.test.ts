/* eslint-disable @typescript-eslint/no-floating-promises */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { convertJJErrors, DivergentOperationsError, StaleWorkingCopyError } from "../errors";

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
