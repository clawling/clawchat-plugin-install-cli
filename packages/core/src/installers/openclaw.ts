import { OPENCLAW_PLUGIN_SPEC, OPENCLAW_UNSAFE_INSTALL_FLAG } from "../config";
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
  return normalizePathOutput(workspace) === CONTAINER_OPENCLAW_WORKSPACE && process.env.HOME !== "/home/node";
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
  const args = force
    ? ["plugins", "install", spec, "--force", OPENCLAW_UNSAFE_INSTALL_FLAG]
    : ["plugins", "install", spec, OPENCLAW_UNSAFE_INSTALL_FLAG];
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
  const args = force
    ? ["plugins", "install", spec, "--force", OPENCLAW_UNSAFE_INSTALL_FLAG]
    : ["plugins", "update", spec, OPENCLAW_UNSAFE_INSTALL_FLAG];
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
