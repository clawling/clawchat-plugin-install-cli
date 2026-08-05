// packages/core/src/baseurl/write-hermes.ts
import * as fs from "node:fs";
import * as path from "node:path";
import { type HermesHomeOptions, resolveHermesHomeRoot } from "../hermes-home";

export interface HermesBaseUrls {
  CLAWCHAT_BASE_URL?: string;
  CLAWCHAT_WEBSOCKET_URL?: string;
  CLAWCHAT_MEDIA_BASE_URL?: string;
}

export type WriteHermesOptions = HermesHomeOptions;

/** Mirrors the plugin's reader: `$HERMES_HOME/.env` if set, else the
 * platform-native Hermes home (`~/.hermes`, or `%LOCALAPPDATA%\\hermes`). */
export function getHermesEnvPath(options: WriteHermesOptions = {}): string {
  return path.join(resolveHermesHomeRoot(options), ".env");
}

/** Idempotently upsert `KEY=value` lines (format the plugin's reader parses). */
export function writeHermesBaseUrls(values: HermesBaseUrls, options: WriteHermesOptions = {}): void {
  const entries = Object.entries(values).filter(([, value]) => typeof value === "string" && value.trim()) as [
    string,
    string,
  ][];
  if (entries.length === 0) {
    return;
  }
  const envPath = getHermesEnvPath(options);
  let existing = "";
  try {
    existing = fs.readFileSync(envPath, "utf8");
  } catch {
    existing = "";
  }
  const lines = existing.length
    ? existing.split(/\r?\n/).map((line) => line.replace(/\r$/, "")).filter((line) => line.length > 0)
    : [];
  for (const [key, value] of entries) {
    const index = lines.findIndex((line) => line.trim().replace(/^export\s+/, "").startsWith(`${key}=`));
    const next = `${key}=${value}`;
    if (index === -1) {
      lines.push(next);
    } else {
      lines[index] = next;
    }
  }
  const out = `${lines.join("\n").replace(/\n+$/, "")}\n`;
  fs.mkdirSync(path.dirname(envPath), { recursive: true });
  fs.writeFileSync(envPath, out, "utf8");
}
