import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { writeFileAtomicSync } from "../../src/fs/atomic-write";
import { recordingFs } from "../helpers/recording-fs";

let dir: string;
let dest: string;
beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "atomic-write-"));
  dest = path.join(dir, "state.json");
  fs.writeFileSync(dest, "original");
});
afterEach(() => fs.rmSync(dir, { recursive: true, force: true }));

describe("atomic state replacement", () => {
  it.skipIf(process.platform === "win32")("syncs file contents and mode before rename, then syncs the directory", () => {
    const { io, calls } = recordingFs();
    writeFileAtomicSync(dest, "next", { fs: io, platform: "linux" });
    const tmp = calls[1]!.args[0];
    const fd = calls[2]!.args[0];
    const dirFd = calls[8]!.args[0];
    expect(calls).toEqual([
      { name: "statSync", args: [dest] },
      { name: "openSync", args: [tmp, "wx", fs.statSync(dest).mode & 0o777] },
      { name: "fchmodSync", args: [fd, fs.statSync(dest).mode & 0o777] },
      { name: "writeFileSync", args: [fd, "next", "utf8"] },
      { name: "fsyncSync", args: [fd] },
      { name: "closeSync", args: [fd] },
      { name: "renameSync", args: [tmp, dest] },
      { name: "openSync", args: [dir, "r"] },
      { name: "fsyncSync", args: [dirFd] },
      { name: "closeSync", args: [dirFd] },
    ]);
    expect(path.basename(String(tmp))).toMatch(/^\.state\.json\.\d+\.[a-f0-9]{12}\.tmp$/);
    expect(fs.readFileSync(dest, "utf8")).toBe("next");
    expect(fs.readdirSync(dir)).toEqual(["state.json"]);
  });

  it("skips directory syncing on Windows", () => {
    const { io, calls } = recordingFs();
    writeFileAtomicSync(dest, "next", { fs: io, platform: "win32" });
    expect(calls.map((call) => call.name)).toEqual([
      "statSync", "openSync", "fchmodSync", "writeFileSync", "fsyncSync", "closeSync", "renameSync",
    ]);
  });

  it.each(["writeFileSync", "fsyncSync", "renameSync"] as const)("keeps the original file and removes the temp after %s fails", (name) => {
    const { io } = recordingFs();
    const error = new Error(`${name} failed`);
    io[name] = () => { throw error; };
    let caught: unknown;
    try { writeFileAtomicSync(dest, "next", { fs: io }); } catch (err) { caught = err; }
    expect(caught).toBe(error);
    expect(fs.readFileSync(dest, "utf8")).toBe("original");
    expect(fs.readdirSync(dir)).toEqual(["state.json"]);
  });

  it("preserves the original failure even when cleanup also fails", () => {
    const { io } = recordingFs();
    const error = new Error("write failed");
    io.writeFileSync = () => { throw error; };
    let cleanupAttempted = false;
    io.rmSync = () => { cleanupAttempted = true; throw new Error("cleanup failed"); };
    let caught: unknown;
    try { writeFileAtomicSync(dest, "next", { fs: io }); } catch (err) { caught = err; }
    expect(caught).toBe(error);
    expect(cleanupAttempted).toBe(true);
    expect(fs.readFileSync(dest, "utf8")).toBe("original");
  });

  it("does not remove someone else's temp file when exclusive open fails", () => {
    const { io, calls } = recordingFs();
    let collision = "";
    const error = Object.assign(new Error("exists"), { code: "EEXIST" });
    io.openSync = (file) => {
      collision = file;
      fs.writeFileSync(file, "someone else's file");
      throw error;
    };
    let caught: unknown;
    try { writeFileAtomicSync(dest, "next", { fs: io }); } catch (err) { caught = err; }
    expect(caught).toBe(error);
    expect(calls.some((call) => call.name === "rmSync")).toBe(false);
    expect(fs.readFileSync(collision, "utf8")).toBe("someone else's file");
    expect(fs.readFileSync(dest, "utf8")).toBe("original");
  });

  it.skipIf(process.platform === "win32").each(["EINVAL", "EIO"])("handles directory fsync %s after closing its fd", (code) => {
    const { io, calls } = recordingFs();
    const error = Object.assign(new Error("directory sync"), { code });
    let syncs = 0;
    io.fsyncSync = (fd) => {
      if (++syncs === 2) throw error;
      fs.fsyncSync(fd);
    };
    let caught: unknown;
    try { writeFileAtomicSync(dest, "next", { fs: io, platform: "linux" }); } catch (err) { caught = err; }
    expect(caught).toBe(code === "EIO" ? error : undefined);
    expect(calls.at(-1)?.name).toBe("closeSync");
    expect(fs.readFileSync(dest, "utf8")).toBe("next");
    expect(fs.readdirSync(dir)).toEqual(["state.json"]);
  });

  it.skipIf(process.platform === "win32")("restores the chosen mode despite umask and supports a default mode", () => {
    fs.rmSync(dest);
    const previous = process.umask(0o077);
    try {
      writeFileAtomicSync(dest, "first", { defaultMode: 0o640 });
      expect(fs.statSync(dest).mode & 0o777).toBe(0o640);
      writeFileAtomicSync(dest, "second");
      expect(fs.statSync(dest).mode & 0o777).toBe(0o640);
    } finally { process.umask(previous); }
  });
});
