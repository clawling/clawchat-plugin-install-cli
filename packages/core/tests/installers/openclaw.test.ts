import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { installOpenClawPlugin, updateOpenClawPlugin } from "../../src/installers/openclaw";

const OPENCLAW_PLUGIN_SPEC = "@clawling/clawchat-plugin-openclaw";
const UNSAFE_FLAG = "--dangerously-force-unsafe-install";

// A pre-2026.8 host: its `plugins install --help` does not advertise
// --accept-capabilities, so the installer must not pass that flag.
function mockHostWorkspaceCapture() {
  return vi.fn(async (cmd: string, args: readonly string[]) => {
    if (cmd === "openclaw" && args.join(" ") === "config get agents.defaults.workspace") {
      return "/Users/alice/.openclaw/workspace\n";
    }
    if (cmd === "openclaw" && args.join(" ") === "plugins install --help") {
      return "Options:\n  --dangerously-force-unsafe-install  Deprecated no-op\n";
    }
    throw new Error(`unexpected capture: ${cmd} ${args.join(" ")}`);
  });
}

const CAPABILITY_PROBE: [string, string[]] = ["openclaw", ["plugins", "install", "--help"]];

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
      ["openclaw", ["plugins", "install", OPENCLAW_PLUGIN_SPEC, "--force", UNSAFE_FLAG]],
    ]);
    expect(capture.mock.calls).toEqual([
      ["openclaw", ["config", "get", "agents.defaults.workspace"]],
      CAPABILITY_PROBE,
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
      ["openclaw", ["plugins", "install", OPENCLAW_PLUGIN_SPEC, "--force", UNSAFE_FLAG]],
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
      ["openclaw", ["plugins", "install", OPENCLAW_PLUGIN_SPEC, "--force", UNSAFE_FLAG]],
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
      ["openclaw", ["plugins", "install", OPENCLAW_PLUGIN_SPEC, "--force", UNSAFE_FLAG]],
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
      CAPABILITY_PROBE,
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
      CAPABILITY_PROBE,
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
      CAPABILITY_PROBE,
    ]);
  });

  it("appends the @ref to the npm spec", async () => {
    const run = vi.fn(async () => undefined);
    const capture = mockHostWorkspaceCapture();
    const writeBaseUrls = vi.fn();

    await installOpenClawPlugin({ run, capture, ref: "dev", writeBaseUrls });

    expect(run.mock.calls).toEqual([
      ["openclaw", ["plugins", "install", "@clawling/clawchat-plugin-openclaw@dev", "--force", UNSAFE_FLAG]],
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

// OpenClaw >=2026.8 gates managed plugins behind capability consent: without
// `--accept-capabilities`, `plugins install` aborts with "requires capability consent"
// and the plugin is never installed. Older hosts (verified on 2026.6.34 and 2026.7.1)
// reject the flag outright with `OpenClaw does not recognize option`, so it can only be
// passed to hosts whose own `plugins install --help` advertises it.
describe("OpenClaw installer capability consent", () => {
  function captureWithHelp(helpText: string) {
    return vi.fn(async (cmd: string, args: readonly string[]) => {
      const joined = args.join(" ");
      if (joined === "config get agents.defaults.workspace") {
        return "/Users/alice/.openclaw/workspace\n";
      }
      if (joined === "plugins install --help") {
        return helpText;
      }
      throw new Error(`unexpected capture: ${cmd} ${joined}`);
    });
  }

  const MODERN_HELP = [
    "Options:",
    "  --accept-capabilities                 Accept the plugin's declared capabilities",
    "  --dangerously-force-unsafe-install    Deprecated no-op",
  ].join("\n");

  const LEGACY_HELP = [
    "Options:",
    "  --dangerously-force-unsafe-install  Deprecated no-op",
  ].join("\n");

  it("accepts declared capabilities on hosts that advertise the flag", async () => {
    const run = vi.fn(async () => undefined);

    await installOpenClawPlugin({ run, capture: captureWithHelp(MODERN_HELP) });

    expect(run.mock.calls).toEqual([
      [
        "openclaw",
        ["plugins", "install", OPENCLAW_PLUGIN_SPEC, "--force", UNSAFE_FLAG, "--accept-capabilities"],
      ],
    ]);
  });

  it("omits the flag on hosts that would reject it", async () => {
    const run = vi.fn(async () => undefined);

    await installOpenClawPlugin({ run, capture: captureWithHelp(LEGACY_HELP) });

    expect(run.mock.calls).toEqual([
      ["openclaw", ["plugins", "install", OPENCLAW_PLUGIN_SPEC, "--force", UNSAFE_FLAG]],
    ]);
  });

  it("passes the flag on updates too", async () => {
    const run = vi.fn(async () => undefined);

    await updateOpenClawPlugin({ run, capture: captureWithHelp(MODERN_HELP) });

    expect(run.mock.calls).toEqual([
      [
        "openclaw",
        ["plugins", "update", OPENCLAW_PLUGIN_SPEC, UNSAFE_FLAG, "--accept-capabilities"],
      ],
    ]);
  });

  it("omits the flag when the host cannot be probed", async () => {
    const run = vi.fn(async () => undefined);
    const capture = vi.fn(async (cmd: string, args: readonly string[]) => {
      if (args.join(" ") === "config get agents.defaults.workspace") {
        return "/Users/alice/.openclaw/workspace\n";
      }
      throw new Error("probe failed");
    });

    await installOpenClawPlugin({ run, capture });

    expect(run.mock.calls).toEqual([
      ["openclaw", ["plugins", "install", OPENCLAW_PLUGIN_SPEC, "--force", UNSAFE_FLAG]],
    ]);
  });
});

// OpenClaw 2026.8 widened --force to also mean "confirm a non-ClawHub source", and the
// ClawChat plugin is always installed from npm. Without it `plugins install` prints
// "Install cancelled; rerun with --force after reviewing the source" and exits 1, so the
// plugin never lands. Verified on openclaw 2026.8.2. On 2026.6.x/2026.7.x --force only
// means "overwrite an existing plugin", which is harmless for an idempotent install.
describe("OpenClaw installer non-ClawHub source confirmation", () => {
  it("confirms the npm source on a plain install", async () => {
    const run = vi.fn(async () => undefined);

    await installOpenClawPlugin({ run, capture: mockHostWorkspaceCapture() });

    expect(run.mock.calls).toEqual([
      ["openclaw", ["plugins", "install", OPENCLAW_PLUGIN_SPEC, "--force", UNSAFE_FLAG]],
    ]);
  });

  it("does not duplicate the flag for an explicitly forced install", async () => {
    const run = vi.fn(async () => undefined);

    await installOpenClawPlugin({ run, capture: mockHostWorkspaceCapture(), force: true });

    expect(run.mock.calls).toEqual([
      ["openclaw", ["plugins", "install", OPENCLAW_PLUGIN_SPEC, "--force", UNSAFE_FLAG]],
    ]);
  });
});
