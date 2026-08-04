import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { HERMES_PLUGIN_NAME, HERMES_PLUGIN_SPEC, HERMES_PLUGIN_YAML_URL } from "../config";
import { writeHermesBaseUrls } from "../baseurl/write-hermes";
import { parseHermesGitRef } from "../baseurl/target";
import { ClawchatError } from "../errors";
import type { FetchLike } from "../http/client";
import {
  assertVersionSatisfiesRange,
  type HermesInstalledPlugin,
  isVersionOlder,
  parseHermesPluginList,
  parseHermesPluginYaml,
  parseHostVersion,
  type PluginArtifactMetadata,
} from "./metadata";
import { isTransientCommandError, withRetry } from "./retry";
import { captureCommand, type CommandCapturer, type CommandRunner, runCommand } from "./run";
import { applyBaseUrlOverrides, type BaseUrlWriter, type InstallActionResult, type InstallProgressReporter, type InstallerOptions } from "./types";
import { resolveHermesProfileHome, withHermesProfileArgs } from "./hermes-profile";

function hermesBaseUrlWriter(profileHome: string): BaseUrlWriter {
  return (values) =>
    writeHermesBaseUrls(
      {
        CLAWCHAT_BASE_URL: values.apiBaseUrl,
        CLAWCHAT_WEBSOCKET_URL: values.wsBaseUrl,
        CLAWCHAT_MEDIA_BASE_URL: values.mediaBaseUrl,
      },
      { env: { HERMES_HOME: profileHome } },
    );
}

function hermesRunners(options: InstallerOptions): { run: CommandRunner; capture: CommandCapturer } {
  const baseRun = options.run ?? runCommand;
  const baseCapture = options.capture ?? captureCommand;
  const profile = options.profile;
  const mapArgs = (cmd: string, args: readonly string[]): string[] =>
    cmd === "hermes" ? withHermesProfileArgs(profile, args) : [...args];
  return {
    run: (cmd, args, o) => baseRun(cmd, mapArgs(cmd, args), o),
    capture: (cmd, args, o) => baseCapture(cmd, mapArgs(cmd, args), o),
  };
}

const HERMES_FORCE_REPAIR_COMMAND = "Run: npx -y @clawling/clawchat-plugin-install-cli@latest update --target hermes --force";
const HERMES_INSTALL_COMMAND = "Run: npx -y @clawling/clawchat-plugin-install-cli@latest install --target hermes";

// --- Timeout / retry budget -------------------------------------------------
// Designed so a healthy install finishes in well under a minute, and a dead
// network fails fast (bounded retries with short per-attempt caps) instead of
// hanging on OS/git defaults. Worst-case total stays comfortably under 3 min.

/** Per-attempt cap on the plugin.yaml read (was curl's `--max-time 15`). */
const PLUGIN_YAML_TIMEOUT_MS = 15_000;
/** One retry, 2s apart — the same budget curl's `--retry 1 --retry-delay 2` had. */
const PLUGIN_YAML_RETRIES = 1;
const PLUGIN_YAML_BACKOFF_MS = [2_000] as const;
/** Fast local subprocesses (version / list / enable). */
const HERMES_FAST_TIMEOUT_MS = 30_000;
/** `plugins update` does a network git pull. */
const HERMES_UPDATE_TIMEOUT_MS = 60_000;
/**
 * `hermes clawchat activate` makes a bounded HTTP call to member-backend; the
 * plugin caps it at ~15s/attempt with up to 3 connect-retries (~60s worst case).
 * This backstop sits just above that so we never cut off the plugin's own retry.
 */
const HERMES_ACTIVATE_TIMEOUT_MS = 90_000;
/** Local clone (file://) + copy into ~/.hermes/plugins is offline and quick. */
const HERMES_LOCAL_INSTALL_TIMEOUT_MS = 60_000;
/**
 * Canonical remote install: `hermes plugins install <owner/repo>` makes the host
 * clone the repo itself over the network. The host caps its own clone at ~60s
 * (no retry); this backstop sits above that (clone + enable + config write) so we
 * never SIGKILL the host mid-clone.
 */
const HERMES_REMOTE_INSTALL_TIMEOUT_MS = 120_000;
// Per-attempt cap on the CLI-owned git clone. The plugin repo is tiny, so a
// healthy shallow clone finishes in a few seconds; 15s comfortably covers a
// slow-but-alive network while keeping the worst case (3 attempts + backoff
// ≈ 51s) well under the budget and failing fast on a TCP black hole.
const GIT_CLONE_TIMEOUT_MS = 15_000;
const GIT_CLONE_RETRIES = 2;
const GIT_CLONE_BACKOFF_MS = [2_000, 4_000] as const;
/**
 * Abort a clone that stalls below ~1KB/s for 8s instead of waiting for the
 * hard timeout — catches black-hole networks fast.
 */
