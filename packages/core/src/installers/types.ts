// packages/core/src/installers/types.ts
import type { CommandCapturer, CommandRunner } from "./run";

export type InstallActionStatus = "installed" | "updated" | "skipped";
export type InstallProgressReporter = (message: string) => void;

export interface InstallActionResult {
  kind: "plugin";
  target: "openclaw" | "hermes";
  status: InstallActionStatus;
  version?: string;
  previousVersion?: string | null;
  path?: string;
  detail?: string;
  /** True when an activation code was supplied and `hermes clawchat activate` succeeded in the same run. */
  activated?: boolean;
}

/** Normalized full-URL overrides (already scheme-prefixed by the CLI). */
export interface BaseUrlOverrides {
  apiBaseUrl?: string;
  wsBaseUrl?: string;
  mediaBaseUrl?: string;
}

/** Persists base URLs to the host before install; injectable for tests. */
export type BaseUrlWriter = (values: BaseUrlOverrides) => void;

export interface InstallerOptions {
  run?: CommandRunner;
  capture?: CommandCapturer;
  force?: boolean;
  onProgress?: InstallProgressReporter;
  /** `@<ref>` from the target: npm version/dist-tag (openclaw) or git url#branch (hermes). */
  ref?: string;
  apiBaseUrl?: string;
  wsBaseUrl?: string;
  mediaBaseUrl?: string;
  writeBaseUrls?: BaseUrlWriter;
  /**
   * Home directory override for host-config reads/writes (e.g. the legacy
   * OpenClaw config migration). Defaults to the real `os.homedir()`. Mainly a
   * test seam.
   */
  homeDir?: string;
  /**
   * Injectable legacy-config migration step (OpenClaw only). Defaults to
   * {@link applyLegacyOpenClawConfigMigration} bound to `homeDir`. Returns the
   * list of applied change descriptions.
   */
  migrateLegacyConfig?: (options?: { homeDir?: string }) => string[];
  /**
   * Optional ClawChat activation code. When set, the Hermes installer runs
   * `hermes clawchat activate <code>` once, immediately after a successful
   * install/enable, so the whole flow is a single deterministic CLI call
   * instead of a separate agent-driven step. Single-use: it is never retried.
   */
  activateCode?: string;
}

export function applyBaseUrlOverrides(options: InstallerOptions, defaultWriter: BaseUrlWriter): void {
  const write = options.writeBaseUrls ?? defaultWriter;
  write({
    ...(options.apiBaseUrl ? { apiBaseUrl: options.apiBaseUrl } : {}),
    ...(options.wsBaseUrl ? { wsBaseUrl: options.wsBaseUrl } : {}),
    ...(options.mediaBaseUrl ? { mediaBaseUrl: options.mediaBaseUrl } : {}),
  });
}
