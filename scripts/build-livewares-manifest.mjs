#!/usr/bin/env node
// Build (or verify) livewares/manifest.json from the livewares/ static tree.
//
// Mirrors scripts/build-skills-manifest.mjs: the manifest is the cross-language
// contract the ClawChat agent adapters use to download a liveware sample over
// GitHub raw with per-file sha256 integrity checks. `version` comes from each
// sample's own liveware.json.
//
// Usage:
//   node scripts/build-livewares-manifest.mjs           # write livewares/manifest.json
//   node scripts/build-livewares-manifest.mjs --check   # verify it is up to date (CI)
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { fileURLToPath } from "node:url";

const LIVEWARES_DIR = path.resolve(fileURLToPath(new URL("../livewares", import.meta.url)));
const MANIFEST_PATH = path.join(LIVEWARES_DIR, "manifest.json");

// (target) -> { sampleId: repo-relative dir under livewares/ }.
// The sample app is host-agnostic (pure node). hermes reuses openclaw's
// physical files (single source, no drift); it just gets its own manifest
// target entry so the plugin fetches by its own target key.
const LAYOUT = {
  openclaw: { "liveware-sample": "openclaw/liveware-sample" },
  hermes: { "liveware-sample": "openclaw/liveware-sample" },
};

function listFilesRecursive(root) {
  const out = [];
  for (const entry of fs.readdirSync(root, { withFileTypes: true })) {
    const p = path.join(root, entry.name);
    if (entry.isDirectory()) out.push(...listFilesRecursive(p));
    else out.push(p);
  }
  return out;
}

function buildManifest() {
  const livewares = {};
  for (const [target, idToDirMap] of Object.entries(LAYOUT)) {
    livewares[target] = {};
    for (const [id, relDir] of Object.entries(idToDirMap)) {
      const sampleDir = path.join(LIVEWARES_DIR, relDir);
      const metaPath = path.join(sampleDir, "liveware.json");
      const meta = JSON.parse(fs.readFileSync(metaPath, "utf8"));
      if (typeof meta.version !== "string" || !meta.version) {
        throw new Error(`${metaPath}: missing version`);
      }
      const files = listFilesRecursive(sampleDir)
        .map((abs) => {
          const buf = fs.readFileSync(abs);
          return {
            path: path.relative(LIVEWARES_DIR, abs).split(path.sep).join("/"),
            sha256: crypto.createHash("sha256").update(buf).digest("hex"),
            bytes: buf.length,
          };
        })
        .sort((a, b) => (a.path < b.path ? -1 : 1));
      livewares[target][id] = { version: meta.version, files };
    }
  }
  return { schema: 1, livewares };
}

const manifest = buildManifest();
const rendered = JSON.stringify(manifest, null, 2) + "\n";

if (process.argv.includes("--check")) {
  const current = fs.existsSync(MANIFEST_PATH) ? fs.readFileSync(MANIFEST_PATH, "utf8") : "";
  if (current !== rendered) {
    console.error("livewares/manifest.json is stale. Run: node scripts/build-livewares-manifest.mjs");
    process.exit(1);
  }
  console.log("livewares/manifest.json is up to date.");
} else {
  fs.writeFileSync(MANIFEST_PATH, rendered);
  console.log(`wrote ${MANIFEST_PATH}`);
}