const GIT_LOW_SPEED_OPTS = [
  "-c", "http.lowSpeedLimit=1000",
  "-c", "http.lowSpeedTime=8",
] as const;
/**
 * Never let git block on an interactive credential / username prompt: on a
 * private/bad/missing branch git would otherwise hang until the SIGKILL
 * timeout. With prompts disabled it fails immediately with a deterministic
 * "terminal prompts disabled" error, which the retry classifier treats as
 * non-retryable — so we fail fast instead of burning the whole retry budget.
 */
const GIT_CLONE_ENV = { GIT_TERMINAL_PROMPT: "0" } as const;

interface HermesInstallerContext {
  run: CommandRunner;
  capture: CommandCapturer;
  force: boolean;
  progress?: InstallProgressReporter;
  artifact: PluginArtifactMetadata;
  installed: HermesInstalledPlugin | null;
}

function isHermesGitUpdateError(message: string): boolean {
  const normalized = message.toLowerCase();
  return normalized.includes("untracked working tree files would be overwritten") ||
    normalized.includes("dirty checkout") ||
    normalized.includes("local changes") ||
    normalized.includes("fast-forward");
}

function appendHermesForceRepairHint(err: unknown): Error {
  const message = (err as Error).message ?? String(err);
  if (!isHermesGitUpdateError(message) || message.includes(HERMES_FORCE_REPAIR_COMMAND)) {
    return err as Error;
  }
  const hintedMessage = `${message}\n${HERMES_FORCE_REPAIR_COMMAND}`;
  if (err instanceof ClawchatError) {
    return new ClawchatError(err.code, hintedMessage);
  }
  return new Error(hintedMessage);
}

const HERMES_CONFIG_READONLY_HINT =
  "config.yaml is read-only: Hermes rewrites $HERMES_HOME/config.yaml atomically (os.replace) " +
  "to persist plugin enablement and activation, but the host reported it busy/read-only. This " +
  "deployment mounts $HERMES_HOME/config.yaml as a read-only bind/ConfigMap-subPath, so the write " +
  "fails (EBUSY). FIX (deployment, not the agent): make $HERMES_HOME/config.yaml a writable file — " +
  "do NOT mount the ConfigMap directly onto it; seed it into the volume instead (e.g. mount the " +
  "ConfigMap elsewhere and copy it in via an initContainer: `cp -n /seed/config.yaml " +
  "$HERMES_HOME/config.yaml`). This is an environment issue — do not attempt in-agent workarounds.";

/** EBUSY / read-only signature from `os.replace` on a bind-mounted config.yaml. */
function isHermesConfigBusyError(message: string): boolean {
  const m = message.toLowerCase();
  return m.includes("device or resource busy") || m.includes("errno 16") || m.includes("ebusy") ||
    (m.includes("config.yaml") && (m.includes("read-only") || m.includes("read only") || m.includes("permission denied")));
}

/**
 * Map the opaque host error (raised when config.yaml is a read-only mount and
 * Hermes' atomic os.replace fails) to a clear, actionable deployment hint, so the
 * agent stops and reports the real fix instead of attempting random workarounds.
 */
function appendHermesConfigBusyHint(err: unknown): Error {
  const message = (err as Error).message ?? String(err);
  if (!isHermesConfigBusyError(message) || message.includes(HERMES_CONFIG_READONLY_HINT)) {
    return err as Error;
  }
  const hinted = `${message}\n${HERMES_CONFIG_READONLY_HINT}`;
  return err instanceof ClawchatError ? new ClawchatError(err.code, hinted) : new Error(hinted);
}

/**
 * One plugin.yaml GET, with a hard per-attempt cap.
 *
 * A 4xx is deterministic (wrong URL, deleted branch) so it is raised as
 * PRECONDITION and never retried; transport faults and 5xx stay retryable.
 */
async function fetchPluginYamlOnce(url: string, fetchFn: FetchLike): Promise<string> {
  let response: Response;
  try {
    response = await fetchFn(url, { signal: AbortSignal.timeout(PLUGIN_YAML_TIMEOUT_MS) });
  } catch (err) {
    const name = (err as Error)?.name;
    const timedOut = name === "TimeoutError" || name === "AbortError";
    throw new ClawchatError(
      timedOut ? "TIMEOUT" : "HTTP_ERROR",
      timedOut
        ? `GET ${url} timed out after ${PLUGIN_YAML_TIMEOUT_MS}ms`
        : `GET ${url} failed: ${(err as Error).message}`,
    );
  }
  if (!response.ok) {
    throw new ClawchatError(
      response.status < 500 ? "PRECONDITION" : "HTTP_ERROR",
      `GET ${url} returned status ${response.status}`,
    );
  }
  return await response.text();
}

