import * as fs from "node:fs";
import type { AtomicWriteFs } from "../../src/fs/atomic-write";

export function recordingFs() {
  const calls: { name: keyof AtomicWriteFs; args: unknown[] }[] = [];
  const io = {} as AtomicWriteFs;
  for (const name of ["statSync", "openSync", "fchmodSync", "writeFileSync", "fsyncSync", "closeSync", "renameSync", "rmSync"] as const) {
    (io as any)[name] = (...args: unknown[]) => {
      calls.push({ name, args });
      return (fs[name] as Function)(...args);
    };
  }
  return { io, calls };
}
