import * as path from "node:path";
import { pathToFileURL } from "node:url";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

type Close = { code: number; reason: string };
type DecisionInput = Close & { attempt: number; connectedAt: number | null; closedAt: number; random: number };
type Decision =
  | { action: "wait"; delayMs: number; attempt: number; notice?: string }
  | { action: "stop"; attempt: number; notice: string };
type Connection = {
  onReady: () => void;
  onAuthFailed: (close: () => void) => void;
  onClosed: (close: Close) => Promise<void>;
};
type Refresh = () => Promise<{ ok: boolean; permanent?: boolean; code?: number | string }>;

let reconnectDecision: (input: DecisionInput) => Decision;
let persistUntilSaved: (next: unknown, options: {
  save: (next: unknown) => void;
  log: (...args: unknown[]) => void;
  wait?: (ms: number) => Promise<void>;
}) => Promise<void>;
type BehaviorState = { agentId: string; accessToken: string; behavior?: string };
type IsActive = () => boolean;
type PullBehavior = (state: BehaviorState, isActive: IsActive, deps: {
  fetchImpl: (url: string, init?: unknown) => Promise<{ json: () => Promise<unknown> }>;
  save: (state: BehaviorState) => void;
}) => Promise<void>;
let pullBehavior: PullBehavior;
let createBehaviorSync: (options: {
  pull: (state: BehaviorState, isActive: IsActive) => Promise<void>;
  apply: (state: BehaviorState) => void;
}) => {
  onReady: (state: BehaviorState, isActive: IsActive) => Promise<void>;
  onInvalidated: (state: BehaviorState, isActive: IsActive) => Promise<void>;
};
let createReconnector: (options: {
  start: (connection: Connection) => void;
  refresh: Refresh;
  random: () => number;
  log: (...args: unknown[]) => void;
}) => { start: () => void };

beforeEach(async () => {
  const fetch = vi.spyOn(globalThis, "fetch").mockRejectedValue(new Error("import must not fetch"));
  const exit = vi.spyOn(process, "exit").mockImplementation(() => { throw new Error("import must not exit"); });
  try {
    const url = pathToFileURL(path.resolve(__dirname, "../../../../examples/cloud-agent/agent.mjs")).href;
    const agent = await import(/* @vite-ignore */ url);
    reconnectDecision = agent.reconnectDecision;
    createReconnector = agent.createReconnector;
    persistUntilSaved = agent.persistUntilSaved;
    pullBehavior = agent.pullBehavior;
    createBehaviorSync = agent.createBehaviorSync;
    expect(fetch).not.toHaveBeenCalled();
    expect(exit).not.toHaveBeenCalled();
  } finally { fetch.mockRestore(); exit.mockRestore(); }
});

const abnormalClose = { code: 1006, reason: "" };
const takeover = { code: 4001, reason: "" };
const randomNearOne = 1 - Number.EPSILON;

function decide(input: Partial<DecisionInput> = {}) {
  return reconnectDecision({ attempt: 0, connectedAt: null, closedAt: 0, ...abnormalClose, random: 0, ...input });
}

it("keeps the accumulated backoff at 59,999 ms and resets it at exactly 60,000 ms", () => {
  expect(decide({ attempt: 4, connectedAt: 0, closedAt: 59_999 })).toEqual({ action: "wait", attempt: 5, delayMs: 8_000 });
  expect(decide({ attempt: 4, connectedAt: 0, closedAt: 60_000 })).toEqual({ action: "wait", attempt: 1, delayMs: 1_000 });
});

it("increases consecutive handshake failures exponentially up to the equal-jitter cap", () => {
  const minimums = [1_000, 1_000, 2_000, 4_000, 8_000, 16_000, 30_000, 30_000];
  const maximums = [1_000, 2_000, 4_000, 8_000, 16_000, 32_000, 60_000, 60_000];
  let attempt = 0;
  for (const [index, minimum] of minimums.entries()) {
    const lower = decide({ attempt, closedAt: 120_000 });
    expect(lower).toEqual({ action: "wait", attempt: index + 1, delayMs: minimum });
    expect(decide({ attempt, closedAt: 120_000, random: randomNearOne })).toEqual({
      action: "wait", attempt: index + 1, delayMs: maximums[index],
    });
    attempt = lower.attempt;
  }
});