/**
 * Read the remote plugin.yaml, failing fast on a dead network with bounded
 * retry. Uses Node's own `fetch` rather than spawning `curl`: curl is missing on
 * Windows builds older than 10/1803, and shelling out to fetch a constant URL
 * bought nothing over an in-process HTTP call.
 */
function fetchPluginYaml(url: string, fetchFn: FetchLike = fetch): Promise<string> {
  return withRetry(() => fetchPluginYamlOnce(url, fetchFn), {
    retries: PLUGIN_YAML_RETRIES,
    backoffMs: PLUGIN_YAML_BACKOFF_MS,
    shouldRetry: (err) =>
      err instanceof ClawchatError && (err.code === "TIMEOUT" || err.code === "HTTP_ERROR"),
  });
}

/**
 * Install the Hermes plugin by cloning the exact branch ourselves (with
 * timeout + retry) and handing the local checkout to `hermes plugins install`
 * via `file://`. This:
 *  - installs the requested branch correctly (a `#branch` fragment left in a
 *    clone URL is silently dropped by git, so the host would otherwise install
 *    the default branch);
 *  - keeps the network-heavy clone under our own timeout/retry control instead
 *    of the host's fixed 60s, no-retry clone;
 *  - turns the host step into an offline local copy.
 */
async function installViaLocalClone(opts: {
  run: CommandRunner;
  cloneUrl: string;
  branch: string;
  force: boolean;
  progress?: InstallProgressReporter;
  /**
   * Invoked with the local checkout path after a successful clone and before
   * `hermes plugins install`. Lets the ref path read `plugin.yaml` straight from
   * the clone (no extra network fetch) and run the host-compat guard before any
   * install happens.
   */
  afterClone?: (dest: string) => void | Promise<void>;
}): Promise<void> {
  const { run, cloneUrl, branch, force, progress, afterClone } = opts;
  const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), "clawchat-hermes-"));
  const dest = path.join(tmpRoot, "plugin");
  try {
    progress?.(`cloning ${cloneUrl} (branch ${branch})`);
    await withRetry(
      async () => {
        // A slow/timed-out (SIGKILL'd) clone leaves a partial, non-empty `dest`.
        // git then refuses the next attempt with "destination path already
        // exists and is not an empty directory", so without this every retry
        // after the first failure is dead on arrival. Reset to a clean target
        // before each attempt so the retry budget is actually usable.
        fs.rmSync(dest, { recursive: true, force: true });
        await run(
          "git",
          [
            ...GIT_LOW_SPEED_OPTS,
            "clone", "--depth", "1", "--single-branch", "--branch", branch,
            cloneUrl, dest,
          ],
          { timeoutMs: GIT_CLONE_TIMEOUT_MS, env: GIT_CLONE_ENV },
        );
      },
      {
        retries: GIT_CLONE_RETRIES,
        backoffMs: GIT_CLONE_BACKOFF_MS,
        shouldRetry: isTransientCommandError,
        onRetry: (attempt, err) =>
          progress?.(`git clone failed (attempt ${attempt}), retrying: ${(err as Error).message}`),
      },
    );
    if (afterClone) {
      await afterClone(dest);
    }
    progress?.("installing plugin from local checkout");
    const installArgs = ["plugins", "install", `file://${dest}`, ...(force ? ["--force"] : []), "--enable"];
    await run("hermes", installArgs, { timeoutMs: HERMES_LOCAL_INSTALL_TIMEOUT_MS });
  } finally {
    try {
      fs.rmSync(tmpRoot, { recursive: true, force: true });
    } catch {
      /* best effort cleanup */
    }
  }
}

/**
 * Install the canonical (non-ref) plugin directly from its remote default branch,
 * letting `hermes plugins install <owner/repo>` clone it. The canonical install
 * always targets the default branch, so there is no `#branch` fragment to
 * preserve and the host installer fetches it correctly. The file:// local-clone
 * path (installViaLocalClone) is reserved for the debug/ref flow, where a specific
 * branch/version must be pinned (see installHermesFromRef).
 */
