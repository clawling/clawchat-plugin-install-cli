import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { installOpenClawPlugin, updateOpenClawPlugin } from "../../src/installers/openclaw";
import { ClawchatError } from "../../src/errors";
import { classifyInstallFailure } from "../../src/progress-report";

const OPENCLAW_PLUGIN_SPEC = "@clawling/clawchat-plugin-openclaw";
const UNSAFE_FLAG = "--dangerously-force-unsafe-install";

// Capability flags are selected from help independently of the version probe.
function mockHostWorkspaceCapture(version: string | Error = "OpenClaw 2026.10.8 (placeholder)") {
  return vi.fn(async (cmd: string, args: readonly string[]) => {
    if (cmd === "openclaw" && args.join(" ") === "--version") {
      if (version instanceof Error) throw version;
      return version;
    }
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
const VERSION_PROBE: [string, string[]] = ["openclaw", ["--version"]];
// Asked after the install to tell a QClaw config from a stock OpenClaw one.
const CONFIG_FILE_PROBE: [string, string[]] = ["openclaw", ["config", "file"]];

describe("OpenClaw host compatibility", () => {
  const pinnedSpec = `${OPENCLAW_PLUGIN_SPEC}@2026.10.9-2`;

  it.each([installOpenClawPlugin, updateOpenClawPlugin])("stops an unsupported host before any other host command or config write (%s)", async (action) => {
    const capture = mockHostWorkspaceCapture("OpenClaw 2026.4.14");
    const run = vi.fn(async () => undefined);
    const migrateLegacyConfig = vi.fn(() => []);
    const writeBaseUrls = vi.fn();
    const error = await action({ run, capture, migrateLegacyConfig, writeBaseUrls }).catch((err) => err);

    expect(error).toBeInstanceOf(ClawchatError);
    expect(error.code).toBe("PRECONDITION");
    for (const text of ["too old", "2026.4.14", "2026.5.4", "npm install -g openclaw@latest", "openclaw update", "rerun the same installer command"]) {
      expect(error.message).toContain(text);
    }
    expect(classifyInstallFailure(error)).toBe("host_too_old");
    expect(capture.mock.calls).toEqual([VERSION_PROBE]);
    expect(run).not.toHaveBeenCalled();
    expect(migrateLegacyConfig).not.toHaveBeenCalled();
    expect(writeBaseUrls).not.toHaveBeenCalled();
  });

  it.each([
    [installOpenClawPlugin, false, "install"],
    [updateOpenClawPlugin, false, "update"],
    [updateOpenClawPlugin, true, "install"],
  ] as const)("pins the last compatible release for an older supported host (%s, force=%s)", async (action, force, command) => {
    const run = vi.fn(async () => undefined);
    const capture = mockHostWorkspaceCapture("OpenClaw 2026.6.20");
    const progress = vi.fn();
    await action({ run, capture, force, onProgress: progress });

    expect(run.mock.calls).toEqual([
      ["openclaw", ["plugins", command, pinnedSpec, ...(command === "install" ? ["--force"] : []), UNSAFE_FLAG]],
    ]);
    expect(capture.mock.calls).toEqual([
      VERSION_PROBE,
      ["openclaw", ["config", "get", "agents.defaults.workspace"]],
      CAPABILITY_PROBE,
      CONFIG_FILE_PROBE,
    ]);
    expect(progress).toHaveBeenCalledWith(expect.stringMatching(/2026\.6\.20.*2026\.10\.9-2.*last.*compatible.*Upgrade OpenClaw.*latest/));
  });

  it.each(["OpenClaw 2026.10.8", "2026.10.8-1"])("keeps the unpinned spec on a current host (%s)", async (version) => {
    const run = vi.fn(async () => undefined);
    await installOpenClawPlugin({ run, capture: mockHostWorkspaceCapture(version) });
    expect(run.mock.calls).toEqual([
      ["openclaw", ["plugins", "install", OPENCLAW_PLUGIN_SPEC, "--force", UNSAFE_FLAG]],
    ]);
  });

  it.each(["unknown wrapper output", new Error("version probe failed")])("keeps the unpinned spec and explains an unreadable version (%s)", async (version) => {
    const run = vi.fn(async () => undefined);
    const progress = vi.fn();
    const capture = mockHostWorkspaceCapture(version);
    await installOpenClawPlugin({ run, capture, onProgress: progress });
    expect(run.mock.calls).toEqual([
      ["openclaw", ["plugins", "install", OPENCLAW_PLUGIN_SPEC, "--force", UNSAFE_FLAG]],
    ]);
    expect(capture.mock.calls).toEqual([
      VERSION_PROBE,
      ["openclaw", ["config", "get", "agents.defaults.workspace"]],
      CAPABILITY_PROBE,
      CONFIG_FILE_PROBE,
    ]);
    expect(progress).toHaveBeenCalledWith(expect.stringContaining("version could not be read"));
  });

  it.each([installOpenClawPlugin, updateOpenClawPlugin])("lets an explicit ref win without probing the host version (%s)", async (action) => {
    const run = vi.fn(async () => undefined);
    const capture = mockHostWorkspaceCapture("OpenClaw 2026.4.14");
    await action({ run, capture, ref: "2026.10.9-2" });
    expect(run.mock.calls).toEqual([
      ["openclaw", ["plugins", action === installOpenClawPlugin ? "install" : "update", pinnedSpec,
        ...(action === installOpenClawPlugin ? ["--force"] : []), UNSAFE_FLAG]],
    ]);
    expect(capture.mock.calls).toEqual([
      ["openclaw", ["config", "get", "agents.defaults.workspace"]],
      CAPABILITY_PROBE,
      CONFIG_FILE_PROBE,
    ]);
  });
});

describe("OpenClaw host refusal advice", () => {
  const prereleaseLine = `Resolved ${OPENCLAW_PLUGIN_SPEC} to prerelease version 2026.10.27-1, but prereleases are only installed when explicitly requested. Use "${OPENCLAW_PLUGIN_SPEC}@beta" (or another prerelease tag) or an exact prerelease version to opt in explicitly.`;

  it.each([installOpenClawPlugin, updateOpenClawPlugin])("explains a host prerelease refusal with upgrade and exact-version advice (%s)", async (action) => {
    const run = vi.fn(async () => { throw new ClawchatError("SUBPROCESS", `openclaw failed with exit code 1: ${prereleaseLine}`); });
    const error = await action({ run, capture: mockHostWorkspaceCapture("unknown wrapper") }).catch((err) => err);
    expect(error).toBeInstanceOf(ClawchatError);
    expect(error.code).toBe("PRERELEASE_REFUSED");
    expect(classifyInstallFailure(error)).toBe("prerelease_refused");
    for (const text of [prereleaseLine, "older than the plugin supports", "version could not be read", "openclaw --version",
      "npm install -g openclaw@latest", "openclaw update", "rerun the same installer command", "--target openclaw@2026.10.9-2", "2026.5.4", "2026.8.1"]) {
      expect(error.message).toContain(text);
    }
  });

  it.each(["2026.4.14", "version could not be determined"])("explains a host minimum-version refusal (%s)", async (version) => {
    const hostLine = `plugin "clawchat-plugin-openclaw" requires OpenClaw >=2026.5.4, but this host ${version === "2026.4.14" ? `is ${version}` : version}. Upgrade OpenClaw and retry.`;
    const run = vi.fn(async () => { throw new ClawchatError("SUBPROCESS", `openclaw failed with exit code 1: ${hostLine}`); });
    const error = await installOpenClawPlugin({ run, capture: mockHostWorkspaceCapture("unknown wrapper") }).catch((err) => err);
    expect(error.code).toBe("PRECONDITION");
    expect(error.message).toContain(hostLine);
    expect(error.message).toContain("too old");
    expect(error.message).toContain("npm install -g openclaw@latest");
    expect(error.message).toContain("openclaw update");
    expect(classifyInstallFailure(error)).toBe("host_too_old");
  });

  it("lists only legacy key paths from colored host output and leaves config migration to the owner", async () => {
    const output = [
      "\u001b[31mConfig invalid\u001b[0m", "File: ~/.openclaw/openclaw.json", "Problem:",
      "  - channels.placeholder: PLACEHOLDER_CHANNEL_VALUE",
      "\u001b[33mLegacy config keys detected:\u001b[0m",
      "  - \u001b[36mgateway.bind\u001b[0m: PLACEHOLDER_BIND_VALUE",
      "  - tools.bySender: PLACEHOLDER_SENDER_VALUE", "", "Run openclaw doctor --fix",
    ].join("\n");
    const run = vi.fn(async () => { throw new ClawchatError("SUBPROCESS", `openclaw failed with exit code 1: ${output}`); });
    // Invalid config also prevents workspace/help probes on affected hosts.
    const capture = vi.fn(async (_cmd: string, args: readonly string[]) => {
      if (args.join(" ") === "--version") return "OpenClaw 2026.10.8";
      throw new ClawchatError("SUBPROCESS", output);
    });
    const migrateLegacyConfig = vi.fn(() => []);
    const writeBaseUrls = vi.fn();
    const error = await installOpenClawPlugin({ run, capture, migrateLegacyConfig, writeBaseUrls }).catch((err) => err);
    expect(error.code).toBe("LEGACY_CONFIG");
    expect(classifyInstallFailure(error)).toBe("legacy_config");
    for (const text of ["gateway.bind", "tools.bySender", "The installer did not change your OpenClaw config.", "Back up the config file",
      "openclaw doctor --fix", "openclaw config validate", "rerun this installer"]) expect(error.message).toContain(text);
    for (const text of ["PLACEHOLDER_CHANNEL_VALUE", "PLACEHOLDER_BIND_VALUE", "PLACEHOLDER_SENDER_VALUE", "channels.placeholder", "\u001b", "File:"]) {
      expect(error.message).not.toContain(text);
    }
    expect(run.mock.calls).toEqual([
      ["openclaw", ["plugins", "install", OPENCLAW_PLUGIN_SPEC, "--force", UNSAFE_FLAG]],
    ]);
    expect(capture.mock.calls).toEqual([
      VERSION_PROBE, ["openclaw", ["config", "get", "agents.defaults.workspace"]], CAPABILITY_PROBE,
    ]);
    expect(migrateLegacyConfig).not.toHaveBeenCalled();
    expect(writeBaseUrls).not.toHaveBeenCalled();
  });

  it.each([installOpenClawPlugin, updateOpenClawPlugin])("rethrows an unrelated subprocess error unchanged (%s)", async (action) => {
    const original = new ClawchatError("SUBPROCESS", "openclaw failed with exit code 1: unrelated refusal");
    const run = vi.fn(async () => { throw original; });
    await expect(action({ run, capture: mockHostWorkspaceCapture() })).rejects.toBe(original);
  });
});

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
      VERSION_PROBE,
      ["openclaw", ["config", "get", "agents.defaults.workspace"]],
      CAPABILITY_PROBE,
      CONFIG_FILE_PROBE,
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
      VERSION_PROBE,
      ["openclaw", ["config", "get", "agents.defaults.workspace"]],
      CAPABILITY_PROBE,
      CONFIG_FILE_PROBE,
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
      VERSION_PROBE,
      ["openclaw", ["config", "get", "agents.defaults.workspace"]],
      CAPABILITY_PROBE,
      CONFIG_FILE_PROBE,
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
      VERSION_PROBE,
      ["openclaw", ["config", "get", "agents.defaults.workspace"]],
      CAPABILITY_PROBE,
      CONFIG_FILE_PROBE,
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
    expect(capture.mock.calls).toEqual([
      ["openclaw", ["config", "get", "agents.defaults.workspace"]],
      CAPABILITY_PROBE,
      CONFIG_FILE_PROBE,
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
