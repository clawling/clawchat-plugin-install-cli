import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { OPENCLAW_CHANNEL } from "../config";
import type { AuthReadOptions, TargetAuth } from "./types";

interface OpenClawConfig {
  channels?: Record<
    string,
    {
      token?: unknown;
      refreshToken?: unknown;
      userId?: unknown;
      baseUrl?: unknown;
    }
  >;
}

function asString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value : undefined;
}

/**
 * Where the OpenClaw host keeps its config.
 *
 * The host resolves this as `OPENCLAW_CONFIG_PATH` → `<OPENCLAW_STATE_DIR>/openclaw.json`
 * → `~/.openclaw/openclaw.json`. This package used to hardcode the home layout, so on any
 * host running with a relocated state dir (containers commonly set `OPENCLAW_STATE_DIR`)
 * the installer wrote channel base URLs into a file the host never reads: the plugin then
 * fell back to its built-in `app.clawling.com` defaults and activation against a custom
 * backend failed with a misleading "invalid or expired connect code".
 */
export function getOpenClawConfigPath(options: AuthReadOptions = {}): string {
  const env = options.env ?? process.env;
  const configPath = env.OPENCLAW_CONFIG_PATH?.trim();
  if (configPath) {
    return configPath;
  }
  const stateDir = env.OPENCLAW_STATE_DIR?.trim();
  if (stateDir) {
    return path.join(stateDir, "openclaw.json");
  }
  return path.join(options.homeDir ?? os.homedir(), ".openclaw", "openclaw.json");
}

export function readOpenClawAuth(
  options: AuthReadOptions = {},
): TargetAuth | null {
  const configPath = getOpenClawConfigPath(options);
  let parsed: OpenClawConfig;

  try {
    parsed = JSON.parse(fs.readFileSync(configPath, "utf8")) as OpenClawConfig;
  } catch {
    return null;
  }

  const channel = parsed.channels?.[OPENCLAW_CHANNEL];
  const token = asString(channel?.token);
  if (!token) {
    return null;
  }

  return {
    target: "openclaw",
    token,
    refreshToken: asString(channel?.refreshToken),
    userId: asString(channel?.userId),
    baseUrl: asString(channel?.baseUrl),
  };
}