function installCanonical(run: CommandRunner, force: boolean, progress?: InstallProgressReporter): Promise<void> {
  progress?.(`installing plugin from remote ${HERMES_PLUGIN_SPEC}`);
  const installArgs = ["plugins", "install", HERMES_PLUGIN_SPEC, ...(force ? ["--force"] : []), "--enable"];
  return run("hermes", installArgs, { timeoutMs: HERMES_REMOTE_INSTALL_TIMEOUT_MS });
}

async function readHermesInstallerContext(options: InstallerOptions = {}): Promise<HermesInstallerContext> {
  const { run, capture } = hermesRunners(options);
  const force = options.force ?? false;
  const progress = options.onProgress;

  progress?.("Checking Hermes plugin metadata...");
  const pluginYaml = await fetchPluginYaml(HERMES_PLUGIN_YAML_URL, options.fetchFn);
  const artifact = parseHermesPluginYaml(pluginYaml);
  progress?.(`Downloaded Hermes plugin metadata ${artifact.version}`);

  progress?.("Checking Hermes version...");
  const hostVersion = parseHostVersion(await capture("hermes", ["--version"], { timeoutMs: HERMES_FAST_TIMEOUT_MS }));
  assertVersionSatisfiesRange(hostVersion, artifact.hostRequirement, "Hermes");
  progress?.(`Hermes version ok ${hostVersion}`);

  progress?.("Checking installed Hermes plugin...");
  const installed = parseHermesPluginList(await capture("hermes", ["plugins", "list"], { timeoutMs: HERMES_FAST_TIMEOUT_MS }));

  return { run, capture, force, progress, artifact, installed };
}

async function installHermesFromRef(options: InstallerOptions, action: "installed" | "updated" = "installed"): Promise<InstallActionResult> {
  const { run, capture } = hermesRunners(options);
  const progress = options.onProgress;
  const spec = options.ref as string;
  const parsed = parseHermesGitRef(spec);

  if (!parsed) {
    // Unrecognized ref (non-GitHub): hand the raw spec to the host installer.
    progress?.(`plugin installing ${spec}`);
    await run("hermes", ["plugins", "install", spec, "--force", "--enable"], { timeoutMs: HERMES_UPDATE_TIMEOUT_MS });
    return { kind: "plugin", target: "hermes", status: action, version: spec, previousVersion: null };
  }

  // Clone first, then read plugin.yaml straight from the local checkout for the
  // version + host-compat guard. The branch is fetched exactly once: the old
  // path also did a separate curl of raw.githubusercontent.com for the same
  // file, an extra network round-trip and failure point we no longer need.
  let version = spec;
  progress?.(`plugin installing ${spec}`);
  await installViaLocalClone({
    run,
    cloneUrl: parsed.cloneUrl,
    branch: parsed.branch,
    force: true,
    progress,
    afterClone: async (dest) => {
      let artifact: PluginArtifactMetadata | undefined;
      try {
        artifact = parseHermesPluginYaml(fs.readFileSync(path.join(dest, "plugin.yaml"), "utf8"));
      } catch (err) {
        // plugin.yaml metadata is optional (same contract as the old curl
        // pre-check): a missing/unreadable/malformed file just means we skip the
        // host-compat guard — the host installer still validates on its own.
        // Surface the reason so a corrupt checkout stays debuggable.
        const reason = err instanceof ClawchatError ? err.message : (err as Error).message;
        progress?.(`plugin.yaml unavailable in ${spec} checkout (${reason}); skipping version check`);
      }
      if (artifact) {
        version = artifact.version;
        const hostVersion = parseHostVersion(await capture("hermes", ["--version"], { timeoutMs: HERMES_FAST_TIMEOUT_MS }));
        assertVersionSatisfiesRange(hostVersion, artifact.hostRequirement, "Hermes");
      }
    },
  });
  return { kind: "plugin", target: "hermes", status: action, version, previousVersion: null };
}

async function runHermesUpdate(run: CommandRunner): Promise<void> {
  try {
    await run("hermes", ["plugins", "update", HERMES_PLUGIN_NAME], { timeoutMs: HERMES_UPDATE_TIMEOUT_MS });
  } catch (err) {
    throw appendHermesForceRepairHint(err);
  }
  await run("hermes", ["plugins", "enable", HERMES_PLUGIN_NAME], { timeoutMs: HERMES_FAST_TIMEOUT_MS });
}

/**
 * Run `hermes clawchat activate <code>` once, right after a successful install,
 * so install+activate is a single deterministic CLI call rather than a separate
 * agent-driven step. Single-use code: never retried (a retry would burn a used
 * code). Only invoked when `activateCode` is set.
 */
