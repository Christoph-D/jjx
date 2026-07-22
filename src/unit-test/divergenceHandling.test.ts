/* eslint-disable @typescript-eslint/no-floating-promises */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { withDivergenceHandling } from "../divergenceHandling";
import { DivergentOperationsError } from "../errors";

function divergent(): Promise<string> {
  return Promise.reject(new DivergentOperationsError('The "@" expression resolved to more than one operation'));
}

describe("withDivergenceHandling Test Suite", () => {
  it("returns the attempt result immediately on success without delay or reconcile", async () => {
    let attempts = 0;
    let delays = 0;
    const result = await withDivergenceHandling(
      () => {
        attempts++;
        return Promise.resolve("ok");
      },
      () => Promise.reject(new Error("should not reconcile")),
      () => {
        delays++;
        return Promise.resolve();
      },
    );
    assert.equal(result, "ok");
    assert.equal(attempts, 1);
    assert.equal(delays, 0);
  });

  it("retries after backoff and succeeds when divergence resolves", async () => {
    let attempts = 0;
    let delays = 0;
    const delayArgs: number[] = [];
    const result = await withDivergenceHandling(
      () => {
        attempts++;
        if (attempts < 2) {
          return divergent();
        }
        return Promise.resolve("ok");
      },
      () => Promise.reject(new Error("should not reconcile")),
      (maxDelayMs: number) => {
        delays++;
        delayArgs.push(maxDelayMs);
        return Promise.resolve();
      },
    );
    assert.equal(result, "ok");
    assert.equal(attempts, 2);
    assert.equal(delays, 1);
    assert.deepEqual(delayArgs, [250]);
  });

  it("reconciles after maxRetries failed attempts", async () => {
    let attempts = 0;
    let reconciled = false;
    let delays = 0;
    const result = await withDivergenceHandling<string>(
      () => {
        attempts++;
        return divergent();
      },
      () => {
        reconciled = true;
        return Promise.resolve("reconciled");
      },
      () => {
        delays++;
        return Promise.resolve();
      },
    );
    assert.equal(result, "reconciled");
    assert.equal(attempts, 2);
    assert.equal(delays, 1);
    assert.equal(reconciled, true);
  });

  it("propagates non-divergence errors immediately without retry", async () => {
    let attempts = 0;
    const otherError = new Error("something else");
    await assert.rejects(
      withDivergenceHandling(
        () => {
          attempts++;
          return Promise.reject(otherError);
        },
        () => Promise.reject(new Error("should not reconcile")),
        () => Promise.resolve(),
      ),
      otherError,
    );
    assert.equal(attempts, 1);
  });

  it("propagates non-divergence error from a later attempt after initial divergence", async () => {
    let attempts = 0;
    const otherError = new Error("unexpected");
    await assert.rejects(
      withDivergenceHandling(
        () => {
          attempts++;
          if (attempts === 1) {
            return divergent();
          }
          return Promise.reject(otherError);
        },
        () => Promise.reject(new Error("should not reconcile")),
        () => Promise.resolve(),
      ),
      otherError,
    );
    assert.equal(attempts, 2);
  });

  it("respects maxRetries for multiple delay cycles with exponential backoff", async () => {
    let attempts = 0;
    let reconciled = false;
    const delayArgs: number[] = [];
    const result = await withDivergenceHandling<string>(
      () => {
        attempts++;
        return divergent();
      },
      () => {
        reconciled = true;
        return Promise.resolve("reconciled");
      },
      (maxDelayMs: number) => {
        delayArgs.push(maxDelayMs);
        return Promise.resolve();
      },
      3,
    );
    assert.equal(result, "reconciled");
    assert.equal(attempts, 4);
    assert.equal(reconciled, true);
    assert.deepEqual(delayArgs, [250, 500, 1000]);
  });

  it("reconciles immediately when maxRetries is 0", async () => {
    let attempts = 0;
    let delays = 0;
    let reconciled = false;
    const result = await withDivergenceHandling<string>(
      () => {
        attempts++;
        return divergent();
      },
      () => {
        reconciled = true;
        return Promise.resolve("reconciled");
      },
      () => {
        delays++;
        return Promise.resolve();
      },
      0,
    );
    assert.equal(result, "reconciled");
    assert.equal(attempts, 1);
    assert.equal(delays, 0);
    assert.equal(reconciled, true);
  });
});
