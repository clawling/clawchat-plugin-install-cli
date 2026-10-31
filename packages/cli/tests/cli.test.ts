import { afterEach, describe, expect, it, vi } from "vitest";
import { ClawchatError, installHermesPlugin, markActivationFailure } from "@clawling/clawchat-plugin-install-core";
import { runClawchatCli } from "../src/cli";
import { assertNoSecrets, PLACEHOLDER_SECRETS } from "./helpers/assert-no-secrets";

afterEach(() => {
  vi.unstubAllEnvs();
  vi.useRealTimers();
});

function createIo(stdin = "") {
  let stdout = "";
  let stderr = "";
  return {
    io: {
      readStdin: async () => stdin,
      writeStdout: (value: string) => {
        stdout += value;
      },
      writeStderr: (value: string) => {
        stderr += value;
      },
    },
    get stdout() {
      return stdout;
    },
    get stderr() {
      return stderr;
    },
  };
}

describe("runClawchatCli help", () => {
  it("returns success for --help", async () => {
    const io = createIo();

    const code = await runClawchatCli(["--help"], { ...io.io });

    expect(code).toBe(0);
    expect(io.stderr).toBe("");
  });
});

describe.each(["install", "update"] as const)("runClawchatCli %s install timeout", (command) => {
  it("passes the flag as milliseconds, overriding the environment", async () => {
    vi.stubEnv("CLAWCHAT_INSTALL_TIMEOUT_SECONDS", "invalid");
    const io = createIo();
    const action = vi.fn(async () => ({ kind: "plugin" as const, target: "hermes" as const, status: "installed" as const }));

    const code = await runClawchatCli([command, "--target", "hermes", "--install-timeout", "240"], {
      ...io.io,
      installHermesPlugin: action,
      updateHermesPlugin: action,
    });

    expect(code).toBe(0);
    expect(io.stderr).toBe("");
    expect(action).toHaveBeenCalledWith(expect.objectContaining({ installTimeoutMs: 240_000 }));
  });

  it.each(["invalid", "0", "-1", "1.5", "NaN", "Infinity", "3601"])("rejects invalid seconds %s before invoking the installer", async (seconds) => {
    const io = createIo();
    const action = vi.fn(async () => ({ kind: "plugin" as const, target: "hermes" as const, status: "installed" as const }));

    const code = await runClawchatCli([command, "--target", "hermes", `--install-timeout=${seconds}`], {
      ...io.io,
      installHermesPlugin: action,
      updateHermesPlugin: action,
    });

    expect(code).toBe(1);
    expect(action).not.toHaveBeenCalled();
    expect(io.stderr).toContain(seconds);
    expect(io.stderr).toContain("--install-timeout");
    expect(io.stderr).toContain("integer from 1 to 3600 seconds");
  });

  it("accepts the flag for OpenClaw without applying Hermes environment validation", async () => {
    vi.stubEnv("CLAWCHAT_INSTALL_TIMEOUT_SECONDS", "invalid");
    const io = createIo();
    const action = vi.fn(async () => ({ kind: "plugin" as const, target: "openclaw" as const, status: "installed" as const }));

    const code = await runClawchatCli([command, "--target", "openclaw", "--install-timeout", "240"], {
      ...io.io,
      installOpenClawPlugin: action,
      updateOpenClawPlugin: action,
    });

    expect(code).toBe(0);
    expect(action).toHaveBeenCalledOnce();
  });
});

