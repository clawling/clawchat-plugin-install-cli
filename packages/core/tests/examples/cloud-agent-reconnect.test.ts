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
type RefreshResult = { ok: boolean; permanent: boolean; code: string };
type Refresh = () => Promise<RefreshResult>;
type RefreshState = { accessToken: string; refreshToken: string; exp: number; iat?: number };
type JsonResponse = { json: () => Promise<unknown> };
type FetchImpl<Response> = (url: string, init?: RequestInit) => Promise<Response>;
type PersistOptions<State> = {
  save: (next: State) => void;
  log: (...args: unknown[]) => void;
  wait?: (ms: number) => Promise<void>;
};
type Persist = <State>(next: State, options: PersistOptions<State>) => Promise<void>;

let maxTimerMs: number;
let refreshMinIntervalMs: number;
let reconnectDecision: (input: DecisionInput) => Decision;
let persistUntilSaved: Persist;
let refresh: (state: RefreshState, deps?: Partial<Pick<PersistOptions<RefreshState>, "save" | "log">> & {
  fetchImpl?: FetchImpl<JsonResponse & { status: number }>;
  persist?: (next: RefreshState, options: PersistOptions<RefreshState>) => Promise<void>;
}) => Promise<RefreshResult>;
type BehaviorState = { agentId: string; accessToken: string; behavior?: string };
type IsActive = () => boolean;
type PullBehavior = (state: BehaviorState, isActive: IsActive, deps: {
  fetchImpl: FetchImpl<JsonResponse>;
  save: (state: BehaviorState) => void;
}) => Promise<boolean>;
let pullBehavior: PullBehavior;
let createBehaviorSync: (options: {
  pull: (state: BehaviorState, isActive: IsActive) => Promise<boolean>;
  apply: (state: BehaviorState) => void;
  startupFresh: boolean;
}) => {
  onReady: (state: BehaviorState, isActive: IsActive) => Promise<void>;
  onInvalidated: (state: BehaviorState, isActive: IsActive) => Promise<void>;
  markStale: () => void;
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
    maxTimerMs = agent.MAX_TIMER_MS;
    refreshMinIntervalMs = agent.REFRESH_MIN_INTERVAL_MS;
    reconnectDecision = agent.reconnectDecision;
    createReconnector = agent.createReconnector;
    persistUntilSaved = agent.persistUntilSaved;
    refresh = agent.refresh;
    pullBehavior = agent.pullBehavior;
    createBehaviorSync = agent.createBehaviorSync;
    expect(fetch).not.toHaveBeenCalled();
    expect(exit).not.toHaveBeenCalled();
  } finally { fetch.mockRestore(); exit.mockRestore(); }
});

const abnormalClose = { code: 1006, reason: "" };
const takeover = { code: 4001, reason: "" };
const randomNearOne = 1 - Number.EPSILON;
const refreshSucceeded: RefreshResult = { ok: true, permanent: false, code: "ok" };
const placeholderAccess = "eyJ.PLACEHOLDER-ACCESS.sig";
const placeholderRefresh = "PLACEHOLDER-REFRESH";
const placeholderUrl = "https://user:PLACEHOLDER-PASS@host";

function expectRedacted(calls: unknown[][]) {
  const logged = JSON.stringify(calls);
  for (const secret of ["PLACEHOLDER-ACCESS", placeholderRefresh, "PLACEHOLDER-PASS"]) {
    expect(logged).not.toContain(secret);
  }
}

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
  ['{"retry_after_ms":9000000}', 0, 9_000_000],
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

