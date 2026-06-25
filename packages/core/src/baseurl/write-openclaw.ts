// packages/core/src/baseurl/write-openclaw.ts
import * as fs from "node:fs";
import * as path from "node:path";
import { getOpenClawConfigPath } from "../auth/openclaw";
import { OPENCLAW_CHANNEL } from "../config";

export interface OpenClawBaseUrls {
  baseUrl?: string;
  websocketUrl?: string;
  mediaBaseUrl?: string;
}

export interface WriteOpenClawOptions {
  homeDir?: string;
}

/** Idempotently upsert base-URL keys into the openclaw.json clawchat channel. */
export function writeOpenClawBaseUrls(values: OpenClawBaseUrls, options: WriteOpenClawOptions = {}): void {
  const entries = Object.entries(values).filter(([, value]) => typeof value === "string" && value.trim());
  if (entries.length === 0) {
    return;
  }
  const configPath = getOpenClawConfigPath({ homeDir: options.homeDir });
  let config: Record<string, any> = {};
  try {
    const parsed = JSON.parse(fs.readFileSync(configPath, "utf8"));
    if (parsed && typeof parsed === "object") {
      config = parsed;
    }
  } catch {
    config = {};
  }
  if (!config.channels || typeof config.channels !== "object") {
    config.channels = {};
  }
  if (!config.channels[OPENCLAW_CHANNEL] || typeof config.channels[OPENCLAW_CHANNEL] !== "object") {
    config.channels[OPENCLAW_CHANNEL] = {};
  }
  for (const [key, value] of entries) {
    config.channels[OPENCLAW_CHANNEL][key] = value;
  }
  fs.mkdirSync(path.dirname(configPath), { recursive: true });
  fs.writeFileSync(configPath, `${JSON.stringify(config, null, 2)}\n`, "utf8");
}
