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

export function getOpenClawConfigPath(options: AuthReadOptions = {}): string {
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
