// packages/core/src/baseurl/write-hermes.ts
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

export interface HermesBaseUrls {
  CLAWCHAT_BASE_URL?: string;
  CLAWCHAT_WEBSOCKET_URL?: string;
  CLAWCHAT_MEDIA_BASE_URL?: string;
}

export interface WriteHermesOptions {
  homeDir?: string;
  env?: Record<string, string | undefined>;
}

/** Mirrors the plugin's reader: `$HERMES_HOME/.env` if set, else `~/.hermes/.env`. */
export function getHermesEnvPath(options: WriteHermesOptions = {}): string {
  const env = options.env ?? process.env;
  if (env.HERMES_HOME?.trim()) {
    return path.join(env.HERMES_HOME, ".env");
  }
  return path.join(options.homeDir ?? os.homedir(), ".hermes", ".env");
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
