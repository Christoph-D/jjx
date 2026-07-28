import { DivergentOperationsError } from "./errors";
import { DIVERGENCE_BACKOFF } from "./constants";

/**
 * Runs `attempt` (a read pinned to a fixed operation) and, if it fails because the operation heads
 * are divergent, retries once after a randomized backoff. If the heads are still divergent after the
 * retry, runs `reconcile` (a read at head that makes jj merge the divergent heads into a new
 * operation) exactly once.
 *
 * The caller-supplied `delay` resolves the backoff promise; the caller controls cancellation
 * (e.g. via a vscode.CancellationToken) by resolving early. The randomization of the delay breaks
 * the phase-lock between multiple jjx instances sharing one repository, so their reconciliations
 * cannot sustain a cascade.
 *
 * `maxRetries` controls how many delay+recheck cycles happen before reconciling. The default of 1
 * gives a single ~BASE_MS backoff (~250 ms), keeping user-visible latency low while still letting
 * another process reconcile first. Higher values add exponential backoff (BASE_MS * 2^i) for
 * scenarios where simultaneous collisions are likely.
 */
export async function withDivergenceHandling<T>(
  attempt: () => Promise<T>,
  reconcile: () => Promise<T>,
  delay: (maxDelayMs: number) => Promise<void>,
  maxRetries: number = 1,
): Promise<T> {
  for (let i = 0; ; i++) {
    try {
      return await attempt();
    } catch (e) {
      if (!(e instanceof DivergentOperationsError)) {
        throw e;
      }
    }
    if (i >= maxRetries) {
      return reconcile();
    }
    const maxDelay = Math.min(DIVERGENCE_BACKOFF.CAP_MS, DIVERGENCE_BACKOFF.BASE_MS * 2 ** i);
    await delay(maxDelay);
  }
}
