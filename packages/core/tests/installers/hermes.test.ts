import fs from "node:fs";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { HERMES_PLUGIN_NAME, HERMES_PLUGIN_SPEC, HERMES_PLUGIN_YAML_URL } from "../../src/config";
import { ClawchatError } from "../../src/errors";
import { classifyInstallFailure, isActivationFailure } from "../../src/progress-report";
import { assertHermesHostSupported, installHermesPlugin, isHermesScanRefusal, resolveHermesInstallTimeoutMs, updateHermesPlugin } from "../../src/installers/hermes";

const HERMES_CLONE_URL = "https://github.com/clawling/clawchat-plugin-hermes-agent.git";

function pluginYaml(version = "0.1.1", requirement = ">=0.12.0") {
  return `manifest_version: 1\nname: clawchat\nkind: platform\nversion: ${version}\nrequires:\n  hermes: "${requirement}"\n`;
}

function hermesList(version: string | null, status = "enabled") {
  return version ? `│ clawchat       │ ${status.padEnd(11)} │ ${version.padEnd(7)} │ ClawChat gateway integration for Hermes Agent. │ git     │` : "";
}

/**
 * plugin.yaml is read over HTTP (Node `fetch`), not by shelling out to curl, so
 * the metadata seam is the global fetch rather than the command capturer.
 */
let fetchMock: ReturnType<typeof vi.fn>;

/**
 * Proxy env vars select the curl transport, and a developer machine or CI image
 * may well have them set — without this the suite silently exercises a
 * different code path there than it does on a clean host.
 */
const PROXY_ENV_VARS = ["HTTPS_PROXY", "https_proxy", "HTTP_PROXY", "http_proxy", "ALL_PROXY", "all_proxy"];

