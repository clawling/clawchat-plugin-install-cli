// packages/core/src/baseurl/write-openclaw.ts
import * as fs from "node:fs";
import * as path from "node:path";
import { getOpenClawConfigPath } from "../auth/openclaw";
import { OPENCLAW_CHANNEL } from "../config";
import { ClawchatError } from "../errors";
import { resolveWriteTarget, writeFileAtomicSync } from "../fs/atomic-write";

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
  let raw = "";
  try {
    raw = fs.readFileSync(configPath, "utf8");
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== "ENOENT") {
      throw new ClawchatError("PRECONDITION", "Cannot read OpenClaw config; refusing to replace it.");
    }
  }
  if (raw.trim() !== "") {
    let parsed: unknown;
    try { parsed = JSON.parse(raw); } catch {
      throw new ClawchatError("PRECONDITION", "OpenClaw config is invalid JSON; refusing to replace it.");
    }
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      throw new ClawchatError("PRECONDITION", "OpenClaw config must be a JSON object; refusing to replace it.");
    }
    config = parsed;
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
  writeFileAtomicSync(resolveWriteTarget(configPath), `${JSON.stringify(config, null, 2)}\n`);
}
