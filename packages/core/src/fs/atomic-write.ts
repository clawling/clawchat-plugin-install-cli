import * as fs from "node:fs";
import * as path from "node:path";
import { randomBytes } from "node:crypto";

/** Only the synchronous operations used by the atomic replacement. */
export interface AtomicWriteFs {
  statSync(path: string): { mode: number };
  openSync: (path: string, flags: string, mode?: number) => number;
  fchmodSync(fd: number, mode: number): void;
  writeFileSync: (fd: number, data: string, encoding: "utf8") => void;
  fsyncSync(fd: number): void;
  closeSync(fd: number): void;
  renameSync(from: string, to: string): void;
  rmSync(path: string, options: { force: boolean }): void;
}

const DIR_FSYNC_UNSUPPORTED = new Set(["EINVAL", "ENOTSUP", "EOPNOTSUPP", "EISDIR"]);

/** Replace an already symlink-resolved destination, preserving its mode. */
export function writeFileAtomicSync(
  dest: string,
  data: string,
  options: { defaultMode?: number; fs?: AtomicWriteFs; platform?: NodeJS.Platform } = {},
): void {
  const io = options.fs ?? fs;
  let mode = options.defaultMode ?? 0o600;
  try {
    mode = io.statSync(dest).mode & 0o777;
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== "ENOENT") throw err;
  }
  const dir = path.dirname(dest);
  const tmp = path.join(dir, `.${path.basename(dest)}.${process.pid}.${randomBytes(6).toString("hex")}.tmp`);
  let fd: number | undefined;
  let created = false;
  try {
    fd = io.openSync(tmp, "wx", mode);
    created = true;
    io.fchmodSync(fd, mode); // Restore bits filtered by the process umask.
    io.writeFileSync(fd, data, "utf8");
    io.fsyncSync(fd);
    io.closeSync(fd);
    fd = undefined;
    io.renameSync(tmp, dest);
  } catch (err) {
    if (fd !== undefined) {
      try { io.closeSync(fd); } catch { /* preserve the original error */ }
    }
    if (created) {
      try { io.rmSync(tmp, { force: true }); } catch { /* preserve the original error */ }
    }
    throw err;
  }
  if ((options.platform ?? process.platform) !== "win32") {
    try {
      const dirFd = io.openSync(dir, "r");
      try {
        io.fsyncSync(dirFd);
      } finally {
        io.closeSync(dirFd);
      }
    } catch (err) {
      if (!DIR_FSYNC_UNSUPPORTED.has((err as NodeJS.ErrnoException).code ?? "")) throw err;
    }
  }
}

/**
 * Resolve as the kernel does, including dangling links and `..` after a
 * symlinked directory. Call before replacing a file to preserve the link.
 */
export function resolveWriteTarget(target: string): string {
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