describe("runClawchatCli install/update", () => {
  it("installs OpenClaw plugin only and prints a plugin summary", async () => {
    const io = createIo();
    const installOpenClawPlugin = vi.fn(async () => ({
      kind: "plugin" as const,
      target: "openclaw" as const,
      status: "installed" as const,
      version: "0.1.3",
      previousVersion: null,
    }));

    const code = await runClawchatCli(["install", "--target", "openclaw"], {
      ...io.io,
      installOpenClawPlugin,
    });

    expect(code).toBe(0);
    expect(installOpenClawPlugin).toHaveBeenCalledTimes(1);
    expect(io.stdout).toContain("ClawChat install for openclaw complete");
    expect(io.stdout).toContain("plugin installed 0.1.3");
    expect(io.stdout).not.toContain("skill ");
  });

  it("updates Hermes plugin only and prints skipped plugin status", async () => {
    const io = createIo();
    const updateHermesPlugin = vi.fn(async () => ({
      kind: "plugin" as const,
      target: "hermes" as const,
      status: "skipped" as const,
      version: "0.1.3",
      previousVersion: "0.1.3",
    }));

    const code = await runClawchatCli(["update", "--target", "hermes"], {
      ...io.io,
      updateHermesPlugin,
    });

    expect(code).toBe(0);
    expect(updateHermesPlugin).toHaveBeenCalledTimes(1);
    expect(io.stdout).toContain("ClawChat update for hermes complete");
    expect(io.stdout).toContain("plugin skipped 0.1.3");
    expect(io.stdout).not.toContain("skill ");
  });

  it("forwards force only to install plugin actions", async () => {
    const io = createIo();
    const installOpenClawPlugin = vi.fn(async () => ({
      kind: "plugin" as const,
      target: "openclaw" as const,
      status: "updated" as const,
      version: "0.1.3",
      previousVersion: "0.1.3",
    }));

    const code = await runClawchatCli(["install", "--target", "openclaw", "--force"], {
      ...io.io,
      installOpenClawPlugin,
    });

    expect(code).toBe(0);
    expect(installOpenClawPlugin).toHaveBeenCalledWith(expect.objectContaining({ force: true }));
  });

  it("forwards force only to update plugin actions", async () => {
    const io = createIo();
    const updateHermesPlugin = vi.fn(async () => ({
      kind: "plugin" as const,
      target: "hermes" as const,
      status: "updated" as const,
      version: "0.1.3",
      previousVersion: "0.1.3",
    }));

    const code = await runClawchatCli(["update", "--target", "hermes", "--force"], {
      ...io.io,
      updateHermesPlugin,
    });

    expect(code).toBe(0);
    expect(updateHermesPlugin).toHaveBeenCalledWith(expect.objectContaining({ force: true }));
  });

  it("fails with the plugin error when plugin install fails", async () => {
    const io = createIo();

    const code = await runClawchatCli(["install", "--target", "hermes"], {
      ...io.io,
      installHermesPlugin: async () => {
        throw new Error("plugin failed");
      },
    });

    expect(code).toBe(1);
    expect(io.stderr).toContain("plugin failed");
  });

  it("does not run removed call command", async () => {
    const io = createIo();
    const callMethod = vi.fn(async () => ({ ok: true }));

    const code = await runClawchatCli(
      ["call", "get_user_profile", "--target", "openclaw", "--input", "{}"],
      {
        ...io.io,
        callMethod,
        resolveAuth: () => ({ target: "openclaw", token: "access-token" }),
      } as any,
    );

    expect(code).toBe(1);
    expect(callMethod).not.toHaveBeenCalled();
  });

  it("does not run removed skill command", async () => {
    const io = createIo();

    const code = await runClawchatCli(["skill", "install", "--target", "openclaw"], {
      ...io.io,
    });

    expect(code).toBe(1);
  });

  it("normalizes base-url flags and threads ref to the openclaw installer", async () => {
    const io = createIo();
    const installOpenClawPlugin = vi.fn(async () => ({
      kind: "plugin" as const,
      target: "openclaw" as const,
      status: "installed" as const,
      version: "0.1.3",
      previousVersion: null,
    }));

    const code = await runClawchatCli(
      [
        "install",
        "--target",
        "openclaw@dev",
        "--apibaseurl",
        "example.test:39001",
        "--wsbaseurl",
        "example.test:39002",
        "--mediabaseurl",
        "example.test:39003",
      ],
      { ...io.io, installOpenClawPlugin },
    );

    expect(code).toBe(0);
    expect(installOpenClawPlugin).toHaveBeenCalledWith(
      expect.objectContaining({
        ref: "dev",
        apiBaseUrl: "https://example.test:39001",
        wsBaseUrl: "wss://example.test:39002/ws",
        mediaBaseUrl: "https://example.test:39003",
      }),
    );
  });

  it("forwards --profile to the Hermes installer", async () => {
    const io = createIo();
    const installHermesPlugin = vi.fn(async () => ({
      kind: "plugin" as const,
      target: "hermes" as const,
      status: "installed" as const,
      version: "1.0.0",
      previousVersion: null,
    }));

    const code = await runClawchatCli(
      ["install", "--target", "hermes", "--profile", "coder"],
      { ...io.io, installHermesPlugin },
    );

    expect(code).toBe(0);
    expect(installHermesPlugin).toHaveBeenCalledTimes(1);
    expect(installHermesPlugin).toHaveBeenCalledWith(expect.objectContaining({ profile: "coder" }));
  });
});

