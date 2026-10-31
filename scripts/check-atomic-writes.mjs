#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
let root = repoRoot;
let allowlistFile;
for (let i = 2; i < process.argv.length; i += 1) {
  const flag = process.argv[i];
  if ((flag !== "--root" && flag !== "--allowlist") || !process.argv[i + 1]) {
    console.error(`Unknown or incomplete option: ${flag}`);
    process.exit(1);
  }
  const value = path.resolve(process.argv[++i]);
  if (flag === "--root") root = value;
  else allowlistFile = value;
}
allowlistFile ??= path.join(root, "scripts/atomic-write-allowlist.json");

// A line is one hit, even when two patterns recognize the same call.
const WRITE = /\b(writeFileSync|writeFile|appendFileSync|appendFile|createWriteStream|copyFileSync|copyFile|openSync)\s*\(|\bfs\.open\s*\(|\bfsp?\.promises\.(writeFile|appendFile|open)\s*\(/;
const EXTENSION = /\.(ts|mts|js|mjs|cjs)$/;
const SKIP = new Set(["node_modules", "dist", "tests"]);

function filesUnder(dir) {
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name)).flatMap(entry => {
    if (SKIP.has(entry.name)) return [];
    const file = path.join(dir, entry.name);
    if (entry.isDirectory()) return filesUnder(file);
    return entry.isFile() && EXTENSION.test(entry.name) && !/\.test\./.test(entry.name) ? [file] : [];
  });
}

try {
  const allowlist = JSON.parse(fs.readFileSync(allowlistFile, "utf8"));
  if (!Array.isArray(allowlist) || allowlist.some(entry =>
    !entry || typeof entry.file !== "string" || !entry.file || typeof entry.match !== "string" || !entry.match ||
    !Number.isInteger(entry.count) || entry.count <= 0 || typeof entry.reason !== "string" || !entry.reason.trim())) {
    throw new Error("allowlist must contain file, match, positive integer count, and a specific reason");
  }
  const packages = path.join(root, "packages");
  const scanRoots = ["scripts", "examples", "livewares"].map(dir => path.join(root, dir));
  if (fs.existsSync(packages)) {
    for (const entry of fs.readdirSync(packages, { withFileTypes: true })) {
      if (entry.isDirectory() && !SKIP.has(entry.name)) scanRoots.push(path.join(packages, entry.name, "src"));
    }
  }
  const counts = allowlist.map(() => 0);
  let violations = 0;
  for (const file of scanRoots.flatMap(filesUnder)) {
    const relative = path.relative(root, file).split(path.sep).join("/");
    const lines = fs.readFileSync(file, "utf8").split(/\r?\n/);
    lines.forEach((line, index) => {
      if (/^\s*(\/\/|\*)/.test(line) || !WRITE.test(line)) return;
      const covering = [];
      allowlist.forEach((entry, entryIndex) => {
        if (entry.file === relative && line.includes(entry.match)) {
          covering.push(entryIndex);
          counts[entryIndex] += 1;
        }
      });
      if (covering.length !== 1) {
        console.error(`${relative}:${index + 1}:${line} (${covering.length} allowlist entries)`);
        violations += 1;
      }
    });
  }
  allowlist.forEach((entry, index) => {
    if (counts[index] !== entry.count || counts[index] === 0) {
      console.error(`失效条目 / stale entry: ${entry.file} / ${entry.match}: expected ${entry.count}, found ${counts[index]}`);
      violations += 1;
    }
  });
  if (violations) {
    console.error("Use packages/core/src/fs/atomic-write.ts, or register an allowlist entry with a specific reason.");
    process.exitCode = 1;
  } else console.log(`Atomic write gate passed: ${allowlist.length} allowlist entries, 0 violations.`);
} catch (err) {
  console.error(`Atomic write gate failed: ${err.message}`);
  process.exitCode = 1;
}
