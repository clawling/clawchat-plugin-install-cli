import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const script = path.join(root, "scripts/check-atomic-writes.mjs");
function run(args = []) {
  const result = spawnSync(process.execPath, [script, ...args], { encoding: "utf8" });
  assert.ifError(result.error);
  return { status: result.status, output: result.stdout + result.stderr };
}
test("the real repository has no unapproved state writes", () => {
  const result = run();
  assert.equal(result.status, 0, result.output);
  assert.match(result.output, /0 violations/);
});

test("requires exact, live allowlist entries and ignores tests", (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "atomic-gate-"));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const file = "packages/x/src/a.ts";
  fs.mkdirSync(path.join(dir, "packages/x/src/tests"), { recursive: true });
  fs.mkdirSync(path.join(dir, "scripts"));
  const allowlist = path.join(dir, "scripts/atomic-write-allowlist.json");
  const entry = { file, match: "fs.writeFileSync(p, s)", count: 1, reason: "Disposable fixture output." };
  fs.writeFileSync(path.join(dir, file), "fs.writeFileSync(p, s)\n");
  fs.writeFileSync(allowlist, "[]");
  let result = run(["--root", dir]);
  assert.equal(result.status, 1);
  assert.match(result.output, /packages\/x\/src\/a.ts:1:fs.writeFileSync/);
  fs.writeFileSync(allowlist, JSON.stringify([entry]));
  result = run(["--root", dir, "--allowlist", allowlist]);
  assert.equal(result.status, 0, result.output);
  fs.writeFileSync(allowlist, JSON.stringify([{ ...entry, count: 2 }]));
  result = run(["--root", dir]);
  assert.equal(result.status, 1);
  assert.match(result.output, /失效条目/);
  fs.writeFileSync(path.join(dir, file), "// no writes\n");
  fs.writeFileSync(allowlist, JSON.stringify([entry]));
  result = run(["--root", dir]);
  assert.equal(result.status, 1);
  assert.match(result.output, /失效条目/);
  fs.writeFileSync(allowlist, "[]");
  fs.writeFileSync(path.join(dir, "packages/x/src/tests/b.ts"), "fs.writeFileSync(p, s)");
  fs.writeFileSync(path.join(dir, "packages/x/src/b.test.ts"), "fs.writeFileSync(p, s)");
  result = run(["--root", dir]);
  assert.equal(result.status, 0, result.output);
});

test("recognizes all gated APIs and rejects ambiguous exemptions", (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "atomic-gate-patterns-"));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  fs.mkdirSync(path.join(dir, "scripts"));
  const allowlist = path.join(dir, "allow.json");
  fs.writeFileSync(allowlist, "[]");
  const calls = ["writeFileSync", "writeFile", "appendFileSync", "appendFile", "createWriteStream", "copyFileSync", "copyFile", "openSync", "fs.open", "fs.promises.writeFile", "fsp.promises.appendFile", "fs.promises.open"];
  fs.writeFileSync(path.join(dir, "scripts/a.mjs"), calls.map(name => `${name}(p, s)`).join("\n") + "\n// writeFile(p)\n * openSync(p)\n");
  let result = run(["--root", dir, "--allowlist", allowlist]);
  assert.equal(result.status, 1);
  assert.equal(result.output.split("\n").filter(line => line.startsWith("scripts/a.mjs:")).length, calls.length);
  const entry = { file: "scripts/a.mjs", match: "writeFileSync(p, s)", count: 1, reason: "Fixture" };
  fs.writeFileSync(allowlist, JSON.stringify([entry, entry]));
  result = run(["--root", dir, "--allowlist", allowlist]);
  assert.equal(result.status, 1);
  assert.match(result.output, /2 allowlist entries/);
});