it.each([0, 0.25, 0.5, 0.75, randomNearOne])("waits 30–60 s after a same-device takeover with random=%s", (random) => {
  const result = decide({ ...takeover, random });
  expect(result.action).toBe("wait");
  if (result.action !== "wait") throw new Error("expected a retry after a takeover");
  expect(result.delayMs).toBeGreaterThanOrEqual(30_000);
  expect(result.delayMs).toBeLessThanOrEqual(60_000);
  expect(result.notice).toContain("同一设备号在别处在线");
});

it("keeps both instances at least 30 s apart from their own next retry across ten mutual takeovers", () => {
  const attempts = [0, 0];
  let closedAt = 1_000;
  for (let i = 0; i < 10; i += 1) {
    const instance = i % attempts.length;
    const result = decide({ ...takeover, attempt: attempts[instance]!, connectedAt: closedAt - 1_000, closedAt });
    if (result.action !== "wait") throw new Error("expected a retry after a takeover");
    expect(result.attempt).toBe(attempts[instance]! + 1);
    expect(result.delayMs).toBeGreaterThanOrEqual(30_000);
    attempts[instance] = result.attempt;
    closedAt += result.delayMs;
  }
});

it.each([
  ['{"retry_after_ms":1000}', 0, 1_000],
  ['{"retry_after_ms":45000}', 0, 45_000],
  ['{"retry_after_ms":45000}', 8, 60_000],
  ['{"retry_after_ms":9000000}', 0, 600_000],
  ['{"retry_after_ms":45000.5}', 0, 45_001],
  ["not JSON", 0, 30_000],
  ["null", 0, 30_000],
  ['{"retry_after_ms":0}', 0, 30_000],
  ['{"retry_after_ms":1e400}', 0, 30_000],
  ['{"retry_after_ms":"45000"}', 0, 30_000],
] as const)("applies the throttling delay for reason %s at attempt %i", (reason, attempt, delayMs) => {
  expect(decide({ code: 4002, reason, attempt, random: randomNearOne })).toMatchObject({
    action: "wait", delayMs, notice: expect.stringContaining("被限流"),
  });
});

it("stops retries when another installation replaces this one", () => {
  expect(decide({ code: 4010, attempt: 3 })).toEqual({
    action: "stop", attempt: 4, notice: expect.stringContaining("已停止自动重连"),
  });
});

it.each([1000, 1005, 1006, 4000])("uses ordinary backoff for close code %i", (code) => {
  expect(decide({ code, attempt: 3, random: 0.5 })).toEqual({ action: "wait", attempt: 4, delayMs: 6_000 });
});