describe("runClawchatCli progress reports", () => {
  it.each([
    ["install", "openclaw"], ["update", "openclaw"],
    ["install", "hermes"], ["update", "hermes"],
  ] as const)("reports a successful %s for %s without activation after its summary", async (command, target) => {
    const io = createIo();
    const action = async () => ({ kind: "plugin" as const, target, status: "installed" as const });
    expect(await runClawchatCli([command, "--target", target], {
      ...io.io,
      installOpenClawPlugin: action, updateOpenClawPlugin: action,
      installHermesPlugin: action, updateHermesPlugin: action,
    })).toBe(0);
    expect(io.stdout).toBe(`ClawChat ${command} for ${target} complete\nplugin installed\nCLAWCHAT_REPORT: plugin_installed\n`);
    expect(io.stderr).toBe("");
  });

  it.each(["install", "update"] as const)("reports Hermes %s and activation followed by awaiting restart without claiming enablement", async (command) => {
    const io = createIo();
    const action = async () => ({ kind: "plugin" as const, target: "hermes" as const, status: "installed" as const, activated: true });
    const args = [command, "--target", "hermes"];
    if (command === "install") args.push("--activate", "PLACEHOLDER_CODE");
    expect(await runClawchatCli(args, {
      ...io.io, installHermesPlugin: action, updateHermesPlugin: action,
    })).toBe(0);
    expect(io.stdout).toBe(`ClawChat ${command} for hermes complete\nplugin installed + activated\nCLAWCHAT_REPORT: plugin_installed\nCLAWCHAT_REPORT: plugin_activated\nCLAWCHAT_REPORT: plugin_awaiting_restart\n`);
    expect(io.stderr).toBe("");
  });

  it.each(["install", "update"] as const)("does not report awaiting restart after OpenClaw %s activation", async (command) => {
    const io = createIo();
    const action = async () => ({ kind: "plugin" as const, target: "openclaw" as const, status: "installed" as const, activated: true });
    expect(await runClawchatCli([command, "--target", "openclaw"], {
      ...io.io, installOpenClawPlugin: action, updateOpenClawPlugin: action,
    })).toBe(0);
    expect(io.stdout).toBe(`ClawChat ${command} for openclaw complete\nplugin installed + activated\nCLAWCHAT_REPORT: plugin_installed\nCLAWCHAT_REPORT: plugin_activated\n`);
    expect(io.stdout).not.toContain("CLAWCHAT_REPORT: plugin_awaiting_restart");
    expect(io.stderr).toBe("");
  });

  describe.each(["install", "update"] as const)("%s failures", (command) => {
    it.each([
      [new ClawchatError("SCAN_BLOCKED", "scan refused"), "scan_blocked"],
      [new ClawchatError("SUBPROCESS", "hermes failed: spawnSync hermes ENOENT"), "host_missing"],
      [new ClawchatError("PRECONDITION", "Hermes is too old"), "host_too_old"],
      [new ClawchatError("PRERELEASE_REFUSED", "OpenClaw refused a prerelease"), "prerelease_refused"],
      [new ClawchatError("LEGACY_CONFIG", "OpenClaw refused legacy config keys"), "legacy_config"],
      [new ClawchatError("HTTP_ERROR", "HTTP failed"), "network"],
      [new ClawchatError("METADATA", "metadata failed"), "other"],
      [new ClawchatError("PRECONDITION", "metadata returned 404"), "other"],
      [new ClawchatError("TIMEOUT", "install timed out"), "timeout"],
      [new ClawchatError("SUBPROCESS", "plugin already exists"), "already_exists"],
      [new ClawchatError("SUBPROCESS", "host exit 1"), "host_error"],
      [new ClawchatError("VALIDATION", "invalid argument"), "bad_input"],
      [new ClawchatError("INVALID_INPUT", "invalid target"), "bad_input"],
      [new Error("plugin failed"), "other"],
    ])("reports %s as %s while preserving the original error text", async (err, category) => {
      const io = createIo();
      const action = async () => { throw err; };
      expect(await runClawchatCli([command, "--target", "hermes"], {
        ...io.io, installHermesPlugin: action, updateHermesPlugin: action,
      })).toBe(1);
      expect(io.stderr).toBe(`${err.message}\nCLAWCHAT_REPORT: plugin_install_failed:${category}\n`);
      expect(io.stdout).toBe("");
    });
  });

  it("reports completed installation before an activation-stage failure", async () => {
    const io = createIo();
    const err = new ClawchatError("SUBPROCESS", "this Hermes profile is already paired");
    expect(await runClawchatCli(["install", "--target", "hermes", "--activate", "PLACEHOLDER_CODE"], {
      ...io.io, installHermesPlugin: async () => { throw markActivationFailure(err); },
    })).toBe(1);
    expect(io.stdout).toBe("CLAWCHAT_REPORT: plugin_installed\n");
    expect(io.stderr).toBe(`${err.message}\nCLAWCHAT_REPORT: plugin_activate_failed:already_paired\n`);
    expect(err.code).toBe("SUBPROCESS");
  });

  it.each([false, true])("keeps placeholder secrets and paths out of failure reports (activation: %s)", async (activation) => {
    const io = createIo();
    const err = new ClawchatError("SUBPROCESS", `failed ${Object.values(PLACEHOLDER_SECRETS).join(" ")} /home/someone/x`);
    expect(await runClawchatCli(["install", "--target", "hermes"], {
      ...io.io,
      installHermesPlugin: async () => { throw activation ? markActivationFailure(err) : err; },
    })).toBe(1);
    const reports = `${io.stdout}${io.stderr}`.split("\n").filter((line) => line.startsWith("CLAWCHAT_REPORT: "));
    expect(reports).toContain(`CLAWCHAT_REPORT: plugin_${activation ? "activate" : "install"}_failed:${activation ? "other" : "host_error"}`);
    for (const report of reports) {
      assertNoSecrets({ report });
      expect(report).not.toContain("/home/someone/x");
    }
    expect(io.stderr.startsWith(`${err.message}\n`)).toBe(true);
  });

  it.each([
    ["--help"], ["install", "--help"], [], ["unknown"], ["install", "--unknown"], ["install", "--target"],
  ])("prints no report before an install action runs (%j)", async (...args) => {
    const io = createIo();
    const action = vi.fn();
    await runClawchatCli(args, { ...io.io, installOpenClawPlugin: action, installHermesPlugin: action });
    expect(action).not.toHaveBeenCalled();
    expect(`${io.stdout}${io.stderr}`).not.toContain("CLAWCHAT_REPORT:");
  });
});

