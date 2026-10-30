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
  fs.mkdirSync(path.dirname(envPath), { recursive: true });
  // Read and replace the same file: the one a symlinked `.env` points at.
  const dest = resolveWriteTarget(envPath);
  let existing = "";
  try {
    existing = fs.readFileSync(dest, "utf8");
  } catch (err) {
    // Only a missing file starts empty: replacing an unreadable `.env` would
    // drop the tokens and other keys it holds.
    if ((err as NodeJS.ErrnoException).code !== "ENOENT") throw err;
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
  writeFileAtomic(dest, out);
}

/**
 * Replace `target` atomically: write a temp file in the same directory, fsync it,
 * then rename it over the target, so a crash never leaves a truncated `.env`
 * (which also holds the plugin's tokens). A new file is created 0600; an existing
 * file keeps its mode. `dest` is already symlink-resolved (see resolveWriteTarget).
 */
function writeFileAtomic(dest: string, data: string): void {
  let mode = 0o600;
  try {
    mode = fs.statSync(dest).mode & 0o777;
  } catch (err) {
    // Missing file: create it owner-only.
    if ((err as NodeJS.ErrnoException).code !== "ENOENT") throw err;
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
    } catch (err) {
      // Only "this filesystem cannot fsync a directory" is tolerated; a real I/O
      // error means the rename may not be durable and must surface.
      if (!DIR_FSYNC_UNSUPPORTED.has((err as NodeJS.ErrnoException).code ?? "")) throw err;
    }
  }
}

const DIR_FSYNC_UNSUPPORTED = new Set(["EINVAL", "ENOTSUP", "EOPNOTSUPP", "EISDIR"]);

/**
 * The file a write to `target` should replace, resolved the way the kernel
 * would: an existing path through `fs.realpathSync.native`, and a symlink whose
 * final target does not exist yet hop by hop, joining each link target to its
 * link's real directory without lexical `..` normalization, so `..` after a
 * symlinked directory follows the filesystem, not the string.
 */
function resolveWriteTarget(target: string): string {
  let current = target;
  for (let hops = 0; hops < 40; hops += 1) {
    try {
      return fs.realpathSync.native(current);
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== "ENOENT") throw err;
    }
    const parent = fs.realpathSync.native(path.dirname(current));
    const leaf = path.join(parent, path.basename(current));
    let stat: fs.Stats;
    try {
      stat = fs.lstatSync(leaf);
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === "ENOENT") return leaf;
      throw err;
    }
    if (!stat.isSymbolicLink()) return leaf;
    const link = fs.readlinkSync(leaf);
    current = path.isAbsolute(link) ? link : `${parent}${path.sep}${link}`;
  }
  throw new Error(`too many symbolic links resolving ${target}`);
}