describe("cloud agent reconnect scheduling", () => {
  beforeEach(() => { vi.useFakeTimers(); });
  afterEach(() => { vi.useRealTimers(); });

  function startAgent(refresh: Refresh = async () => ({ ok: true }), random = 0) {
    const connections: Connection[] = [];
    const start = vi.fn((connection: Connection) => { connections.push(connection); });
    const log = vi.fn();
    const agent = createReconnector({ start, refresh, random: () => random, log });
    agent.start();
    return { agent, start, log, connections };
  }

  it("waits the full 30 s after the first same-device takeover", async () => {
    const { start, connections } = startAgent();
    await connections[0]!.onClosed(takeover);
    vi.advanceTimersByTime(29_999);
    expect(start).toHaveBeenCalledTimes(1);
    vi.advanceTimersByTime(1);
    expect(start).toHaveBeenCalledTimes(2);
  });

  it("keeps the retry count after a brief handshake and resets it after a stable connection", async () => {
    const { log, connections } = startAgent(undefined, 0.5);
    await connections[0]!.onClosed(abnormalClose);
    vi.advanceTimersByTime(1_000);

    connections[1]!.onReady();
    vi.advanceTimersByTime(59_999);
    await connections[1]!.onClosed(abnormalClose);
    expect(log).toHaveBeenLastCalledWith("reconnect in", 1_500, "ms", "attempt", 2, "code", 1006);
    vi.advanceTimersByTime(1_500);

    connections[2]!.onReady();
    vi.advanceTimersByTime(60_000);
    await connections[2]!.onClosed(abnormalClose);
    expect(log).toHaveBeenLastCalledWith("reconnect in", 1_000, "ms", "attempt", 1, "code", 1006);
  });

  it("never starts again after close code 4010", async () => {
    const { agent, start, log, connections } = startAgent();
    await connections[0]!.onClosed({ code: 4010, reason: "" });
    agent.start();
    vi.runAllTimers();
    expect(start).toHaveBeenCalledTimes(1);
    expect(log).toHaveBeenCalledWith(expect.stringContaining("已停止自动重连"));
  });

  it("keeps one timer for repeated closes and ignores callbacks from the replaced connection", async () => {
    const refresh = vi.fn(async () => ({ ok: true }));
    const { start, connections } = startAgent(refresh);
    const first = connections[0]!;
    await first.onClosed(abnormalClose);
    await first.onClosed(abnormalClose);
    expect(vi.getTimerCount()).toBe(1);
    vi.runAllTimers();
    expect(start).toHaveBeenCalledTimes(2);

    const close = vi.fn();
    first.onAuthFailed(close);
    await first.onClosed({ code: 4010, reason: "" });
    await connections[1]!.onClosed(abnormalClose);
    expect(refresh).not.toHaveBeenCalled();
    expect(close).not.toHaveBeenCalled();
    expect(vi.getTimerCount()).toBe(1);
    vi.runAllTimers();
    expect(start).toHaveBeenCalledTimes(3);
  });

  it("waits for one refresh and reuses the accumulated backoff after success", async () => {
    let completeRefresh!: (result: { ok: boolean }) => void;
    const refresh = vi.fn(() => new Promise<{ ok: boolean }>((resolve) => { completeRefresh = resolve; }));
    const { start, log, connections } = startAgent(refresh, 0.5);
    await connections[0]!.onClosed(abnormalClose);
    vi.advanceTimersByTime(1_000);

    const authFailed = connections[1]!;
    const close = vi.fn();
    authFailed.onAuthFailed(close);
    authFailed.onAuthFailed(close);
    const closing = authFailed.onClosed({ code: 1000, reason: "client close" });
    await authFailed.onClosed(abnormalClose);
    expect(refresh).toHaveBeenCalledTimes(1);
    expect(close).toHaveBeenCalledTimes(1);
    expect(vi.getTimerCount()).toBe(0);

    completeRefresh({ ok: true });
    await closing;
    expect(log).toHaveBeenCalledWith("reconnect in", 1_500, "ms", "attempt", 2, "code", 1000);
    expect(vi.getTimerCount()).toBe(1);
    vi.advanceTimersByTime(1_499);
    expect(start).toHaveBeenCalledTimes(2);
    vi.advanceTimersByTime(1);
    expect(start).toHaveBeenCalledTimes(3);
  });

  it("stops reconnecting if the refresh token is rejected", async () => {
    const { start, log, connections } = startAgent(async () => ({ ok: false, permanent: true, code: 10003 }));
    connections[0]!.onAuthFailed(vi.fn());
    await connections[0]!.onClosed(abnormalClose);
    vi.runAllTimers();
    expect(start).toHaveBeenCalledTimes(1);
    expect(log).toHaveBeenCalledWith("refresh 永久失败，停止重连", 10003);
  });

  it.each([
    ["returns a transient failure", async () => ({ ok: false, permanent: false, code: "network" })],
  ] as const)("keeps backing off if refresh %s", async (_outcome, refresh) => {
    const { start, log, connections } = startAgent(refresh);
    connections[0]!.onAuthFailed(vi.fn());
    await connections[0]!.onClosed(abnormalClose);
    expect(log).not.toHaveBeenCalledWith("refresh 永久失败，停止重连", expect.anything());
    vi.advanceTimersByTime(1_000);
    expect(start).toHaveBeenCalledTimes(2);
  });
  it("stops and reports the error if refresh throws unexpectedly", async () => {
    const { start, log, connections } = startAgent(async () => { throw new Error("bad token payload"); });
    connections[0]!.onAuthFailed(vi.fn());
    await connections[0]!.onClosed(abnormalClose);
    vi.runAllTimers();
    expect(start).toHaveBeenCalledTimes(1);
    expect(log).toHaveBeenCalledWith("refresh 永久失败，停止重连", expect.stringContaining("bad token payload"));
  });
});

