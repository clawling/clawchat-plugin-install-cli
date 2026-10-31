import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { pathToFileURL } from "node:url";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { AtomicWriteFs } from "../../src/fs/atomic-write";
import { recordingFs } from "../helpers/recording-fs";

let dir: string;
let write: (dest: string, data: string, io?: AtomicWriteFs) => void;
let resolveWriteTarget: (target: string) => string;
beforeEach(async () => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "cloud-state-"));
  const fetch = vi.spyOn(globalThis, "fetch").mockRejectedValue(new Error("import must not fetch"));
  const exit = vi.spyOn(process, "exit").mockImplementation(() => { throw new Error("import must not exit"); });
  try {
    const url = pathToFileURL(path.resolve(__dirname, "../../../../examples/cloud-agent/agent.mjs")).href;
    const agent = await import(/* @vite-ignore */ url);
    write = agent.writeFileAtomicSync;
    resolveWriteTarget = agent.resolveWriteTarget;
    expect(fetch).not.toHaveBeenCalled();
    expect(exit).not.toHaveBeenCalled();
  } finally { fetch.mockRestore(); exit.mockRestore(); }
});
afterEach(() => fs.rmSync(dir, { recursive: true, force: true }));

it("imports without running the agent and saves state twice without temp files", () => {
  const dest = path.join(dir, "agent.json");
  write(dest, '{"token":"PLACEHOLDER-FIRST"}');
  expect(fs.readFileSync(dest, "utf8")).toBe('{"token":"PLACEHOLDER-FIRST"}');
  if (process.platform !== "win32") expect(fs.statSync(dest).mode & 0o777).toBe(0o600);
  write(dest, '{"token":"PLACEHOLDER-SECOND"}');
  expect(fs.readFileSync(dest, "utf8")).toBe('{"token":"PLACEHOLDER-SECOND"}');
  if (process.platform !== "win32") expect(fs.statSync(dest).mode & 0o777).toBe(0o600);
  expect(fs.readdirSync(dir)).toEqual(["agent.json"]);
});

it("syncs the file before renaming and the directory afterward", () => {
  const dest = path.join(dir, "agent.json");
  const { io, calls } = recordingFs();
  write(dest, "next", io);
  const tmp = calls[1]!.args[0];
  const fd = calls[2]!.args[0];
  expect(calls.slice(0, 7)).toEqual([
    { name: "statSync", args: [dest] },
    { name: "openSync", args: [tmp, "wx", 0o600] },
    { name: "fchmodSync", args: [fd, 0o600] },
    { name: "writeFileSync", args: [fd, "next", "utf8"] },
    { name: "fsyncSync", args: [fd] },
    { name: "closeSync", args: [fd] },
    { name: "renameSync", args: [tmp, dest] },
  ]);
  expect(path.dirname(String(tmp))).toBe(dir);
  if (process.platform !== "win32") {
    const dirFd = calls[8]!.args[0];
    expect(calls.slice(7)).toEqual([
      { name: "openSync", args: [dir, "r"] },
      { name: "fsyncSync", args: [dirFd] },
      { name: "closeSync", args: [dirFd] },
    ]);
  } else { expect(calls).toHaveLength(7); }
});

it("keeps the mode when replacing state and cleans up a failed rename", () => {
  const dest = path.join(dir, "agent.json");
  fs.writeFileSync(dest, "original");
  if (process.platform !== "win32") fs.chmodSync(dest, 0o640);
  write(dest, "original");
  if (process.platform !== "win32") expect(fs.statSync(dest).mode & 0o777).toBe(0o640);
  const { io } = recordingFs();
  const error = new Error("rename failed");
  io.renameSync = () => { throw error; };
  let caught: unknown;
  try { write(dest, "next", io); } catch (err) { caught = err; }
  expect(caught).toBe(error);
  expect(fs.readFileSync(dest, "utf8")).toBe("original");
  expect(fs.readdirSync(dir)).toEqual(["agent.json"]);
});

it.skipIf(process.platform === "win32")("replaces the target of a symlinked state path, including a dangling link", () => {
  const real = path.join(dir, "real.json");
  const link = path.join(dir, "agent.json");
  fs.symlinkSync("real.json", link);
  write(resolveWriteTarget(link), '{"token":"PLACEHOLDER-DANGLING"}');
  expect(fs.lstatSync(link).isSymbolicLink()).toBe(true);
  expect(fs.readFileSync(real, "utf8")).toBe('{"token":"PLACEHOLDER-DANGLING"}');
  write(resolveWriteTarget(link), '{"token":"PLACEHOLDER-EXISTING"}');
  expect(fs.lstatSync(link).isSymbolicLink()).toBe(true);
  expect(fs.readFileSync(real, "utf8")).toBe('{"token":"PLACEHOLDER-EXISTING"}');
});
