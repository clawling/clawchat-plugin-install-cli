import fs from "node:fs";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { HERMES_PLUGIN_NAME, HERMES_PLUGIN_SPEC, HERMES_PLUGIN_YAML_URL } from "../../src/config";
import { ClawchatError } from "../../src/errors";
import { installHermesPlugin, updateHermesPlugin } from "../../src/installers/hermes";

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

beforeEach(() => {
  fetchMock = vi.fn(async () => new Response(pluginYaml()));
  vi.stubGlobal("fetch", fetchMock);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

function createCapture(installedVersion: string | null, hostVersion = "Hermes Agent v0.12.0\n", status = "enabled") {
  return vi.fn(async (cmd: string, args: readonly string[]) => {
    if (cmd === "hermes" && args[0] === "--version") {
      return hostVersion;
    }
    if (cmd === "hermes" && args.join(" ") === "plugins list") {
      return hermesList(installedVersion, status);
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

function expectLocalClone(run: MockLike, opts: { branch: string; force: boolean }) {
  const git = cloneCall(run);
  expect(git, "expected a git clone call").toBeTruthy();
  expect(git!).toEqual(expect.arrayContaining(["clone", "--depth", "1", "--single-branch", "--branch", opts.branch]));
  expect(git!).toContain(HERMES_CLONE_URL);

  const install = installCall(run);
  expect(install, "expected a hermes plugins install call").toBeTruthy();
  expect(install![2]).toMatch(/^file:\/\/.+\/plugin$/);
  expect(install!).toContain("--enable");
  if (opts.force) {
    expect(install!).toContain("--force");
  } else {
    expect(install!).not.toContain("--force");
  }
}

/**
 * Canonical (non-ref) install goes directly to the host: `hermes plugins install
 * <owner/repo>` with no CLI-side git clone. file:// is reserved for the debug/ref
 * path.
 */
function expectRemoteInstall(run: MockLike, opts: { force: boolean }) {
  expect(cloneCall(run), "canonical install must not git clone").toBeUndefined();

  const install = installCall(run);
  expect(install, "expected a hermes plugins install call").toBeTruthy();
  expect(install![2]).toBe(HERMES_PLUGIN_SPEC);
  expect(install!).toContain("--enable");
  if (opts.force) {
    expect(install!).toContain("--force");
  } else {
    expect(install!).not.toContain("--force");
  }
}

describe("Hermes installer", () => {
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
    expectRemoteInstall(run, { force: false });
  });

  it("still activates after a skipped canonical install when --activate is given", async () => {
    const run = vi.fn(async () => undefined);
    const capture = createCapture("0.1.1"); // already current + enabled → install skipped

    const result = await installHermesPlugin({ run, capture, activateCode: "ABC123" });

    expect(result).toMatchObject({ status: "skipped", activated: true });
    // No install/clone work, but activation still runs.
    expect(headCalls(run)).toEqual([["hermes", ["clawchat", "activate", "ABC123"]]]);
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

    expectRemoteInstall(run, { force: true });
  });

  it("force installs from the remote spec when Hermes plugin is missing", async () => {
    const run = vi.fn(async () => undefined);
    const capture = createCapture(null);

    await expect(installHermesPlugin({ run, capture, force: true })).resolves.toMatchObject({
      status: "installed",
      version: "0.1.1",
      previousVersion: null,
    });

    expectRemoteInstall(run, { force: true });
  });

  it("updates and enables during install when installed plugin is stale", async () => {
    const run = vi.fn(async () => undefined);
    const capture = createCapture("0.1.0");

    await expect(installHermesPlugin({ run, capture })).resolves.toMatchObject({
      status: "updated",
      version: "0.1.1",
      previousVersion: "0.1.0",
    });

    expect(headCalls(run)).toEqual([
      ["hermes", ["plugins", "update", HERMES_PLUGIN_NAME]],
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

    expect(headCalls(run)).toEqual([
      ["hermes", ["plugins", "update", HERMES_PLUGIN_NAME]],
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
    const run = vi.fn(async (_cmd: string, args: readonly string[]) => {
      if (args.join(" ") === `plugins update ${HERMES_PLUGIN_NAME}`) {
        throw new Error(
          "hermes plugins update clawchat failed with exit code 1: error: The following untracked working tree files would be overwritten by merge",
        );
      }
    });
    const capture = createCapture("0.1.0");

    await expect(updateHermesPlugin({ run, capture })).rejects.toThrow("update --target hermes --force");

    expect(headCalls(run)).toEqual([
      ["hermes", ["plugins", "update", HERMES_PLUGIN_NAME]],
    ]);
  });

  it("force reinstalls from the remote spec when installed Hermes plugin is stale", async () => {
    const run = vi.fn(async () => undefined);
    const capture = createCapture("0.1.0");

    await expect(updateHermesPlugin({ run, capture, force: true })).resolves.toMatchObject({
      status: "updated",
      version: "0.1.1",
      previousVersion: "0.1.0",
    });

    expectRemoteInstall(run, { force: true });
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
  it("clones the requested branch and reads plugin.yaml from the checkout (no metadata fetch)", async () => {
    const run = runThatClones();
    const capture = captureVersionOnly();

    const result = await installHermesPlugin({ run, capture, writeBaseUrls: vi.fn(), ref: REF });

    expect(result).toMatchObject({ kind: "plugin", target: "hermes", status: "installed", version: "0.14.0-22" });
    expectLocalClone(run, { branch: "dev", force: true });
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
    expectLocalClone(run, { branch: "dev", force: true });
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
    // --version is never read because the version check is skipped.
    const capture = vi.fn(async (cmd: string, args: readonly string[]) => {
      throw new Error(`unexpected capture: ${cmd} ${args.join(" ")}`);
    });

    const result = await installHermesPlugin({ run, capture, writeBaseUrls: vi.fn(), ref: REF });

    expect(result.status).toBe("installed");
    expectLocalClone(run, { branch: "dev", force: true });
    expect(capture).not.toHaveBeenCalled();
  });

  it("still installs when the checkout has a malformed plugin.yaml (version check skipped)", async () => {
    // Valid YAML, but no `version` field → parseHermesPluginYaml throws METADATA,
    // which is caught and treated like a missing file: skip the check, install anyway.
    const run = runThatClones("manifest_version: 1\nname: clawchat\n");
    const capture = vi.fn(async (cmd: string, args: readonly string[]) => {
      throw new Error(`unexpected capture: ${cmd} ${args.join(" ")}`);
    });

    const result = await installHermesPlugin({ run, capture, writeBaseUrls: vi.fn(), ref: REF });

    expect(result.status).toBe("installed");
    expectLocalClone(run, { branch: "dev", force: true });
    expect(capture).not.toHaveBeenCalled(); // version check skipped → --version never read
  });

  it("aborts the ref install when hermes --version fails during the version check", async () => {
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

    // Compat check runs after a successful clone but aborts before the install.
    expect(cloneCall(run)).toBeTruthy();
    expect(installCall(run)).toBeUndefined();
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
    const capture = vi.fn(async (cmd: string) => {
      throw new Error(`unexpected capture: ${cmd}`);
    });

    const result = await installHermesPlugin({
      run,
      capture,
      writeBaseUrls: vi.fn(),
      ref: "git@example.com:weird",
    });

    expect(result.status).toBe("installed");
    expect(headCalls(run)).toEqual([
      ["hermes", ["plugins", "install", "git@example.com:weird", "--force", "--enable"]],
    ]);
    expect(cloneCall(run)).toBeUndefined();
    expect(capture).not.toHaveBeenCalled();
  });
});
