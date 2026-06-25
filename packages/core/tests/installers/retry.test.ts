import { describe, expect, it, vi } from "vitest";
import { ClawchatError } from "../../src/errors";
import { isTransientCommandError, withRetry } from "../../src/installers/retry";

describe("withRetry", () => {
  it("returns on first success without retrying", async () => {
    const fn = vi.fn(async () => "ok");
    await expect(withRetry(fn, { retries: 2 })).resolves.toBe("ok");
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it("retries transient failures up to the limit then succeeds", async () => {
    let calls = 0;
    const fn = vi.fn(async () => {
      calls += 1;
      if (calls < 3) throw new Error("boom");
      return "ok";
    });
    await expect(withRetry(fn, { retries: 2 })).resolves.toBe("ok");
    expect(fn).toHaveBeenCalledTimes(3);
  });

  it("throws the last error after exhausting retries", async () => {
    const fn = vi.fn(async () => {
      throw new Error("always");
    });
    await expect(withRetry(fn, { retries: 2 })).rejects.toThrow("always");
    expect(fn).toHaveBeenCalledTimes(3);
  });

  it("stops immediately when shouldRetry returns false", async () => {
    const fn = vi.fn(async () => {
      throw new Error("fatal");
    });
    await expect(withRetry(fn, { retries: 5, shouldRetry: () => false })).rejects.toThrow("fatal");
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it("invokes onRetry before each retry", async () => {
    let calls = 0;
    const onRetry = vi.fn();
    const fn = vi.fn(async () => {
      calls += 1;
      if (calls < 2) throw new Error("boom");
      return "ok";
    });
    await withRetry(fn, { retries: 2, onRetry });
    expect(onRetry).toHaveBeenCalledTimes(1);
    expect(onRetry).toHaveBeenCalledWith(1, expect.any(Error));
  });
});

describe("isTransientCommandError", () => {
  it("treats timeouts and generic subprocess failures as transient", () => {
    expect(isTransientCommandError(new ClawchatError("TIMEOUT", "x timed out"))).toBe(true);
    expect(isTransientCommandError(new ClawchatError("SUBPROCESS", "git clone failed: connection reset"))).toBe(true);
  });

  it("does not retry deterministic precondition-style failures", () => {
    expect(isTransientCommandError(new ClawchatError("SUBPROCESS", "Plugin 'clawchat' already exists."))).toBe(false);
    expect(isTransientCommandError(new ClawchatError("SUBPROCESS", "Hermes version 0.11.9 is too old"))).toBe(false);
    expect(isTransientCommandError(new ClawchatError("PRECONDITION", "not installed"))).toBe(false);
    expect(isTransientCommandError(new ClawchatError("VALIDATION", "bad"))).toBe(false);
  });

  it("does not retry deterministic git clone failures (bad branch/repo/auth)", () => {
    const cases = [
      "git clone ... failed with exit code 128: fatal: Remote branch dev not found in upstream origin",
      "git clone ... failed with exit code 128: fatal: couldn't find remote ref refs/heads/dev",
      "git clone ... failed with exit code 128: fatal: repository 'https://github.com/x/y.git/' not found",
      "git clone ... failed with exit code 128: fatal: could not read Username for 'https://github.com'",
      "git clone ... failed with exit code 128: remote: Permission denied",
      "git clone ... failed with exit code 128: fatal: Authentication failed",
    ];
    for (const msg of cases) {
      expect(isTransientCommandError(new ClawchatError("SUBPROCESS", msg)), msg).toBe(false);
    }
  });

  it("still retries genuine network/timeout clone failures", () => {
    expect(isTransientCommandError(new ClawchatError("TIMEOUT", "git clone timed out after 20000ms"))).toBe(true);
    expect(isTransientCommandError(new ClawchatError("SUBPROCESS", "git clone failed: Connection reset by peer"))).toBe(true);
    expect(isTransientCommandError(new ClawchatError("SUBPROCESS", "git clone failed: Could not resolve host: github.com"))).toBe(true);
  });

  it("does not retry non-ClawchatError values", () => {
    expect(isTransientCommandError(new Error("plain"))).toBe(false);
    expect(isTransientCommandError("nope")).toBe(false);
  });
});