describe("persisting refreshed credentials", () => {
  it("keeps the rotated credentials and retries the write until it succeeds", async () => {
    const next = { refreshToken: "rotated" };
    const save = vi.fn()
      .mockImplementationOnce(() => { throw new Error("ENOSPC"); })
      .mockImplementationOnce(() => { throw new Error("EROFS"); })
      .mockImplementation(() => {});
    const waits: number[] = [];
    const log = vi.fn();
    await persistUntilSaved(next, { save, log, wait: async (ms) => { waits.push(ms); } });
    expect(save).toHaveBeenCalledTimes(3);
    for (const call of save.mock.calls) expect(call[0]).toBe(next);
    expect(waits).toEqual([1_000, 2_000]);
    expect(log).toHaveBeenCalledTimes(2);
    expect(log.mock.calls[0]![0]).toContain("状态文件写入失败");
  });

  it("does not settle while the write keeps failing", async () => {
    let settled = false;
    let releaseWait!: () => void;
    const save = vi.fn(() => { throw new Error("EROFS"); });
    const wait = vi.fn(() => new Promise<void>((resolve) => { releaseWait = resolve; }));
    void persistUntilSaved({}, { save, log: vi.fn(), wait }).then(() => { settled = true; });
    for (let i = 0; i < 3; i += 1) {
      await Promise.resolve();
      releaseWait();
      await Promise.resolve();
    }
    expect(save.mock.calls.length).toBeGreaterThan(1);
    expect(settled).toBe(false);
  });
});

describe("behavior recovery after reconnect", () => {
  it("re-pulls behavior on the replacement connection and ignores the dropped connection's response", async () => {
    const responses: Array<(behavior: string) => void> = [];
    const fetchImpl = vi.fn(() => new Promise<{ json: () => Promise<unknown> }>((resolve) => {
      responses.push((behavior) => resolve({ json: async () => ({ code: 0, data: { agent: { behavior } } }) }));
    }));
    const save = vi.fn();
    const applied: string[] = [];
    const sync = createBehaviorSync({
      pull: (state, isActive) => pullBehavior(state, isActive, { fetchImpl, save }),
      apply: (state) => { applied.push(state.behavior ?? ""); },
    });
    const state: BehaviorState = { agentId: "agt_1", accessToken: "token", behavior: "old" };

    let firstActive = true;
    await sync.onReady(state, () => firstActive);
    expect(fetchImpl).not.toHaveBeenCalled();

    const stale = sync.onInvalidated(state, () => firstActive);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    firstActive = false;

    const fresh = sync.onReady(state, () => true);
    expect(fetchImpl).toHaveBeenCalledTimes(2);
    responses[1]!("edited");
    await fresh;
    expect(state.behavior).toBe("edited");
    expect(applied).toEqual(["edited"]);

    responses[0]!("stale");
    await stale;
    expect(state.behavior).toBe("edited");
    expect(applied).toEqual(["edited"]);
    expect(save).toHaveBeenCalledTimes(1);
  });
});