it("caps oversized server delays at the Node timer limit", () => {
  expect(maxTimerMs).toBe(2_147_483_647);
  expect(decide({ code: 4002, reason: '{"retry_after_ms":2147483648}' })).toMatchObject({
    action: "wait", delayMs: maxTimerMs,
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
  beforeEach(() => { vi.useFakeTimers({ toFake: ["Date", "performance", "setTimeout", "clearTimeout"] }); });
  afterEach(() => { vi.useRealTimers(); });

  function startAgent(refresh: Refresh = async () => refreshSucceeded, random = 0) {
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

  it("measures connection stability without counting a wall-clock jump", async () => {
    const { log, connections } = startAgent(undefined, 0.5);
    await connections[0]!.onClosed(abnormalClose);
    vi.advanceTimersByTime(1_000);

    connections[1]!.onReady();
    vi.setSystemTime(Date.now() + 60_000);
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
    const refresh = vi.fn(async () => refreshSucceeded);
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
    let completeRefresh!: (result: RefreshResult) => void;
    const refresh = vi.fn(() => new Promise<RefreshResult>((resolve) => { completeRefresh = resolve; }));
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

    completeRefresh(refreshSucceeded);
    await closing;
    expect(log).toHaveBeenCalledWith("reconnect in", 1_500, "ms", "attempt", 2, "code", 1000);
    expect(vi.getTimerCount()).toBe(1);
    vi.advanceTimersByTime(1_499);
    expect(start).toHaveBeenCalledTimes(2);
    vi.advanceTimersByTime(1);
    expect(start).toHaveBeenCalledTimes(3);
  });

  it("stops reconnecting if the refresh token is rejected", async () => {
    const { start, log, connections } = startAgent(async () => ({ ok: false, permanent: true, code: "rejected_10003" }));
    connections[0]!.onAuthFailed(vi.fn());
    await connections[0]!.onClosed(abnormalClose);
    vi.runAllTimers();
    expect(start).toHaveBeenCalledTimes(1);
    expect(log).toHaveBeenCalledWith("refresh 永久失败，停止重连", "rejected_10003");
  });

  it("waits at least 30 s to reconnect after a transient refresh failure", async () => {
    const { start, log, connections } = startAgent(async () => ({ ok: false, permanent: false, code: "network" }));
    connections[0]!.onAuthFailed(vi.fn());
    await connections[0]!.onClosed(abnormalClose);
    expect(log).not.toHaveBeenCalledWith("refresh 永久失败，停止重连", expect.anything());
    vi.advanceTimersByTime(29_999);
    expect(start).toHaveBeenCalledTimes(1);
    vi.advanceTimersByTime(1);
    expect(start).toHaveBeenCalledTimes(2);
  });

  it("closes without refreshing during the 30 s interval and waits out the remainder before reconnecting", async () => {
    const refreshTimes: number[] = [];
    const refresh = vi.fn(async () => { refreshTimes.push(performance.now()); return refreshSucceeded; });
    const { start, connections } = startAgent(refresh);
    expect(refreshMinIntervalMs).toBe(30_000);
    connections[0]!.onAuthFailed(vi.fn());
    await connections[0]!.onClosed(abnormalClose);
    vi.advanceTimersByTime(1_000);
    expect(start).toHaveBeenCalledTimes(2);

    const close = vi.fn();
    connections[1]!.onAuthFailed(close);
    expect(close).toHaveBeenCalledTimes(1);
    expect(refresh).toHaveBeenCalledTimes(1);
    await connections[1]!.onClosed(abnormalClose);
    vi.advanceTimersByTime(28_999);
    expect(start).toHaveBeenCalledTimes(2);
    vi.advanceTimersByTime(1);
    expect(start).toHaveBeenCalledTimes(3);
    connections[2]!.onAuthFailed(vi.fn());
    await connections[2]!.onClosed(abnormalClose);
    expect(refresh).toHaveBeenCalledTimes(2);
    expect(refreshTimes[1]! - refreshTimes[0]!).toBe(refreshMinIntervalMs);
  });

  it("stops and reports a fixed category if refresh throws unexpectedly", async () => {
    const { start, log, connections } = startAgent(async () => { throw new Error(`bad token payload: ${placeholderAccess}`); });
    connections[0]!.onAuthFailed(vi.fn());
    await connections[0]!.onClosed(abnormalClose);
    vi.runAllTimers();
    expect(start).toHaveBeenCalledTimes(1);
    expect(log).toHaveBeenCalledWith("refresh 永久失败，停止重连", "refresh_error");
    expectRedacted(log.mock.calls);
  });
});

describe("refreshing credentials", () => {
  const exp = 2_000_000_000;
  const iat = 1_999_999_000;
  const accessToken = `eyJ.${Buffer.from(JSON.stringify({ exp, iat })).toString("base64url")}.sig`;

  function fixture() {
    const state: RefreshState = { accessToken: placeholderAccess, refreshToken: placeholderRefresh, exp: 1 };
    const original = { ...state };
    const save = vi.fn<(next: RefreshState) => void>();
    const log = vi.fn();
    return { state, original, save, log };
  }

  function reply(body: unknown) {
    return async () => ({ status: 200, json: async () => body });
  }

  it.each([
    [400, true],
    [401, true],
    [403, true],
    [502, false],
  ] as const)("classifies a non-JSON HTTP %i response without writing state", async (status, permanent) => {
    const { state, original, save, log } = fixture();
    const fetchImpl = async () => ({ status, json: async () => { throw new Error(placeholderAccess); } });
    expect(await refresh(state, { fetchImpl, save, log })).toEqual({ ok: false, permanent, code: `http_${status}` });
    expect(save).not.toHaveBeenCalled();
    expect(state).toEqual(original);
    expectRedacted(log.mock.calls);
  });

  it.each([
    [10003, true, "rejected_10003"],
    [400, true, "rejected_400"],
    [1, false, "server_1"],
    [42, false, "server_42"],
    [placeholderRefresh, false, "server_unknown"],
  ] as const)("classifies JSON response code %s without writing state", async (code, permanent, category) => {
    const { state, original, save, log } = fixture();
    expect(await refresh(state, { fetchImpl: reply({ code }), save, log })).toEqual({ ok: false, permanent, code: category });
    expect(save).not.toHaveBeenCalled();
    expect(state).toEqual(original);
    expectRedacted(log.mock.calls);
  });

  it.each([
    ["a missing refresh token", { access_token: accessToken }],
    ["an empty access token", { access_token: "", refresh_token: placeholderRefresh }],
    ["a non-string refresh token", { access_token: accessToken, refresh_token: 12 }],
    ["an invalid JWT", { access_token: placeholderAccess, refresh_token: placeholderRefresh }],
    ["a non-numeric JWT expiry", {
      access_token: `eyJ.${Buffer.from(JSON.stringify({ exp: placeholderRefresh })).toString("base64url")}.sig`,
      refresh_token: placeholderRefresh,
    }],
  ] as const)("rejects a successful response with %s before saving or updating state", async (_condition, data) => {
    const { state, original, save, log } = fixture();
    expect(await refresh(state, { fetchImpl: reply({ code: 0, data }), save, log })).toEqual({
      ok: false, permanent: true, code: "invalid_response",
    });
    expect(save).not.toHaveBeenCalled();
    expect(state).toEqual(original);
    expect(log).not.toHaveBeenCalledWith("token refreshed");
    expectRedacted(log.mock.calls);
  });

  it.each([
    [400, { code: 1 }],
    [401, { code: 1 }],
    [403, { code: 42 }],
    [401, { code: 0, data: { access_token: accessToken, refresh_token: placeholderRefresh } }],
    [404, { code: 0, data: { access_token: accessToken, refresh_token: placeholderRefresh } }],
  ] as const)("stops on HTTP %i whatever the JSON body says, without writing state", async (status, body) => {
    const { state, original, save, log } = fixture();
    const fetchImpl = async () => ({ status, json: async () => body });
    expect(await refresh(state, { fetchImpl, save, log })).toEqual({ ok: false, permanent: true, code: `http_${status}` });
    expect(save).not.toHaveBeenCalled();
    expect(state).toEqual(original);
    expectRedacted(log.mock.calls);
  });

  it.each([408, 429, 500, 503])("never accepts tokens from a non-2xx HTTP %i response and retries later", async (status) => {
    const { state, original, save, log } = fixture();
    const body = { code: 0, data: { access_token: accessToken, refresh_token: `rotated-${placeholderRefresh}` } };
    const fetchImpl = async () => ({ status, json: async () => body });
    expect(await refresh(state, { fetchImpl, save, log })).toEqual({ ok: false, permanent: false, code: `http_${status}` });
    expect(save).not.toHaveBeenCalled();
    expect(state).toEqual(original);
    expect(log).not.toHaveBeenCalledWith("token refreshed");
  });

  it.each([
    ["two segments", `eyJ.${Buffer.from(JSON.stringify({ exp, iat })).toString("base64url")}`],
    ["an empty signature", `eyJ.${Buffer.from(JSON.stringify({ exp, iat })).toString("base64url")}.`],
    ["four segments", `${accessToken}.extra`],
  ])("rejects an access token with %s as an invalid response", async (_shape, badToken) => {
    const { state, original, save, log } = fixture();
    const fetchImpl = reply({ code: 0, data: { access_token: badToken, refresh_token: placeholderRefresh } });
    expect(await refresh(state, { fetchImpl, save, log })).toEqual({ ok: false, permanent: true, code: "invalid_response" });
    expect(save).not.toHaveBeenCalled();
    expect(state).toEqual(original);
  });

  it("reports a network failure without logging details from the request error", async () => {
    const { state, original, save, log } = fixture();
    const fetchImpl = async () => { throw new Error(`request to ${placeholderUrl} failed`); };
    expect(await refresh(state, { fetchImpl, save, log })).toEqual({ ok: false, permanent: false, code: "network" });
    expect(save).not.toHaveBeenCalled();
    expect(state).toEqual(original);
    expect(log.mock.calls).toEqual([["refresh request failed (network)"]]);
    expectRedacted(log.mock.calls);
  });

  it("saves the rotated tokens once before changing the live credentials", async () => {
    const { state, original, save, log } = fixture();
    const refreshToken = `rotated-${placeholderRefresh}`;
    const next = { ...state, accessToken, refreshToken, exp, iat };
    const fetchImpl = reply({ code: 0, data: { access_token: accessToken, refresh_token: refreshToken } });
    let stateAtSave: RefreshState | undefined;
    save.mockImplementation(() => { stateAtSave = { ...state }; });
    expect(await refresh(state, { fetchImpl, save, log })).toEqual(refreshSucceeded);
    expect(save).toHaveBeenCalledTimes(1);
    expect(save).toHaveBeenCalledWith(next);
    expect(stateAtSave).toEqual(original);
    expect(state).toEqual(next);
    expect(log.mock.calls).toEqual([["token refreshed"]]);
    expectRedacted(log.mock.calls);
  });
});

describe("persisting refreshed credentials", () => {
  it("keeps the rotated credentials and retries the write until it succeeds", async () => {
    const next = { accessToken: placeholderAccess, refreshToken: placeholderRefresh };
    const save = vi.fn<(value: typeof next) => void>()
      .mockImplementationOnce(() => { throw Object.assign(new Error(placeholderRefresh), { code: "ENOSPC" }); })
      .mockImplementationOnce(() => { throw new Error(placeholderAccess); })
      .mockImplementation(() => {});
    const waits: number[] = [];
    const log = vi.fn();
    await persistUntilSaved(next, { save, log, wait: async (ms) => { waits.push(ms); } });
    expect(save).toHaveBeenCalledTimes(3);
    for (const call of save.mock.calls) expect(call[0]).toBe(next);
    expect(waits).toEqual([1_000, 2_000]);
    expect(log).toHaveBeenCalledTimes(2);
    expect(log.mock.calls[0]![0]).toContain("状态文件写入失败");
    expect(log.mock.calls.map((call) => call[1])).toEqual(["ENOSPC", "write_failed"]);
    expectRedacted(log.mock.calls);
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
  const active = () => true;

  function setupBehaviorSync(startupFresh: boolean) {
    const responses: Array<(behavior: string) => void> = [];
    const fetchImpl = vi.fn(() => new Promise<JsonResponse>((resolve) => {
      responses.push((behavior) => resolve({ json: async () => ({ code: 0, data: { agent: { behavior } } }) }));
    }));
    const save = vi.fn<(state: BehaviorState) => void>();
    const applied: string[] = [];
    const sync = createBehaviorSync({
      startupFresh,
      pull: (state, isActive) => pullBehavior(state, isActive, { fetchImpl, save }),
      apply: (state) => { applied.push(state.behavior ?? ""); },
    });
    return { sync, fetchImpl, save, applied, responses };
  }

  function behaviorState(): BehaviorState {
    return { agentId: "agt_1", accessToken: placeholderAccess, behavior: "old" };
  }

  it("pulls behavior on the first ready event if the startup read failed", async () => {
    const state = behaviorState();
    const startupFresh = await pullBehavior(state, active, {
      fetchImpl: async () => ({ json: async () => ({ code: 1 }) }),
      save: vi.fn(),
    });
    expect(startupFresh).toBe(false);
    const { sync, responses, applied } = setupBehaviorSync(startupFresh);

    const ready = sync.onReady(state, active);
    responses[0]!("edited");
    await ready;
    expect(applied).toEqual(["edited"]);
  });

  it("pulls behavior on the first ready event if startup behavior was marked stale", async () => {
    const { sync, responses, applied } = setupBehaviorSync(true);
    sync.markStale();
    const ready = sync.onReady(behaviorState(), active);
    responses[0]!("edited");
    await ready;
    expect(applied).toEqual(["edited"]);
  });

  it("skips the first ready pull after a successful startup read and pulls again on the replacement connection", async () => {
    const state = behaviorState();
    const startupFresh = await pullBehavior(state, active, {
      fetchImpl: async () => ({ json: async () => ({ code: 0, data: { agent: { behavior: state.behavior } } }) }),
      save: vi.fn(),
    });
    expect(startupFresh).toBe(true);
    const { sync, responses, fetchImpl, save, applied } = setupBehaviorSync(startupFresh);

    let firstActive = true;
    await sync.onReady(state, () => firstActive);
    expect(fetchImpl).not.toHaveBeenCalled();

    const stale = sync.onInvalidated(state, () => firstActive);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    firstActive = false;

    const fresh = sync.onReady(state, active);
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

  it.each([
    ["older request responds first", "A"],
    ["newer request responds first", "B"],
  ] as const)("ends with the latest behavior request on the same connection when the %s", async (_order, first) => {
    const { sync, responses, save, applied } = setupBehaviorSync(true);
    const state = behaviorState();
    const a = sync.onInvalidated(state, active);
    const b = sync.onInvalidated(state, active);
    const pending = { A: a, B: b };
    const second = first === "A" ? "B" : "A";
    const respond = { A: responses[0]!, B: responses[1]! };

    respond[first](first);
    await pending[first];
    // An earlier response that arrives first is newer than anything applied yet, so it is kept
    // (a later failure must not lose it); once B is applied, A can no longer overwrite it.
    expect(state.behavior).toBe(first);
    expect(save).toHaveBeenCalledTimes(1);

    respond[second](second);
    await pending[second];
    expect(state.behavior).toBe("B");
    expect(save).toHaveBeenLastCalledWith({ ...state, behavior: "B" });
    expect(save).toHaveBeenCalledTimes(first === "A" ? 2 : 1);
    expect(applied).toEqual(first === "A" ? ["A", "B"] : ["B"]);
  });
});

describe("behavior pulls on one connection", () => {
  it("keeps an earlier in-flight success when the later pull fails", async () => {
    const pending: Array<(body: unknown) => void> = [];
    const fetchImpl = vi.fn(() => new Promise<JsonResponse>((resolve) => {
      pending.push((body) => resolve({ json: async () => body }));
    }));
    const save = vi.fn<(state: BehaviorState) => void>();
    const applied: string[] = [];
    const sync = createBehaviorSync({
      startupFresh: true,
      pull: (state, isActive) => pullBehavior(state, isActive, { fetchImpl, save }),
      apply: (state) => { applied.push(state.behavior ?? ""); },
    });
    const state: BehaviorState = { agentId: "agt_1", accessToken: placeholderAccess, behavior: "old" };

    const first = sync.onInvalidated(state, () => true);
    const second = sync.onInvalidated(state, () => true);
    pending[1]!({ code: 500 });
    await second;
    pending[0]!({ code: 0, data: { agent: { behavior: "edited" } } });
    await first;

    expect(state.behavior).toBe("edited");
    expect(applied).toEqual(["edited"]);
    expect(save).toHaveBeenCalledTimes(1);
  });

  it("drops an earlier success that resolves in the same tick as a later success", async () => {
    const pending: Array<(body: unknown) => void> = [];
    const fetchImpl = vi.fn(() => new Promise<JsonResponse>((resolve) => {
      pending.push((body) => resolve({ json: async () => body }));
    }));
    const save = vi.fn<(state: BehaviorState) => void>();
    const applied: string[] = [];
    const sync = createBehaviorSync({
      startupFresh: true,
      pull: (state, isActive) => pullBehavior(state, isActive, { fetchImpl, save }),
      apply: (state) => { applied.push(state.behavior ?? ""); },
    });
    const state: BehaviorState = { agentId: "agt_1", accessToken: placeholderAccess, behavior: "old" };

    const first = sync.onInvalidated(state, () => true);
    const second = sync.onInvalidated(state, () => true);
    pending[1]!({ code: 0, data: { agent: { behavior: "newer" } } });
    pending[0]!({ code: 0, data: { agent: { behavior: "older" } } });
    await Promise.all([first, second]);

    expect(state.behavior).toBe("newer");
    expect(applied).toEqual(["newer"]);
  });
});
