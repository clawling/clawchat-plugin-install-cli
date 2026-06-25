import { ClawchatError } from "../errors";

export interface RetryOptions {
  /** Additional attempts after the first. `retries: 2` => up to 3 tries total. */
  retries?: number;
  /** Delay before retry N (1-indexed). The last entry is reused for further retries. */
  backoffMs?: readonly number[];
  /** Return false to stop retrying for this error (e.g. precondition failures). */
  shouldRetry?: (err: unknown) => boolean;
  /** Invoked before each retry sleep so callers can surface progress. */
  onRetry?: (attempt: number, err: unknown) => void;
}

const sleep = (ms: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Run `fn`, retrying transient failures with bounded backoff. The total time is
 * bounded by `retries` plus the per-attempt timeout the caller enforces inside
 * `fn`, so install never hangs on a dead network — it fails fast and retries a
 * fixed number of times.
 */
export async function withRetry<T>(fn: () => Promise<T>, options: RetryOptions = {}): Promise<T> {
  const retries = Math.max(0, options.retries ?? 0);
  const backoff = options.backoffMs ?? [];
  const shouldRetry = options.shouldRetry ?? (() => true);

  let lastError: unknown;
  for (let attempt = 0; attempt <= retries; attempt += 1) {
    try {
      return await fn();
    } catch (err) {
      lastError = err;
      if (attempt === retries || !shouldRetry(err)) {
        break;
      }
      options.onRetry?.(attempt + 1, err);
      const delay = backoff[attempt] ?? backoff[backoff.length - 1] ?? 0;
      if (delay > 0) {
        await sleep(delay);
      }
    }
  }
  throw lastError;
}

/**
 * Deterministic failures that will fail identically on every attempt, so a
 * retry is pure wasted time. Covers plugin preconditions and git errors that
 * are about the request itself (bad repo/branch/credentials), not the network.
 */
const NON_RETRYABLE_PATTERNS =
  /already exists|too old|not installed|manifest_version|repository .* not found|repository not found|could not read username|authentication failed|permission denied|access denied|terminal prompts disabled|not found in upstream|couldn't find remote ref|remote branch .* not found/i;

/**
 * Heuristic for subprocess/network errors that are worth retrying: timeouts and
 * transport-level failures. Precondition/validation and deterministic git
 * errors are NOT retried — they will fail identically every time.
 */
export function isTransientCommandError(err: unknown): boolean {
  if (err instanceof ClawchatError) {
    if (err.code === "TIMEOUT" || err.code === "SUBPROCESS") {
      return !NON_RETRYABLE_PATTERNS.test(err.message);
    }
    return false;
  }
  return false;
}
