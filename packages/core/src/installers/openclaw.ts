import {
  OPENCLAW_ACCEPT_CAPABILITIES_FLAG,
  OPENCLAW_PLUGIN_SPEC,
  OPENCLAW_UNSAFE_INSTALL_FLAG,
} from "../config";
import { writeOpenClawBaseUrls } from "../baseurl/write-openclaw";
import { applyLegacyOpenClawConfigMigration } from "./openclaw-config-migration";
import { captureCommand, runCommand, type CommandCapturer, type CommandRunner } from "./run";
import { applyBaseUrlOverrides, type BaseUrlWriter, type InstallActionResult, type InstallProgressReporter, type InstallerOptions } from "./types";

const defaultOpenClawBaseUrlWriter: BaseUrlWriter = (values) =>
  writeOpenClawBaseUrls({
    baseUrl: values.apiBaseUrl,
    websocketUrl: values.wsBaseUrl,
    mediaBaseUrl: values.mediaBaseUrl,
  });

function openClawSpec(ref?: string): string {
  return ref ? `${OPENCLAW_PLUGIN_SPEC}@${ref}` : OPENCLAW_PLUGIN_SPEC;
}

/**
 * Whether this host needs `--accept-capabilities` on delegated plugin commands.
 *
 * OpenClaw >=2026.8 gates managed plugins behind capability consent: without the flag
 * `plugins install` aborts with `Plugin "clawchat-plugin-openclaw" requires capability
 * consent`, so the plugin never lands and the base-URL write below it never runs.
 * The flag cannot simply be passed everywhere — 2026.6.x/2026.7.x reject unknown options
 * with `OpenClaw does not recognize option "--accept-capabilities"` (verified on 2026.6.34
 * and 2026.7.1). So ask the host: only pass it when its own help advertises it.
 *
 * A failed probe is treated as "unsupported": that keeps the pre-2026.8 command line,
 * which is the safe default on any host we could not interrogate.
 */
async function hostAcceptsCapabilityFlag(capture: CommandCapturer): Promise<boolean> {
  try {
    const help = await capture("openclaw", ["plugins", "install", "--help"]);
    return help.includes(OPENCLAW_ACCEPT_CAPABILITIES_FLAG);
  } catch {
    return false;
  }
}

async function pluginCommandArgs(
  capture: CommandCapturer,
  args: readonly string[],
): Promise<string[]> {
  const accepts = await hostAcceptsCapabilityFlag(capture);
  return accepts ? [...args, OPENCLAW_ACCEPT_CAPABILITIES_FLAG] : [...args];
}

/**
 * Migrate a legacy `openclaw-clawchat` config to the renamed
 * `clawchat-plugin-openclaw` id so an upgrade from the old plugin is
 * non-destructive (channel token/userId, plugins.allow gate, entries, tools all
 * point at the new id). Non-fatal: a migration error must never abort the
 * install. Runs after `openclaw plugins install/update` and before the base-URL
 * write, so base URLs land on the migrated/new channel key.
 */
function migrateLegacyOpenClawConfig(options: InstallerOptions): void {
  const migrate = options.migrateLegacyConfig ?? applyLegacyOpenClawConfigMigration;
  try {
    const changes = migrate({ homeDir: options.homeDir });
    if (changes.length > 0) {
      options.onProgress?.(
        `Migrated legacy openclaw-clawchat config to clawchat-plugin-openclaw (${changes.length} change${changes.length === 1 ? "" : "s"}).`,
      );
    }
  } catch (error) {
    options.onProgress?.(
      `Warning: legacy openclaw-clawchat config migration skipped: ${(error as Error)?.message ?? error}`,
    );
  }
}

const CONTAINER_OPENCLAW_WORKSPACE = "/home/node/.openclaw/workspace";
const HOST_OPENCLAW_WORKSPACE = "~/.openclaw/workspace";

function normalizePathOutput(value: string): string {
  return value.trim().replace(/\/+$/, "");
}

