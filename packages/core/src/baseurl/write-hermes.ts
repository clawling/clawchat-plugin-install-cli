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
  writeFileAtomic(envPath, out);
}

/**
 * Replace `target` atomically: write a temp file in the same directory, fsync it,
 * then rename it over the target, so a crash never leaves a truncated `.env`
 * (which also holds the plugin's tokens). A new file is created 0600; an existing
 * file keeps its mode. A symlinked `.env` is written through to its target.
 */
function writeFileAtomic(target: string, data: string): void {
  let dest = target;
  let mode = 0o600;
  try {
    dest = fs.realpathSync(target);
    mode = fs.statSync(dest).mode & 0o777;
  } catch {
    // Missing file: create it owner-only.
  }
  const dir = path.dirname(dest);
  const tmp = path.join(dir, `.${path.basename(dest)}.${process.pid}.${Date.now()}.tmp`);
  let fd: number | undefined;
  try {
    fd = fs.openSync(tmp, "wx", mode);
    fs.writeFileSync(fd, data, "utf8");
    fs.fsyncSync(fd);
    fs.closeSync(fd);
    fd = undefined;
    fs.chmodSync(tmp, mode); // openSync's mode is filtered by the umask.
    fs.renameSync(tmp, dest);
  } catch (err) {
    if (fd !== undefined) {
      try {
        fs.closeSync(fd);
      } catch {
        // already failing; keep the original error
      }
    }
    fs.rmSync(tmp, { force: true });
    throw err;
  }
  if (process.platform !== "win32") {
    try {
      const dirFd = fs.openSync(dir, "r");
      try {
        fs.fsyncSync(dirFd);
      } finally {
        fs.closeSync(dirFd);
      }
    } catch {
      // Directory fsync is best effort; not every filesystem supports it.
    }
  }
}