beforeEach(() => {
  for (const name of PROXY_ENV_VARS) vi.stubEnv(name, undefined as unknown as string);
  vi.stubEnv("CLAWCHAT_INSTALL_TIMEOUT_SECONDS", undefined as unknown as string);
  fetchMock = vi.fn(async () => new Response(pluginYaml()));
  vi.stubGlobal("fetch", fetchMock);
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

function createCapture(installedVersion: string | null, hostVersion = "Hermes Agent v0.12.0\n", status = "enabled") {
  return vi.fn(async (cmd: string, args: readonly string[]) => {
    if (cmd === "hermes" && args[0] === "--version") {
      return hostVersion;
    }
    if (cmd === "hermes" && args.join(" ") === "plugins list") {
      return hermesList(installedVersion, status);
    }
    if (cmd === "hermes" && args.join(" ") === `plugins update ${HERMES_PLUGIN_NAME}`) {
      return "Plugin clawchat updated.\n";
    }
    throw new Error(`unexpected capture: ${cmd} ${args.join(" ")}`);
  });
}

interface MockLike {
  mock: { calls: any[] };
}

/** Calls reduced to `[cmd, args]`, dropping the trailing CommandOptions arg. */
function headCalls(fn: MockLike): Array<[string, readonly string[]]> {
  return fn.mock.calls.map((c) => [c[0], c[1]] as [string, readonly string[]]);
}

function cloneCall(run: MockLike): readonly string[] | undefined {
  const call = run.mock.calls.find((c) => c[0] === "git");
  return call?.[1];
}

function installCall(run: MockLike): readonly string[] | undefined {
  const call = run.mock.calls.find((c) => c[0] === "hermes" && c[1][0] === "plugins" && c[1][1] === "install");
  return call?.[1];
}

/**
 * The first host install call must never carry the host's --force: that flag
 * also accepts a "caution" security-scan verdict, so passing it up front would
 * skip the scan (see installViaHost in hermes.ts).
 */
function expectLocalClone(run: MockLike, opts: { branch: string }) {
  const git = cloneCall(run);
  expect(git, "expected a git clone call").toBeTruthy();
  expect(git!).toEqual(expect.arrayContaining(["clone", "--depth", "1", "--single-branch", "--branch", opts.branch]));
  expect(git!).toContain(HERMES_CLONE_URL);

  const install = installCall(run);
  expect(install, "expected a hermes plugins install call").toBeTruthy();
  expect(install![2]).toMatch(/^file:\/\/.+\/plugin$/);
  expect(install!).toContain("--enable");
  expect(install!).not.toContain("--force");
}

/**
 * Canonical (non-ref) install goes directly to the host: `hermes plugins install
 * <owner/repo>` with no CLI-side git clone. file:// is reserved for the debug/ref
 * path.
 */
function expectRemoteInstall(run: MockLike) {
  expect(cloneCall(run), "canonical install must not git clone").toBeUndefined();

  const install = installCall(run);
  expect(install, "expected a hermes plugins install call").toBeTruthy();
  expect(install![2]).toBe(HERMES_PLUGIN_SPEC);
  expect(install!).toContain("--enable");
  expect(install!).not.toContain("--force");
}

describe("Hermes install timeout resolution", () => {
  it("defaults to exactly 120_000 milliseconds", () => {
    expect(resolveHermesInstallTimeoutMs(undefined, {})).toBe(120_000);
  });

  it("uses the environment when no explicit option is supplied", () => {
    expect(resolveHermesInstallTimeoutMs(undefined, { CLAWCHAT_INSTALL_TIMEOUT_SECONDS: "240" })).toBe(240_000);
  });

  it("prefers the explicit option even when the environment is invalid", () => {
    expect(resolveHermesInstallTimeoutMs(180_000, { CLAWCHAT_INSTALL_TIMEOUT_SECONDS: "invalid" })).toBe(180_000);
  });

  it.each([1, 3_600_000])("accepts the millisecond boundary %s", (optionMs) => {
    expect(resolveHermesInstallTimeoutMs(optionMs, {})).toBe(optionMs);
  });

  it.each(["1", "3600"])("accepts the seconds boundary %s", (seconds) => {
    expect(resolveHermesInstallTimeoutMs(undefined, { CLAWCHAT_INSTALL_TIMEOUT_SECONDS: seconds })).toBe(Number(seconds) * 1000);
  });

  it.each([0, -1, 1.5, NaN, Infinity, -Infinity, 3_600_001])("rejects invalid explicit milliseconds %s", (optionMs) => {
    expect(() => resolveHermesInstallTimeoutMs(optionMs, { CLAWCHAT_INSTALL_TIMEOUT_SECONDS: "120" })).toThrowError(
      new ClawchatError("VALIDATION", `Invalid installTimeoutMs ${String(optionMs)}: expected an integer from 1 to 3600000 milliseconds.`),
    );
  });

  it.each(["", " ", "0", "-1", "1.5", "NaN", "Infinity", "-Infinity", "3601", "invalid", "120seconds"])(
    "rejects invalid environment seconds %j instead of falling back",
    (seconds) => {
      expect(() => resolveHermesInstallTimeoutMs(undefined, { CLAWCHAT_INSTALL_TIMEOUT_SECONDS: seconds })).toThrowError(
        new ClawchatError("VALIDATION", `Invalid Hermes install timeout ${JSON.stringify(seconds)}: --install-timeout / CLAWCHAT_INSTALL_TIMEOUT_SECONDS must be an integer from 1 to 3600 seconds.`),
      );
    },
  );
});

describe.each([
  ["install", installHermesPlugin],
  ["update", updateHermesPlugin],
] as const)("Hermes %s timeout", (_action, install) => {
  it.each([
    { optionMs: undefined, envSeconds: undefined, expectedMs: 120_000 },
    { optionMs: undefined, envSeconds: "240", expectedMs: 240_000 },
    { optionMs: 180_000, envSeconds: "240", expectedMs: 180_000 },
  ])("uses $expectedMs ms for the canonical remote install", async ({ optionMs, envSeconds, expectedMs }) => {
    vi.stubEnv("CLAWCHAT_INSTALL_TIMEOUT_SECONDS", envSeconds as string);
    const progress = vi.fn();
    const run = vi.fn(async () => {
      expect(progress).toHaveBeenLastCalledWith(`installing plugin from remote ${HERMES_PLUGIN_SPEC} (time limit ${expectedMs / 1000}s)`);
    });

    await install({ run, capture: createCapture(null), force: true, installTimeoutMs: optionMs, onProgress: progress });

    expect(run).toHaveBeenCalledWith("hermes", ["plugins", "install", HERMES_PLUGIN_SPEC, "--enable"], {
      timeoutMs: expectedMs,
      timeoutHint: "If the network is slow, re-run with --install-timeout <larger seconds> or set CLAWCHAT_INSTALL_TIMEOUT_SECONDS.",
      collectStdout: true,
    });
  });

  it("rejects invalid configuration before writing settings or contacting the host", async () => {
    vi.stubEnv("CLAWCHAT_INSTALL_TIMEOUT_SECONDS", "invalid");
    const run = vi.fn(async () => undefined);
    const capture = createCapture(null);
    const writeBaseUrls = vi.fn();

    await expect(install({ run, capture, writeBaseUrls })).rejects.toMatchObject({ code: "VALIDATION" });

    expect(writeBaseUrls).not.toHaveBeenCalled();
    expect(fetchMock).not.toHaveBeenCalled();
    expect(capture).not.toHaveBeenCalled();
    expect(run).not.toHaveBeenCalled();
  });
});

describe("Hermes installer", () => {
  it.each(["0.20.2", "0.21.0"])("supports Hermes %s outside the excluded scan releases", async (version) => {
    expect(() => assertHermesHostSupported(version)).not.toThrow();
    const run = vi.fn(async () => undefined);
    await expect(installHermesPlugin({ run, capture: createCapture(null, `Hermes Agent v${version}\n`) }))
      .resolves.toMatchObject({ status: "installed" });
    expectRemoteInstall(run);
  });

  it("installs canonically from the remote spec when plugin is missing", async () => {
    const run = vi.fn(async () => undefined);
    const capture = createCapture(null);

    await expect(installHermesPlugin({ run, capture })).resolves.toMatchObject({
      kind: "plugin",
      target: "hermes",
      status: "installed",
      version: "0.1.1",
      previousVersion: null,
    });

    expect(fetchMock).toHaveBeenCalledWith(HERMES_PLUGIN_YAML_URL, expect.anything());
    expect(capture.mock.calls.some((c) => c[0] === "curl")).toBe(false);
    expectRemoteInstall(run);
  });

  it("falls back to curl when a proxy is configured, which fetch would ignore", async () => {
    // undici does not read http_proxy/HTTPS_PROXY. On a locked-down network
    // that is not a missing optimisation — it is a lost route, and the install
    // fails where curl would have succeeded.
    const run = vi.fn(async () => undefined);
    const capture = vi.fn(async (cmd: string, args: readonly string[]) => {
      if (cmd === "curl") return pluginYaml();
      if (cmd === "hermes" && args[0] === "--version") return "Hermes Agent v0.12.0\n";
      if (cmd === "hermes" && args.join(" ") === "plugins list") return "";
      throw new Error(`unexpected capture: ${cmd} ${args.join(" ")}`);
    });

    vi.stubEnv("HTTPS_PROXY", "http://localhost:3128");
    try {
      await expect(installHermesPlugin({ run, capture })).resolves.toMatchObject({ status: "installed" });
    } finally {
      vi.unstubAllEnvs();
    }

    expect(capture.mock.calls.some((c) => c[0] === "curl" && c[1].includes(HERMES_PLUGIN_YAML_URL))).toBe(true);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("still activates after a skipped canonical install when --activate is given", async () => {
    const run = vi.fn(async () => undefined);
    const capture = createCapture("0.1.1"); // already current + enabled → install skipped

    const result = await installHermesPlugin({ run, capture, activateCode: "PLACEHOLDER-ACTIVATE-CODE-0000" });

    expect(result).toMatchObject({ status: "skipped", activated: true });
    // No install/clone work, but activation still runs.
    expect(headCalls(run)).toEqual([["hermes", ["clawchat", "activate", "PLACEHOLDER-ACTIVATE-CODE-0000"]]]);
    expect(run).toHaveBeenCalledWith("hermes", ["clawchat", "activate", "PLACEHOLDER-ACTIVATE-CODE-0000"],
      expect.objectContaining({ secretArgs: [2] }));
  });

  it("skips install and enable when current plugin is already enabled", async () => {
    const run = vi.fn(async () => undefined);
    const capture = createCapture("0.1.1");
    const progress: string[] = [];

    await expect(installHermesPlugin({
      run,
      capture,
      onProgress: (message) => progress.push(message),
    })).resolves.toMatchObject({
      status: "skipped",
      version: "0.1.1",
      previousVersion: "0.1.1",
    });

    expect(run).not.toHaveBeenCalled();
    expect(progress).toEqual([
      "Checking Hermes plugin metadata...",
      "Downloaded Hermes plugin metadata 0.1.1",
      "Checking Hermes version...",
      "Hermes version ok 0.12.0",
      "Checking installed Hermes plugin...",
      "plugin skipped 0.1.1",
    ]);
  });

  it("skips install and enable when installed plugin is newer", async () => {
    const run = vi.fn(async () => undefined);
    const capture = createCapture("0.1.2");

    await expect(installHermesPlugin({ run, capture })).resolves.toMatchObject({
      status: "skipped",
      version: "0.1.2",
      previousVersion: "0.1.2",
    });

    expect(run).not.toHaveBeenCalled();
  });

  it("enables current plugin when it is installed but disabled", async () => {
    const run = vi.fn(async () => undefined);
    const capture = createCapture("0.1.1", "Hermes Agent v0.12.0\n", "not enabled");

    await expect(installHermesPlugin({ run, capture })).resolves.toMatchObject({
      status: "updated",
      version: "0.1.1",
      previousVersion: "0.1.1",
      detail: "enabled existing plugin",
    });

    expect(headCalls(run)).toEqual([
      ["hermes", ["plugins", "enable", HERMES_PLUGIN_NAME]],
    ]);
  });

  it("force installs from the remote spec when installed Hermes plugin is current", async () => {
    const run = vi.fn(async () => undefined);
    const capture = createCapture("0.1.1");

    await expect(installHermesPlugin({ run, capture, force: true })).resolves.toMatchObject({
      status: "updated",
      version: "0.1.1",
      previousVersion: "0.1.1",
    });

    expectRemoteInstall(run);
  });

  it("force installs from the remote spec when Hermes plugin is missing", async () => {
    const run = vi.fn(async () => undefined);
    const capture = createCapture(null);

    await expect(installHermesPlugin({ run, capture, force: true })).resolves.toMatchObject({
      status: "installed",
      version: "0.1.1",
      previousVersion: null,
    });

    expectRemoteInstall(run);
  });

  it("updates and enables during install when installed plugin is stale", async () => {
    const run = vi.fn(async () => undefined);
    const capture = createCapture("0.1.0");

    await expect(installHermesPlugin({ run, capture })).resolves.toMatchObject({
      status: "updated",
      version: "0.1.1",
      previousVersion: "0.1.0",
    });

    expect(headCalls(capture)).toContainEqual(["hermes", ["plugins", "update", HERMES_PLUGIN_NAME]]);
    expect(headCalls(run)).toEqual([
      ["hermes", ["plugins", "enable", HERMES_PLUGIN_NAME]],
    ]);
  });

  it("updates and enables during update even when installed plugin is current", async () => {
    const run = vi.fn(async () => undefined);
    const capture = createCapture("0.1.1");

    await expect(updateHermesPlugin({ run, capture })).resolves.toMatchObject({
      status: "updated",
      version: "0.1.1",
      previousVersion: "0.1.1",
    });

    expect(headCalls(capture)).toContainEqual(["hermes", ["plugins", "update", HERMES_PLUGIN_NAME]]);
    expect(headCalls(run)).toEqual([
      ["hermes", ["plugins", "enable", HERMES_PLUGIN_NAME]],
    ]);
  });

  it("fails update when Hermes plugin is missing", async () => {
    const run = vi.fn(async () => undefined);
    const capture = createCapture(null);

    await expect(updateHermesPlugin({ run, capture })).rejects.toThrow(
      "npx -y @clawling/clawchat-plugin-install-cli@latest install --target hermes",
    );

    expect(run).not.toHaveBeenCalled();
  });

  it("does not fallback to force reinstall when update is blocked by untracked files", async () => {
    const run = vi.fn(async () => undefined);
    const baseCapture = createCapture("0.1.0");
    const capture = vi.fn(async (cmd: string, args: readonly string[]) => {
      if (args.join(" ") === `plugins update ${HERMES_PLUGIN_NAME}`) {
        throw new Error(
          "hermes plugins update clawchat failed with exit code 1: error: The following untracked working tree files would be overwritten by merge",
        );
      }
      return baseCapture(cmd, args);
    });

    await expect(updateHermesPlugin({ run, capture })).rejects.toThrow("update --target hermes --force");

    expect(run).not.toHaveBeenCalled();
  });

  it("force reinstalls from the remote spec when installed Hermes plugin is stale", async () => {
    const run = vi.fn(async () => undefined);
    const capture = createCapture("0.1.0");

    await expect(updateHermesPlugin({ run, capture, force: true })).resolves.toMatchObject({
      status: "updated",
      version: "0.1.1",
      previousVersion: "0.1.0",
    });

    expectRemoteInstall(run);
  });

  it("stops before installing when Hermes is too old", async () => {
    const run = vi.fn(async () => undefined);
    const capture = createCapture(null, "Hermes Agent v0.11.9\n");

    await expect(installHermesPlugin({ run, capture })).rejects.toThrow("Hermes version 0.11.9 is too old; need >=0.12.0");

    expect(run).not.toHaveBeenCalled();
  });

  it("force still stops before installing when Hermes is too old", async () => {
    const run = vi.fn(async () => undefined);
    const capture = createCapture("0.1.1", "Hermes Agent v0.11.9\n");

    await expect(updateHermesPlugin({ run, capture, force: true })).rejects.toThrow("Hermes version 0.11.9 is too old; need >=0.12.0");

    expect(run).not.toHaveBeenCalled();
  });

});

describe.each([
  ["install", installHermesPlugin],
  ["update", updateHermesPlugin],
] as const)("Hermes %s host scan compatibility", (_action, action) => {
  it.each(["0.20.3 (2026.8.16.2)", "0.20.4", "0.20.5", "0.20.6"].flatMap(
    (version) => [false, true].map((force) => ({ version, force })),
  ))(
    "refuses excluded Hermes $version before listing or installing (force=$force)",
    async ({ version, force }) => {
      const run = vi.fn(async () => undefined);
      const capture = createCapture("0.1.0", `Hermes Agent v${version}\n`);
      const err = await action({ run, capture, force }).catch((err: unknown) => err);

      expect(err).toBeInstanceOf(ClawchatError);
      expect(err).toMatchObject({ code: "PRECONDITION", message: expect.stringContaining("too old") });
      expect((err as Error).message).toContain("v0.21.6");
      expect((err as Error).message).toContain("hermes update");
      expect(classifyInstallFailure(err)).toBe("host_too_old");
      expect(headCalls(capture)).toEqual([["hermes", ["--version"]]]);
      expect(run).not.toHaveBeenCalled();
    },
  );
});

const REF = "https://github.com/clawling/clawchat-plugin-hermes-agent.git#dev";
const REF_YAML = "version: 0.14.0-22\nrequires:\n  hermes: \">=0.12.0\"\n";

/**
 * A `run()` mock that materializes `plugin.yaml` into the clone destination,
 * exactly as a real `git clone` would. `yaml: null` simulates a checkout whose
 * `plugin.yaml` is absent. The dest is always the final clone argument.
 */
function runThatClones(yaml: string | null = REF_YAML) {
  return vi.fn(async (cmd: string, args: readonly string[]) => {
    if (cmd === "git" && args.includes("clone")) {
      const dest = args[args.length - 1]!;
      if (yaml !== null) {
        fs.mkdirSync(dest, { recursive: true });
        fs.writeFileSync(path.join(dest, "plugin.yaml"), yaml);
      }
    }
    return undefined;
  });
}

/** Capture mock for the ref path: only `hermes --version` is ever read. */
function captureVersionOnly(hostVersion = "hermes 0.12.0\n") {
  return vi.fn(async (cmd: string, args: readonly string[]) => {
    if (cmd === "hermes" && args[0] === "--version") return hostVersion;
    throw new Error(`unexpected capture: ${cmd} ${args.join(" ")}`);
  });
}

describe("Hermes installer with @ref", () => {
  it.each([installHermesPlugin, updateHermesPlugin])("refuses excluded hosts before cloning a ref (%s)", async (action) => {
    const run = runThatClones(null);
    const capture = captureVersionOnly("Hermes Agent v0.20.3 (2026.8.16.2)\n");
    const err = await action({ run, capture, writeBaseUrls: vi.fn(), ref: REF }).catch((err: unknown) => err);

    expect(err).toMatchObject({ code: "PRECONDITION", message: expect.stringContaining("too old") });
    expect((err as Error).message).toContain("v0.21.6");
    expect(classifyInstallFailure(err)).toBe("host_too_old");
    expect(capture).toHaveBeenCalledTimes(1);
    expect(run).not.toHaveBeenCalled();
  });

  it("clones the requested branch and reads plugin.yaml from the checkout (no metadata fetch)", async () => {
    const run = runThatClones();
    const capture = captureVersionOnly();

    const result = await installHermesPlugin({ run, capture, writeBaseUrls: vi.fn(), ref: REF });

    expect(result).toMatchObject({ kind: "plugin", target: "hermes", status: "installed", version: "0.14.0-22" });
    expectLocalClone(run, { branch: "dev" });
    expect(capture).toHaveBeenCalledTimes(1);
    // The redundant raw.githubusercontent.com read is gone — version comes from the clone.
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("runs `hermes clawchat activate` right after a ref install when --activate is given", async () => {
    const run = runThatClones();
    const capture = captureVersionOnly();

    const result = await installHermesPlugin({ run, capture, writeBaseUrls: vi.fn(), ref: REF, activateCode: "WLLF7S" });

    expect(result).toMatchObject({ status: "installed", version: "0.14.0-22", activated: true });
    // Install happens first, activation last.
    expect(installCall(run)).toBeTruthy();
    const activateCall = run.mock.calls.find((c) => c[0] === "hermes" && c[1][0] === "clawchat");
    expect(activateCall?.[1]).toEqual(["clawchat", "activate", "WLLF7S"]);
  });

  it("does not activate when no code is provided", async () => {
    const run = runThatClones();
    const capture = captureVersionOnly();

    const result = await installHermesPlugin({ run, capture, writeBaseUrls: vi.fn(), ref: REF });

    expect(result.activated).toBeUndefined();
    expect(run.mock.calls.some((c) => c[0] === "hermes" && c[1][0] === "clawchat")).toBe(false);
  });

  it("disables git credential prompts on the ref-path clone", async () => {
    const cloneOptions: any[] = [];
    const run = vi.fn(async (cmd: string, args: readonly string[], options?: unknown) => {
      if (cmd === "git" && args.includes("clone")) {
        cloneOptions.push(options);
        const dest = args[args.length - 1]!;
        fs.mkdirSync(dest, { recursive: true });
        fs.writeFileSync(path.join(dest, "plugin.yaml"), REF_YAML);
      }
      return undefined;
    });

    await installHermesPlugin({ run, capture: captureVersionOnly(), writeBaseUrls: vi.fn(), ref: REF });

    expect(cloneOptions[0]?.env).toMatchObject({ GIT_TERMINAL_PROMPT: "0" });
  });

  it("reports updated status when updating from a git ref", async () => {
    const run = runThatClones();
    const capture = captureVersionOnly();

    const result = await updateHermesPlugin({ run, capture, writeBaseUrls: vi.fn(), ref: REF });

    expect(result).toMatchObject({ kind: "plugin", target: "hermes", status: "updated" });
    expectLocalClone(run, { branch: "dev" });
  });

  it("stops before installing from a ref when Hermes is too old", async () => {
    const run = runThatClones();
    const capture = captureVersionOnly("hermes 0.11.0\n");

    await expect(
      installHermesPlugin({ run, capture, writeBaseUrls: vi.fn(), ref: REF }),
    ).rejects.toThrow(/too old/);

    // The clone ran, but the host-compat guard aborted before the install.
    expect(cloneCall(run)).toBeTruthy();
    expect(installCall(run)).toBeUndefined();
  });

  it("still installs from a local checkout when the checkout has no plugin.yaml", async () => {
    const run = runThatClones(null);
    const capture = captureVersionOnly();

    const result = await installHermesPlugin({ run, capture, writeBaseUrls: vi.fn(), ref: REF });

    expect(result.status).toBe("installed");
    expectLocalClone(run, { branch: "dev" });
    expect(capture).toHaveBeenCalledTimes(1);
  });

  it("still installs when the checkout has a malformed plugin.yaml (version check skipped)", async () => {
    // Valid YAML, but no `version` field → parseHermesPluginYaml throws METADATA,
    // which is caught and treated like a missing file: skip the check, install anyway.
    const run = runThatClones("manifest_version: 1\nname: clawchat\n");
    const capture = captureVersionOnly();

    const result = await installHermesPlugin({ run, capture, writeBaseUrls: vi.fn(), ref: REF });

    expect(result.status).toBe("installed");
    expectLocalClone(run, { branch: "dev" });
    expect(capture).toHaveBeenCalledTimes(1);
  });

  it("tolerates unparseable host output before cloning when metadata is absent", async () => {
    const run = runThatClones(null);
    const capture = captureVersionOnly("unparseable host version");

    await expect(installHermesPlugin({ run, capture, writeBaseUrls: vi.fn(), ref: REF }))
      .resolves.toMatchObject({ status: "installed" });
    expectLocalClone(run, { branch: "dev" });
    expect(capture).toHaveBeenCalledTimes(1);
  });

  it("still rejects unparseable host output for the checkout's host requirement", async () => {
    const run = runThatClones();
    const capture = captureVersionOnly("unparseable host version");

    await expect(installHermesPlugin({ run, capture, writeBaseUrls: vi.fn(), ref: REF }))
      .rejects.toMatchObject({ code: "METADATA" });
    expect(cloneCall(run)).toBeTruthy();
    expect(installCall(run)).toBeUndefined();
    expect(capture).toHaveBeenCalledTimes(1);
  });

  it("aborts before cloning when hermes --version fails", async () => {
    const run = runThatClones(); // valid plugin.yaml requiring >=0.12.0
    const capture = vi.fn(async (cmd: string, args: readonly string[]) => {
      if (cmd === "hermes" && args[0] === "--version") {
        throw new ClawchatError("TIMEOUT", "hermes --version timed out after 30000ms");
      }
      throw new Error(`unexpected capture: ${cmd} ${args.join(" ")}`);
    });

    await expect(
      installHermesPlugin({ run, capture, writeBaseUrls: vi.fn(), ref: REF }),
    ).rejects.toThrow(/timed out/);

    expect(run).not.toHaveBeenCalled();
  });

  it("surfaces a deployment hint when config.yaml is a read-only mount (EBUSY)", async () => {
    const run = vi.fn(async (cmd: string, args: readonly string[]) => {
      if (cmd === "git" && args.includes("clone")) {
        const dest = args[args.length - 1]!;
        fs.mkdirSync(dest, { recursive: true });
        fs.writeFileSync(path.join(dest, "plugin.yaml"), REF_YAML);
        return undefined;
      }
      if (cmd === "hermes" && args[0] === "plugins" && args[1] === "install") {
        // What the host raises when `--enable` rewrites a read-only config.yaml.
        throw new ClawchatError(
          "SUBPROCESS",
          "hermes plugins install file://… failed with exit code 1: OSError: [Errno 16] Device or resource busy: '/opt/data/config.yaml'",
        );
      }
      return undefined;
    });
    const capture = captureVersionOnly();

    await expect(
      installHermesPlugin({ run, capture, writeBaseUrls: vi.fn(), ref: REF, activateCode: "ABC123" }),
    ).rejects.toThrow(/config\.yaml is read-only/);
  });

  it("does not retry a deterministic missing-branch clone failure", async () => {
    let gitCalls = 0;
    const run = vi.fn(async (cmd: string) => {
      if (cmd === "git") {
        gitCalls += 1;
        throw new ClawchatError(
          "SUBPROCESS",
          "git clone ... failed with exit code 128: fatal: Remote branch nope not found in upstream origin",
        );
      }
      return undefined;
    });
    const capture = captureVersionOnly();

    await expect(
      installHermesPlugin({
        run,
        capture,
        writeBaseUrls: vi.fn(),
        ref: "https://github.com/clawling/clawchat-plugin-hermes-agent.git#nope",
      }),
    ).rejects.toThrow(/not found in upstream/);
    expect(gitCalls).toBe(1);
  });

  it("cleans a partial checkout left by a failed clone so the retry can succeed", async () => {
    // Reproduces the real cold-network failure: a slow/SIGKILL'd clone leaves a
    // non-empty dest; without cleanup git rejects every retry with "destination
    // path already exists" and the whole install fails.
    let gitCalls = 0;
    const run = vi.fn(async (cmd: string, args: readonly string[]) => {
      if (cmd === "git" && args.includes("clone")) {
        gitCalls += 1;
        const dest = args[args.length - 1]!;
        if (gitCalls === 1) {
          // Leave a partial checkout behind, like a killed clone would.
          fs.mkdirSync(path.join(dest, ".git"), { recursive: true });
          fs.writeFileSync(path.join(dest, ".git", "HEAD"), "ref: refs/heads/dev\n");
          throw new ClawchatError("TIMEOUT", "git clone ... timed out after 15000ms");
        }
        // The retry must start from a clean target, not the leftover dir.
        expect(fs.existsSync(dest)).toBe(false);
        fs.mkdirSync(dest, { recursive: true });
        fs.writeFileSync(path.join(dest, "plugin.yaml"), REF_YAML);
      }
      return undefined;
    });
    const capture = captureVersionOnly();

    await expect(
      installHermesPlugin({ run, capture, writeBaseUrls: vi.fn(), ref: REF }),
    ).resolves.toMatchObject({ status: "installed", version: "0.14.0-22" });
    expect(gitCalls).toBe(2);
  });

  it("hands an unrecognized (non-GitHub) ref straight to the host installer", async () => {
    const run = vi.fn(async () => undefined);
    const capture = captureVersionOnly();

    const result = await installHermesPlugin({
      run,
      capture,
      writeBaseUrls: vi.fn(),
      ref: "git@example.com:weird",
    });

    expect(result.status).toBe("installed");
    expect(headCalls(run)).toEqual([
      ["hermes", ["plugins", "install", "git@example.com:weird", "--enable"]], // redact-allow:email (placeholder SSH git spec)
    ]);
    expect(cloneCall(run)).toBeUndefined();
    expect(capture).toHaveBeenCalledTimes(1);
  });

  it.each([installHermesPlugin, updateHermesPlugin])("refuses excluded hosts before handing a non-GitHub ref to the host (%s)", async (action) => {
    const run = vi.fn(async () => undefined);
    const capture = captureVersionOnly("Hermes Agent v0.20.5 (2026.8.19)\n");
    const err = await action({ run, capture, writeBaseUrls: vi.fn(), ref: "file:///tmp/clawchat-plugin" }).catch((err: unknown) => err);

    expect(err).toMatchObject({ code: "PRECONDITION", message: expect.stringContaining("too old") });
    expect((err as Error).message).toContain("v0.21.6");
    expect(classifyInstallFailure(err)).toBe("host_too_old");
    expect(capture).toHaveBeenCalledTimes(1);
    expect(run).not.toHaveBeenCalled();
  });
});

// Host wording (Hermes 0.20.3+, hermes_cli/plugins_cmd.py + tools/plugin_guard.py). The
// host prints it on stdout through rich, which wraps at 80 columns when not a TTY —
// hence the mid-phrase line breaks, which the matcher must survive.
const HOST_CAUTION_REFUSAL =
  "hermes plugins install clawling/clawchat-plugin-hermes-agent --enable failed with exit code 1: " +
  "Blocked: Security scan blocked plugin install: Requires confirmation (caution\nverdict, 2 findings)\n\n" +
  "  [caution] network: outbound request in adapter.py\n";
const HOST_DANGEROUS_REFUSAL =
  "hermes plugins install clawling/clawchat-plugin-hermes-agent --enable failed with exit code 1: " +
  "Blocked: Security scan blocked plugin install: Blocked (dangerous verdict, 1 findings). " +
  "--force does not override a dangerous verdict.\n";
const HOST_ALREADY_EXISTS =
  "hermes plugins install clawling/clawchat-plugin-hermes-agent --enable failed with exit code 1: " +
  "Error: Plugin 'clawchat' already exists. Use force reinstall or run `hermes plugins update clawchat`.";

function hostInstallCalls(run: MockLike): Array<readonly string[]> {
  return run.mock.calls
    .filter((c) => c[0] === "hermes" && c[1][0] === "plugins" && c[1][1] === "install")
    .map((c) => c[1]);
}

describe("Hermes host security scan", () => {
  it("recognises the host's caution and dangerous refusals, even when rich wrapped the line", () => {
    expect(isHermesScanRefusal(HOST_CAUTION_REFUSAL)).toBe(true);
    expect(isHermesScanRefusal(HOST_DANGEROUS_REFUSAL)).toBe(true);
    expect(isHermesScanRefusal("Security scan\n   blocked plugin install")).toBe(true);
    expect(isHermesScanRefusal(HOST_ALREADY_EXISTS)).toBe(false);
    expect(isHermesScanRefusal("git clone failed: network is blocked by proxy")).toBe(false);
  });

  it("reports a scan refusal as SCAN_BLOCKED with the host output and never retries with --force", async () => {
    const run = vi.fn(async (cmd: string, args: readonly string[]) => {
      if (cmd === "hermes" && args[1] === "install") throw new ClawchatError("SUBPROCESS", HOST_CAUTION_REFUSAL);
    });
    const capture = createCapture(null);

    const err = (await installHermesPlugin({ run, capture }).then(
      () => { throw new Error("expected a rejection"); },
      (e: unknown) => e,
    )) as ClawchatError;

    expect(err).toBeInstanceOf(ClawchatError);
    expect(err.code).toBe("SCAN_BLOCKED");
    expect(err.message).toContain("security scan refused the ClawChat plugin (caution verdict)");
    expect(err.message).toContain("owner's review");
    expect(err.message).toContain("Do not retry automatically");
    expect(err.message).toContain("[caution] network: outbound request in adapter.py");
    expect(hostInstallCalls(run)).toEqual([["plugins", "install", HERMES_PLUGIN_SPEC, "--enable"]]);
  });

  it("does not let the installer's --force turn into a scan override", async () => {
    const run = vi.fn(async (cmd: string, args: readonly string[]) => {
      if (cmd === "hermes" && args[1] === "install") throw new ClawchatError("SUBPROCESS", HOST_CAUTION_REFUSAL);
    });
    const capture = createCapture("0.1.1");

    await expect(updateHermesPlugin({ run, capture, force: true })).rejects.toMatchObject({ code: "SCAN_BLOCKED" });

    const calls = hostInstallCalls(run);
    expect(calls).toHaveLength(1);
    expect(calls[0]).not.toContain("--force");
  });

  it("explains that a dangerous verdict cannot be overridden at all", async () => {
    const run = vi.fn(async (cmd: string, args: readonly string[]) => {
      if (cmd === "hermes" && args[1] === "install") throw new ClawchatError("SUBPROCESS", HOST_DANGEROUS_REFUSAL);
    });

    await expect(installHermesPlugin({ run, capture: createCapture(null) })).rejects.toThrow(
      /dangerous verdict[\s\S]*never installs a plugin with a dangerous verdict/,
    );
    expect(hostInstallCalls(run)).toHaveLength(1);
  });

  it("reinstalls with the host's --force only after a scan-clean attempt reports the plugin already exists", async () => {
    const run = vi.fn(async (cmd: string, args: readonly string[]) => {
      if (cmd === "hermes" && args[1] === "install" && !args.includes("--force")) {
        throw new ClawchatError("SUBPROCESS", HOST_ALREADY_EXISTS);
      }
    });
    const progress = vi.fn();

    await expect(
      installHermesPlugin({ run, capture: createCapture("0.1.1"), force: true, onProgress: progress }),
    ).resolves.toMatchObject({ status: "updated" });

    expect(hostInstallCalls(run)).toEqual([
      ["plugins", "install", HERMES_PLUGIN_SPEC, "--enable"],
      ["plugins", "install", HERMES_PLUGIN_SPEC, "--force", "--enable"],
    ]);
    expect(progress).toHaveBeenCalledWith(expect.stringContaining("host security scan passed"));
  });

  it("does not replace an existing copy on a plain install that finds a stray plugin dir", async () => {
    const run = vi.fn(async (cmd: string, args: readonly string[]) => {
      if (cmd === "hermes" && args[1] === "install") throw new ClawchatError("SUBPROCESS", HOST_ALREADY_EXISTS);
    });

    await expect(installHermesPlugin({ run, capture: createCapture(null) })).rejects.toThrow("already exists");
    expect(hostInstallCalls(run)).toHaveLength(1);
  });

  it("stops a ref install on a scan refusal without a --force retry", async () => {
    const base = runThatClones();
    const run = vi.fn(async (cmd: string, args: readonly string[]) => {
      if (cmd === "hermes" && args[1] === "install") throw new ClawchatError("SUBPROCESS", HOST_CAUTION_REFUSAL);
      return base(cmd, args);
    });

    await expect(
      installHermesPlugin({ run, capture: captureVersionOnly(), writeBaseUrls: vi.fn(), ref: REF }),
    ).rejects.toMatchObject({ code: "SCAN_BLOCKED" });

    const calls = hostInstallCalls(run);
    expect(calls).toHaveLength(1);
    expect(calls[0]).not.toContain("--force");
  });

  it("does not re-enable a plugin the host disabled after its post-update rescan", async () => {
    const run = vi.fn(async () => undefined);
    const baseCapture = createCapture("0.1.0");
    const capture = vi.fn(async (cmd: string, args: readonly string[]) => {
      if (args.join(" ") === `plugins update ${HERMES_PLUGIN_NAME}`) {
        return "Updating clawchat...\n\u26a0 Security scan flagged the updated plugin: Blocked (dangerous verdict, 1 findings).\n" +
          "Plugin 'clawchat' has been disabled. Review the findings, then re-enable with `hermes plugins enable clawchat`.\n";
      }
      return baseCapture(cmd, args);
    });

    await expect(updateHermesPlugin({ run, capture })).rejects.toMatchObject({
      code: "SCAN_BLOCKED",
      message: expect.stringContaining("did NOT re-enable it"),
    });
    expect(run).not.toHaveBeenCalled();
  });
});

describe("Hermes pinned plugin update", () => {
  it("explains a pinned-plugin update refusal and how to switch back to tracked releases", async () => {
    const run = vi.fn(async () => undefined);
    const baseCapture = createCapture("0.1.0");
    const capture = vi.fn(async (cmd: string, args: readonly string[]) => {
      if (args.join(" ") === `plugins update ${HERMES_PLUGIN_NAME}`) {
        throw new ClawchatError(
          "SUBPROCESS",
          "hermes plugins update clawchat failed with exit code 1: Error: Plugin 'clawchat' is pinned to " +
            "0123456789abcdef0123456789abcdef01234567. To move it, run `hermes plugins install <source> --force --ref <40-character commit SHA>`.",
        );
      }
      return baseCapture(cmd, args);
    });

    const err = (await updateHermesPlugin({ run, capture }).then(
      () => { throw new Error("expected a rejection"); },
      (e: unknown) => e,
    )) as ClawchatError;

    expect(err.code).toBe("SUBPROCESS");
    expect(err.message).toContain("installed pinned to a fixed commit");
    expect(err.message).toContain(`hermes plugins remove ${HERMES_PLUGIN_NAME}`);
    expect(err.message).toContain("install --target hermes");
    expect(run).not.toHaveBeenCalled();
  });
});

describe("Hermes activation failure stages", () => {
  it("marks activation errors after install while preserving the original error", async () => {
    const err = new ClawchatError("SUBPROCESS", "this Hermes profile is already paired");
    const run = vi.fn(async (_cmd: string, args: readonly string[]) => {
      if (args[0] === "clawchat") throw err;
    });
    const promise = installHermesPlugin({ run, capture: createCapture(null), activateCode: "PLACEHOLDER_CODE" });
    await expect(promise).rejects.toBe(err);
    expect(isActivationFailure(err)).toBe(true);
    expect(err.code).toBe("SUBPROCESS");
    expect(err.message).toBe("this Hermes profile is already paired");
    expect(run.mock.calls.map((call) => call[1].slice(0, 2))).toEqual([
      ["plugins", "install"], ["clawchat", "activate"],
    ]);
  });

  it("retains activation stage when adding the existing read-only config hint", async () => {
    const message = "OSError: [Errno 16] Device or resource busy: '/example/config.yaml'";
    const run = vi.fn(async () => { throw new ClawchatError("SUBPROCESS", message); });
    try {
      await installHermesPlugin({ run, capture: createCapture("0.1.1"), activateCode: "PLACEHOLDER_CODE" });
      expect.fail("activation should fail");
    } catch (err) {
      expect(isActivationFailure(err)).toBe(true);
      expect(err).toMatchObject({ code: "SUBPROCESS" });
      expect((err as Error).message).toContain(message);
      expect((err as Error).message).toContain("config.yaml is read-only");
    }
  });

  it("does not mark an install failure as activation even with a pairing code", async () => {
    const err = new ClawchatError("SUBPROCESS", "install failed");
    const run = vi.fn(async () => { throw err; });
    await expect(installHermesPlugin({ run, capture: createCapture(null), activateCode: "PLACEHOLDER_CODE" })).rejects.toBe(err);
    expect(isActivationFailure(err)).toBe(false);
    expect(run).toHaveBeenCalledTimes(1);
  });
});

describe("Hermes metadata fallback", () => {
  it.each([
    [installHermesPlugin, false],
    [installHermesPlugin, true],
    [updateHermesPlugin, false],
    [updateHermesPlugin, true],
  ] as const)("still refuses excluded scan releases without metadata (%s, force=%s)", async (action, force) => {
    vi.useFakeTimers();
    const run = vi.fn(async () => undefined);
    const capture = createCapture(null, "Hermes Agent v0.20.6\n");
    const pending = action({
      run,
      capture,
      force,
      fetchFn: async () => { throw new Error("offline"); },
    }).catch((err: unknown) => err);
    await vi.runAllTimersAsync();
    const err = await pending;
    expect(err).toMatchObject({ code: "PRECONDITION", message: expect.stringContaining("too old") });
    expect((err as Error).message).toContain("v0.21.6");
    expect(classifyInstallFailure(err)).toBe("host_too_old");
    expect(headCalls(capture)).toEqual([["hermes", ["--version"]]]);
    expect(run).not.toHaveBeenCalled();
  });

  it("falls back after three metadata fetch timeouts with 2s and 4s backoff", async () => {
    vi.useFakeTimers();
    const timeout = vi.spyOn(AbortSignal, "timeout");
    const fetchFn = vi.fn(async () => { throw new DOMException("request timed out", "TimeoutError"); });
    const run = vi.fn(async () => undefined);
    const capture = createCapture(null, "unparseable host version");
    const progress = vi.fn();
    const pending = installHermesPlugin({ run, capture, fetchFn, onProgress: progress });
    await vi.advanceTimersByTimeAsync(0);
    expect(fetchFn).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(2_000);
    expect(fetchFn).toHaveBeenCalledTimes(2);
    await vi.advanceTimersByTimeAsync(3_999);
    expect(fetchFn).toHaveBeenCalledTimes(2);
    await vi.advanceTimersByTimeAsync(1);
    const result = await pending;
    expect(fetchFn).toHaveBeenCalledTimes(3);
    expect(timeout).toHaveBeenCalledWith(20_000);
    timeout.mockRestore();
    expect(result).toMatchObject({ status: "installed", detail: expect.stringContaining("fallback host install") });
    expect(result.version).toBeUndefined();
    expect(hostInstallCalls(run)).toEqual([["plugins", "install", HERMES_PLUGIN_SPEC, "--enable"]]);
    expect(capture.mock.calls.map((call) => call.slice(0, 2))).toEqual([
      ["hermes", ["--version"]], ["hermes", ["plugins", "list"]],
    ]);
    expect(progress).toHaveBeenCalledWith(expect.stringMatching(/metadata unavailable.*falling back to hermes plugins install.*skipping CLI version \/ host compatibility checks/));
  });

  it("falls back after retrying metadata HTTP 5xx responses", async () => {
    vi.useFakeTimers();
    const fetchFn = vi.fn(async () => new Response("unavailable", { status: 503 }));
    const run = vi.fn(async () => undefined);
    const pending = installHermesPlugin({ run, capture: createCapture(null), fetchFn });
    await vi.runAllTimersAsync();
    await expect(pending).resolves.toMatchObject({ status: "installed", version: undefined });
    expect(fetchFn).toHaveBeenCalledTimes(3);
    expectRemoteInstall(run);
  });

  it.each([401, 403, 404])("does not retry or fall back on metadata HTTP %s", async (status) => {
    const fetchFn = vi.fn(async () => new Response("refused", { status }));
    const run = vi.fn(async () => undefined);
    const capture = createCapture(null);
    await expect(installHermesPlugin({ run, capture, fetchFn })).rejects.toMatchObject({ code: "PRECONDITION" });
    expect(fetchFn).toHaveBeenCalledTimes(1);
    expect(run).not.toHaveBeenCalled();
    expect(capture).not.toHaveBeenCalled();
  });

  it("does not fall back on malformed metadata", async () => {
    const run = vi.fn(async () => undefined);
    await expect(installHermesPlugin({ run, capture: createCapture(null), fetchFn: async () => new Response("name: clawchat") })).rejects.toMatchObject({ code: "METADATA" });
    expect(run).not.toHaveBeenCalled();
  });

  it.each([installHermesPlugin, updateHermesPlugin])("preserves and classifies metadata timeouts for installed plugins without force (%s)", async (action) => {
    vi.useFakeTimers();
    const fetchFn = vi.fn(async () => { throw new DOMException("timeout", "TimeoutError"); });
    const run = vi.fn(async () => undefined);
    const pending = action({ run, capture: createCapture("0.1.1"), fetchFn }).catch((err: unknown) => err);
    await vi.runAllTimersAsync();
    const err = await pending;
    expect(err).toMatchObject({ code: "TIMEOUT", message: `GET ${HERMES_PLUGIN_YAML_URL} timed out after 20000ms` });
    expect(classifyInstallFailure(err)).toBe("metadata");
    expect(fetchFn).toHaveBeenCalledTimes(3);
    expect(run).not.toHaveBeenCalled();
  });

  it.each([
    [installHermesPlugin, "0.1.1", "updated"],
    [updateHermesPlugin, null, "installed"],
    [updateHermesPlugin, "0.1.1", "updated"],
  ] as const)("falls back only to canonical installs requested with force (%s, %s)", async (action, installed, status) => {
    vi.useFakeTimers();
    const fetchFn = vi.fn(async () => { throw new Error("network unavailable"); });
    const run = vi.fn(async () => undefined);
    const pending = action({ run, capture: createCapture(installed), fetchFn, force: true });
    await vi.runAllTimersAsync();
    await expect(pending).resolves.toMatchObject({ status, version: undefined, previousVersion: installed });
    expect(hostInstallCalls(run)).toEqual([["plugins", "install", HERMES_PLUGIN_SPEC, "--enable"]]);
  });

  it("still requires the host executable before installing without metadata", async () => {
    vi.useFakeTimers();
    const run = vi.fn(async () => undefined);
    const hostError = new ClawchatError("SUBPROCESS", "hermes failed: spawn hermes ENOENT");
    const pending = installHermesPlugin({
      run,
      capture: async () => { throw hostError; },
      fetchFn: async () => { throw new Error("offline"); },
    }).catch((err: unknown) => err);
    await vi.runAllTimersAsync();
    expect(await pending).toBe(hostError);
    expect(classifyInstallFailure(await pending)).toBe("host_missing");
    expect(run).not.toHaveBeenCalled();
  });

  it("retries response body timeouts before falling back", async () => {
    vi.useFakeTimers();
    const fetchFn = vi.fn(async () => {
      const response = new Response("");
      vi.spyOn(response, "text").mockRejectedValue(new DOMException("timeout", "AbortError"));
      return response;
    });
    const run = vi.fn(async () => undefined);
    const pending = installHermesPlugin({ run, capture: createCapture(null), fetchFn });
    await vi.runAllTimersAsync();
    await expect(pending).resolves.toMatchObject({ status: "installed" });
    expect(fetchFn).toHaveBeenCalledTimes(3);
    expectRemoteInstall(run);
  });

  it("keeps the metadata error for update without force when the plugin is absent", async () => {
    vi.useFakeTimers();
    const run = vi.fn(async () => undefined);
    const pending = updateHermesPlugin({ run, capture: createCapture(null), fetchFn: async () => { throw new Error("offline"); } }).catch((err: unknown) => err);
    await vi.runAllTimersAsync();
    expect(classifyInstallFailure(await pending)).toBe("metadata");
    expect(run).not.toHaveBeenCalled();
  });

  it("keeps the scan gate during fallback and classifies caution as scan_blocked", async () => {
    vi.useFakeTimers();
    const run = vi.fn(async () => { throw new ClawchatError("SUBPROCESS", HOST_CAUTION_REFUSAL); });
    const pending = installHermesPlugin({ run, capture: createCapture("0.1.1"), force: true, fetchFn: async () => { throw new Error("offline"); } }).catch((err: unknown) => err);
    await vi.runAllTimersAsync();
    const err = await pending;
    expect(err).toMatchObject({ code: "SCAN_BLOCKED" });
    expect(classifyInstallFailure(err)).toBe("scan_blocked");
    expect(hostInstallCalls(run)).toEqual([["plugins", "install", HERMES_PLUGIN_SPEC, "--enable"]]);
  });

  it("replaces during fallback only after the host reports already exists", async () => {
    vi.useFakeTimers();
    const run = vi.fn(async (_cmd: string, args: readonly string[]) => {
      if (!args.includes("--force")) throw new ClawchatError("SUBPROCESS", HOST_ALREADY_EXISTS);
    });
    const pending = installHermesPlugin({ run, capture: createCapture("0.1.1"), force: true, fetchFn: async () => { throw new Error("offline"); } });
    await vi.runAllTimersAsync();
    await expect(pending).resolves.toMatchObject({ status: "updated" });
    expect(hostInstallCalls(run)).toEqual([
      ["plugins", "install", HERMES_PLUGIN_SPEC, "--enable"],
      ["plugins", "install", HERMES_PLUGIN_SPEC, "--force", "--enable"],
    ]);
  });

  it("reports a fetch TLS verification failure as tls without echoing the raw cause", async () => {
    vi.useFakeTimers();
    const cause = Object.assign(new Error("unable to get local issuer certificate secret-cause-text"), { code: "UNABLE_TO_GET_ISSUER_CERT_LOCALLY" });
    const fetchFn = vi.fn(async () => { throw new TypeError("fetch failed", { cause }); });
    const run = vi.fn(async () => undefined);
    const pending = installHermesPlugin({ run, capture: createCapture("0.1.0"), fetchFn }).catch((err: unknown) => err);
    await vi.runAllTimersAsync();
    const err = await pending;
    expect(err).toMatchObject({ code: "HTTP_ERROR" });
    expect((err as Error).message).toContain("certificate verify failed (UNABLE_TO_GET_ISSUER_CERT_LOCALLY)");
    expect((err as Error).message).not.toContain("secret-cause-text");
    expect(classifyInstallFailure(err)).toBe("tls");
    expect(run).not.toHaveBeenCalled();
  });

  it("keeps a non-TLS fetch cause as a plain transport failure", async () => {
    vi.useFakeTimers();
    const cause = Object.assign(new Error("socket hang up"), { code: "ECONNRESET" });
    const fetchFn = vi.fn(async () => { throw new TypeError("fetch failed", { cause }); });
    const run = vi.fn(async () => undefined);
    const pending = installHermesPlugin({ run, capture: createCapture("0.1.0"), fetchFn }).catch((err: unknown) => err);
    await vi.runAllTimersAsync();
    const err = await pending;
    expect((err as Error).message).toBe(`GET ${HERMES_PLUGIN_YAML_URL} failed: fetch failed`);
    expect(classifyInstallFailure(err)).toBe("metadata");
  });

  it("does not fall back when curl reports an HTTP error (exit 22)", async () => {
    vi.stubEnv("HTTPS_PROXY", "http://localhost:3128");
    const baseCapture = createCapture(null);
    const capture = vi.fn(async (cmd: string, args: readonly string[]) => {
      if (cmd === "curl") throw new ClawchatError("SUBPROCESS", `curl -fsL ${HERMES_PLUGIN_YAML_URL} failed with exit code 22`);
      return baseCapture(cmd, args);
    });
    const run = vi.fn(async () => undefined);
    await expect(installHermesPlugin({ run, capture })).rejects.toMatchObject({ code: "SUBPROCESS" });
    expect(run).not.toHaveBeenCalled();
  });

  it.each([5, 6, 7, 28, 35, 52, 55, 56])("falls back when curl reports transport exit %i", async (exitCode) => {
    vi.stubEnv("HTTPS_PROXY", "http://localhost:3128");
    const baseCapture = createCapture(null);
    const capture = vi.fn(async (cmd: string, args: readonly string[]) => {
      if (cmd === "curl") throw new ClawchatError("SUBPROCESS", `curl -fsL ${HERMES_PLUGIN_YAML_URL} failed with exit code ${exitCode}`);
      return baseCapture(cmd, args);
    });
    const run = vi.fn(async () => undefined);
    await expect(installHermesPlugin({ run, capture })).resolves.toMatchObject({ status: "installed" });
    expectRemoteInstall(run);
  });

  it("falls back when a curl transport exit has multiline error detail", async () => {
    vi.stubEnv("HTTPS_PROXY", "http://localhost:3128");
    const baseCapture = createCapture(null);
    const capture = vi.fn(async (cmd: string, args: readonly string[]) => {
      if (cmd === "curl") throw new ClawchatError("SUBPROCESS", `curl -fsL ${HERMES_PLUGIN_YAML_URL} failed with exit code 6: Could not resolve host\nRetries exhausted`);
      return baseCapture(cmd, args);
    });
    const run = vi.fn(async () => undefined);
    await expect(installHermesPlugin({ run, capture })).resolves.toMatchObject({ status: "installed" });
    expectRemoteInstall(run);
  });

  it.each([3, 23, 47, 60, 99, 280])("stops without fallback when curl reports non-transport exit %i", async (exitCode) => {
    vi.stubEnv("HTTPS_PROXY", "http://localhost:3128");
    const err = new ClawchatError("SUBPROCESS", `curl -fsL ${HERMES_PLUGIN_YAML_URL} failed with exit code ${exitCode}: detail mentions failed with exit code 28`);
    const capture = vi.fn(async () => { throw err; });
    const run = vi.fn(async () => undefined);
    await expect(installHermesPlugin({ run, capture })).rejects.toBe(err);
    expect(run).not.toHaveBeenCalled();
    expect(capture).toHaveBeenCalledTimes(1);
  });

  it.each([
    "curl failed: spawn curl ENOENT",
    "curl failed",
    "curl -fsL failed with exit code null",
    "curl -fsL failed with exit code 28unexpected",
    "curl -fsL failed with exit code 28 unexpected",
  ])("stops without fallback when curl has no parseable exit code: %s", async (message) => {
    vi.stubEnv("HTTPS_PROXY", "http://localhost:3128");
    const err = new ClawchatError("SUBPROCESS", message);
    const capture = vi.fn(async () => { throw err; });
    const run = vi.fn(async () => undefined);
    await expect(installHermesPlugin({ run, capture })).rejects.toBe(err);
    expect(run).not.toHaveBeenCalled();
    expect(capture).toHaveBeenCalledTimes(1);
  });

  it("falls back when the subprocess runner times out curl", async () => {
    vi.stubEnv("HTTPS_PROXY", "http://localhost:3128");
    const baseCapture = createCapture(null);
    const capture = vi.fn(async (cmd: string, args: readonly string[]) => {
      if (cmd === "curl") throw new ClawchatError("TIMEOUT", "curl did not finish within 75s and was stopped (SIGKILL).");
      return baseCapture(cmd, args);
    });
    const run = vi.fn(async () => undefined);
    await expect(installHermesPlugin({ run, capture })).resolves.toMatchObject({ status: "installed" });
    expectRemoteInstall(run);
    expect(capture).toHaveBeenCalledWith("curl", expect.arrayContaining(["--max-time", "20", "--retry", "2"]), { timeoutMs: 75_000 });
  });
});