async function maybeActivateHermes(options: InstallerOptions, result: InstallActionResult): Promise<InstallActionResult> {
  const code = options.activateCode?.trim();
  if (!code) {
    return result;
  }
  const { run } = hermesRunners(options);
  options.onProgress?.("activating ClawChat with the provided code");
  await run("hermes", ["clawchat", "activate", code], { timeoutMs: HERMES_ACTIVATE_TIMEOUT_MS });
  options.onProgress?.("activation complete");
  return { ...result, activated: true };
}

export async function installHermesPlugin(options: InstallerOptions = {}): Promise<InstallActionResult> {
  try {
    const result = await installHermesPluginCore(options);
    return await maybeActivateHermes(options, result);
  } catch (err) {
    // Any config.yaml write (enable / activate) fails with EBUSY when config.yaml
    // is a read-only mount — surface the deployment fix instead of a raw OS error.
    throw appendHermesConfigBusyHint(err);
  }
}

async function installHermesPluginCore(options: InstallerOptions = {}): Promise<InstallActionResult> {
  applyBaseUrlOverrides(
    options,
    hermesBaseUrlWriter(resolveHermesProfileHome(options.profile, { homeDir: options.homeDir })),
  );
  if (options.ref) {
    return installHermesFromRef(options);
  }
  const { run, force, progress, artifact, installed } = await readHermesInstallerContext(options);

  if (!installed) {
    progress?.(`plugin installing ${artifact.version}`);
    await installCanonical(run, force, progress);
    return {
      kind: "plugin",
      target: "hermes",
      status: "installed",
      version: artifact.version,
      previousVersion: null,
    };
  }

  if (force) {
    progress?.(`plugin updating ${installed.version} -> ${artifact.version}`);
    await installCanonical(run, true, progress);
    return {
      kind: "plugin",
      target: "hermes",
      status: "updated",
      version: artifact.version,
      previousVersion: installed.version,
    };
  }

  if (isVersionOlder(installed.version, artifact.version)) {
    progress?.(`plugin updating ${installed.version} -> ${artifact.version}`);
    await runHermesUpdate(run);
    return {
      kind: "plugin",
      target: "hermes",
      status: "updated",
      version: artifact.version,
      previousVersion: installed.version,
    };
  }

  if (installed.status !== "enabled") {
    progress?.(`plugin enabling existing ${installed.version}`);
    await run("hermes", ["plugins", "enable", HERMES_PLUGIN_NAME], { timeoutMs: HERMES_FAST_TIMEOUT_MS });
    return {
      kind: "plugin",
      target: "hermes",
      status: "updated",
      version: installed.version,
      previousVersion: installed.version,
      detail: "enabled existing plugin",
    };
  }

  const detail = installed.version === artifact.version ? undefined : `remote version ${artifact.version} is not newer`;
  progress?.(`plugin skipped ${installed.version}`);
  return {
    kind: "plugin",
    target: "hermes",
    status: "skipped",
    version: installed.version,
    previousVersion: installed.version,
    detail,
  };
}

export async function updateHermesPlugin(options: InstallerOptions = {}): Promise<InstallActionResult> {
  try {
    return await updateHermesPluginCore(options);
  } catch (err) {
    throw appendHermesConfigBusyHint(err);
  }
}

async function updateHermesPluginCore(options: InstallerOptions = {}): Promise<InstallActionResult> {
  applyBaseUrlOverrides(
    options,
    hermesBaseUrlWriter(resolveHermesProfileHome(options.profile, { homeDir: options.homeDir })),
  );
  if (options.ref) {
    return installHermesFromRef(options, "updated");
  }
  const { run, force, progress, artifact, installed } = await readHermesInstallerContext(options);

  if (!installed) {
    if (!force) {
      throw new ClawchatError("PRECONDITION", `Hermes plugin ${HERMES_PLUGIN_NAME} is not installed. ${HERMES_INSTALL_COMMAND}`);
    }
    progress?.(`plugin installing ${artifact.version}`);
    await installCanonical(run, true, progress);
    return {
      kind: "plugin",
      target: "hermes",
      status: "installed",
      version: artifact.version,
      previousVersion: null,
    };
  }

  if (force) {
    progress?.(`plugin updating ${installed.version} -> ${artifact.version}`);
    await installCanonical(run, true, progress);
    return {
      kind: "plugin",
      target: "hermes",
      status: "updated",
      version: artifact.version,
      previousVersion: installed.version,
    };
  }

  progress?.(`plugin updating ${installed.version} -> ${artifact.version}`);
  await runHermesUpdate(run);
  return {
    kind: "plugin",
    target: "hermes",
    status: "updated",
    version: artifact.version,
    previousVersion: installed.version,
  };
}