function isStaleContainerWorkspace(workspace: string): boolean {
  // The container workspace path is only meaningful inside the OpenClaw image,
  // whose home is /home/node. Anywhere else it is a leftover from a config
  // copied off that image. Read USERPROFILE too: Windows normally leaves HOME
  // unset, and an unset HOME must not be mistaken for "we are that container".
  const home = process.env.HOME ?? process.env.USERPROFILE ?? "";
  return normalizePathOutput(workspace) === CONTAINER_OPENCLAW_WORKSPACE && home !== "/home/node";
}

async function repairStaleOpenClawWorkspace(run: CommandRunner, capture: CommandCapturer): Promise<void> {
  let configuredWorkspace: string;
  try {
    configuredWorkspace = normalizePathOutput(
      await capture("openclaw", ["config", "get", "agents.defaults.workspace"]),
    );
  } catch {
    return;
  }

  if (!isStaleContainerWorkspace(configuredWorkspace)) {
    return;
  }

  await run("openclaw", ["config", "set", "agents.defaults.workspace", HOST_OPENCLAW_WORKSPACE]);
}

export async function installOpenClawPlugin(options: InstallerOptions = {}): Promise<InstallActionResult> {
  const run = options.run ?? runCommand;
  const capture = options.capture ?? captureCommand;
  const force = options.force ?? false;
  const progress = options.onProgress;

  progress?.(force ? "Reinstalling OpenClaw plugin..." : "Installing OpenClaw plugin...");
  await repairStaleOpenClawWorkspace(run, capture);
  const spec = openClawSpec(options.ref);
  // --force is unconditional on install: OpenClaw 2026.8 widened it to also mean
  // "confirm this non-ClawHub source", and the ClawChat plugin is always npm-sourced, so
  // without it the install is cancelled outright. On older hosts it only means "overwrite
  // an existing plugin", which is what an idempotent re-install wants anyway.
  const args = await pluginCommandArgs(capture, [
    "plugins",
    "install",
    spec,
    "--force",
    OPENCLAW_UNSAFE_INSTALL_FLAG,
  ]);
  await run("openclaw", args);
  // Migrate any legacy openclaw-clawchat config to the renamed id BEFORE writing
  // base URLs, so the base-URL write lands on the migrated/new channel key.
  migrateLegacyOpenClawConfig(options);
  // Write channel base URLs AFTER the plugin is installed. The channel id is not a
  // registered channel until install completes, so upserting channels.<id>.* earlier
  // makes `openclaw plugins install`'s own config validation fail with
  // "unknown channel id" on hosts that strictly validate config.
  applyBaseUrlOverrides(options, defaultOpenClawBaseUrlWriter);
  return {
    kind: "plugin",
    target: "openclaw",
    status: force ? "updated" : "installed",
  };
}

export async function updateOpenClawPlugin(options: InstallerOptions = {}): Promise<InstallActionResult> {
  const run = options.run ?? runCommand;
  const capture = options.capture ?? captureCommand;
  const force = options.force ?? false;
  const progress = options.onProgress;

  progress?.(force ? "Reinstalling OpenClaw plugin..." : "Updating OpenClaw plugin...");
  await repairStaleOpenClawWorkspace(run, capture);
  const spec = openClawSpec(options.ref);
  const args = await pluginCommandArgs(
    capture,
    force
      ? ["plugins", "install", spec, "--force", OPENCLAW_UNSAFE_INSTALL_FLAG]
      : ["plugins", "update", spec, OPENCLAW_UNSAFE_INSTALL_FLAG],
  );
  await run("openclaw", args);
  // Migrate any legacy openclaw-clawchat config to the renamed id BEFORE writing
  // base URLs (see installOpenClawPlugin).
  migrateLegacyOpenClawConfig(options);
  // Write channel base URLs AFTER the plugin is installed (see installOpenClawPlugin).
  applyBaseUrlOverrides(options, defaultOpenClawBaseUrlWriter);
  return {
    kind: "plugin",
    target: "openclaw",
    status: "updated",
  };
}