describe("Hermes metadata reports through the CLI", () => {
  it.each([false, true])("reports real metadata fallback success or fail-closed metadata failure (installed: %s)", async (installed) => {
    vi.useFakeTimers();
    const io = createIo();
    const run = vi.fn(async () => undefined);
    const fetchFn = vi.fn(async () => { throw new DOMException("timeout", "TimeoutError"); });
    const capture = vi.fn(async (_cmd: string, args: readonly string[]) => args[0] === "--version"
      ? "Hermes v0.22.5"
      : installed ? "│ clawchat │ enabled │ 0.1.1 │ ClawChat │ git │" : "");
    const pending = runClawchatCli(["install", "--target", "hermes"], {
      ...io.io,
      installHermesPlugin: (options) => installHermesPlugin({ ...options, run, capture, fetchFn, writeBaseUrls: () => undefined }),
    });
    await vi.runAllTimersAsync();
    expect(await pending).toBe(installed ? 1 : 0);
    expect(fetchFn).toHaveBeenCalledTimes(3);
    if (installed) {
      expect(io.stderr).toContain("CLAWCHAT_REPORT: plugin_install_failed:metadata\n");
      expect(io.stderr).toContain("timed out after 20000ms");
      expect(io.stdout).not.toContain("CLAWCHAT_REPORT: plugin_installed");
      expect(run).not.toHaveBeenCalled();
    } else {
      expect(io.stdout).toContain("falling back to hermes plugins install");
      expect(io.stdout).toContain("fallback host install");
      expect(io.stdout).toContain("CLAWCHAT_REPORT: plugin_installed\n");
      expect(io.stderr).toBe("");
      expect(run).toHaveBeenCalledWith("hermes", ["plugins", "install", "clawling/clawchat-plugin-hermes-agent", "--enable"], expect.anything());
    }
  });
});
