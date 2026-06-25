import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { installOpenClawPlugin, updateOpenClawPlugin } from "../../src/installers/openclaw";

const OPENCLAW_PLUGIN_SPEC = "@clawling/clawchat-plugin-openclaw";
const UNSAFE_FLAG = "--dangerously-force-unsafe-install";

function mockHostWorkspaceCapture() {
  return vi.fn(async (cmd: string, args: readonly string[]) => {
    if (cmd === "openclaw" && args.join(" ") === "config get agents.defaults.workspace") {
      return "/Users/alice/.openclaw/workspace\n";
    }
    throw new Error(`unexpected capture: ${cmd} ${args.join(" ")}`);
  });
}

describe("OpenClaw installer", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("delegates install to OpenClaw's npm plugin installer", async () => {
    const run = vi.fn(async () => undefined);
    const capture = mockHostWorkspaceCapture();

    await expect(installOpenClawPlugin({ run, capture })).resolves.toMatchObject({
      kind: "plugin",
      target: "openclaw",
      status: "installed",
    });

    expect(run.mock.calls).toEqual([
      ["openclaw", ["plugins", "install", OPENCLAW_PLUGIN_SPEC, UNSAFE_FLAG]],
    ]);
    expect(capture.mock.calls).toEqual([
      ["openclaw", ["config", "get", "agents.defaults.workspace"]],
    ]);
  });

  it("repairs a stale container workspace before installing on the host", async () => {
    vi.stubEnv("HOME", "/Users/alice");
    const run = vi.fn(async () => undefined);
    const capture = vi.fn(async (cmd: string, args: readonly string[]) => {
      if (cmd === "openclaw" && args.join(" ") === "config get agents.defaults.workspace") {
        return "/home/node/.openclaw/workspace\n";
      }
      throw new Error(`unexpected capture: ${cmd} ${args.join(" ")}`);
    });

    await expect(installOpenClawPlugin({ run, capture })).resolves.toMatchObject({
      kind: "plugin",
      target: "openclaw",
      status: "installed",
    });

    expect(run.mock.calls).toEqual([
      ["openclaw", ["config", "set", "agents.defaults.workspace", "~/.openclaw/workspace"]],
      ["openclaw", ["plugins", "install", OPENCLAW_PLUGIN_SPEC, UNSAFE_FLAG]],
    ]);
  });

  it("leaves the container workspace unchanged when running inside that home", async () => {
    vi.stubEnv("HOME", "/home/node");
    const run = vi.fn(async () => undefined);
    const capture = vi.fn(async (cmd: string, args: readonly string[]) => {
      if (cmd === "openclaw" && args.join(" ") === "config get agents.defaults.workspace") {
        return "/home/node/.openclaw/workspace\n";
      }
      throw new Error(`unexpected capture: ${cmd} ${args.join(" ")}`);
    });

    await expect(installOpenClawPlugin({ run, capture })).resolves.toMatchObject({
      kind: "plugin",
      target: "openclaw",
      status: "installed",
    });

    expect(run.mock.calls).toEqual([
      ["openclaw", ["plugins", "install", OPENCLAW_PLUGIN_SPEC, UNSAFE_FLAG]],
    ]);
  });

  it("does not initialize OpenClaw when no default workspace is configured", async () => {
    const run = vi.fn(async () => undefined);
    const capture = vi.fn(async (cmd: string, args: readonly string[]) => {
      if (cmd === "openclaw" && args.join(" ") === "config get agents.defaults.workspace") {
        throw new Error("Config path not found: agents.defaults.workspace");
      }
      throw new Error(`unexpected capture: ${cmd} ${args.join(" ")}`);
    });

    await expect(installOpenClawPlugin({ run, capture })).resolves.toMatchObject({
      kind: "plugin",
      target: "openclaw",
      status: "installed",
    });

    expect(run.mock.calls).toEqual([
      ["openclaw", ["plugins", "install", OPENCLAW_PLUGIN_SPEC, UNSAFE_FLAG]],
    ]);
  });

  it("passes force to OpenClaw's npm plugin installer", async () => {
    const run = vi.fn(async () => undefined);
    const capture = mockHostWorkspaceCapture();

    await expect(installOpenClawPlugin({ run, capture, force: true })).resolves.toMatchObject({
      kind: "plugin",
      target: "openclaw",
      status: "updated",
    });

    expect(run.mock.calls).toEqual([
      ["openclaw", ["plugins", "install", OPENCLAW_PLUGIN_SPEC, "--force", UNSAFE_FLAG]],
    ]);
    expect(capture.mock.calls).toEqual([
      ["openclaw", ["config", "get", "agents.defaults.workspace"]],
    ]);
  });

  it("delegates update to OpenClaw's npm plugin updater", async () => {
    const run = vi.fn(async () => undefined);
    const capture = mockHostWorkspaceCapture();

    await expect(updateOpenClawPlugin({ run, capture })).resolves.toMatchObject({
      kind: "plugin",
      target: "openclaw",
      status: "updated",
    });

    expect(run.mock.calls).toEqual([
      ["openclaw", ["plugins", "update", OPENCLAW_PLUGIN_SPEC, UNSAFE_FLAG]],
    ]);
    expect(capture.mock.calls).toEqual([
      ["openclaw", ["config", "get", "agents.defaults.workspace"]],
    ]);
  });

  it("uses forced install for forced OpenClaw updates", async () => {
    const run = vi.fn(async () => undefined);
    const capture = mockHostWorkspaceCapture();

    await expect(updateOpenClawPlugin({ run, capture, force: true })).resolves.toMatchObject({
      kind: "plugin",
      target: "openclaw",
      status: "updated",
    });

    expect(run.mock.calls).toEqual([
      ["openclaw", ["plugins", "install", OPENCLAW_PLUGIN_SPEC, "--force", UNSAFE_FLAG]],
    ]);
    expect(capture.mock.calls).toEqual([
      ["openclaw", ["config", "get", "agents.defaults.workspace"]],
    ]);
  });

  it("appends the @ref to the npm spec", async () => {
    const run = vi.fn(async () => undefined);
    const capture = mockHostWorkspaceCapture();
    const writeBaseUrls = vi.fn();

    await installOpenClawPlugin({ run, capture, ref: "dev", writeBaseUrls });

    expect(run.mock.calls).toEqual([
      ["openclaw", ["plugins", "install", "@clawling/clawchat-plugin-openclaw@dev", UNSAFE_FLAG]],
    ]);
  });

  it("writes base urls AFTER installing the plugin", async () => {
    const order: string[] = [];
    const run = vi.fn(async () => {
      order.push("run");
    });
    const capture = mockHostWorkspaceCapture();
    const writeBaseUrls = vi.fn(() => {
      order.push("write");
    });

    await installOpenClawPlugin({
      run,
      capture,
      writeBaseUrls,
      apiBaseUrl: "https://api.test:39001",
      wsBaseUrl: "wss://ws.test:39002/ws",
      mediaBaseUrl: "https://m.test:39003",
    });

    expect(writeBaseUrls).toHaveBeenCalledWith({
      apiBaseUrl: "https://api.test:39001",
      wsBaseUrl: "wss://ws.test:39002/ws",
      mediaBaseUrl: "https://m.test:39003",
    });
    // The channel id is not registered until `openclaw plugins install` runs, so the
    // channel-config write MUST come after it or install-time config validation fails
    // with "unknown channel id".
    expect(order).toEqual(["run", "write"]);
  });

  it("migrates a legacy openclaw config on disk during install", async () => {
    const home = fs.mkdtempSync(path.join(os.tmpdir(), "openclaw-install-mig-"));
    try {
      const cfgPath = path.join(home, ".openclaw", "openclaw.json");
      fs.mkdirSync(path.dirname(cfgPath), { recursive: true });
      fs.writeFileSync(
        cfgPath,
        JSON.stringify({
          channels: { "openclaw-clawchat": { token: "tok", userId: "usr_1" } },
          plugins: { allow: ["openclaw-clawchat"] },
        }),
      );

      const run = vi.fn(async () => undefined);
      const capture = mockHostWorkspaceCapture();
      const writeBaseUrls = vi.fn();

      await installOpenClawPlugin({ run, capture, writeBaseUrls, homeDir: home });

      const cfg = JSON.parse(fs.readFileSync(cfgPath, "utf8"));
      expect(cfg.channels["clawchat-plugin-openclaw"]).toEqual({ token: "tok", userId: "usr_1" });
      expect(cfg.channels["openclaw-clawchat"]).toBeUndefined();
      expect(cfg.plugins.allow).toEqual(["clawchat-plugin-openclaw"]);
    } finally {
      fs.rmSync(home, { recursive: true, force: true });
    }
  });
});
