#!/usr/bin/env node
// Sync the canonical skills tree into the sibling plugin repos.
//
// For each target (hermes, openclaw) this copies every live SKILL.md into
// <repo>/skills/<id>/SKILL.md, copies skills/manifest.json VERBATIM into
// <repo>/skills/manifest.json (both plugins already parse the full canonical
// schema), and deletes <repo>/skills/<id> dirs tombstoned in `removed`.
//
// Usage:
//   pnpm skills:sync -- --hermes ../clawchat-plugin-hermes-agent --openclaw ../clawchat-plugin-openclaw
// Paths default to the aggregator sibling layout shown above.
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { fileURLToPath, pathToFileURL } from "node:url";

const SKILLS_DIR = path.resolve(fileURLToPath(new URL("../skills", import.meta.url)));
const MANIFEST_PATH = path.join(SKILLS_DIR, "manifest.json");

export function verifyManifestFresh(manifest, skillsDir) {
  for (const entries of Object.values(manifest.skills)) {
    for (const [id, entry] of Object.entries(entries)) {
      const buf = fs.readFileSync(path.join(skillsDir, entry.path));
      const sha = crypto.createHash("sha256").update(buf).digest("hex");
      if (sha !== entry.sha256) {
        throw new Error(`manifest stale for ${id} (${entry.path}) — run: pnpm skills:manifest`);
      }
    }
  }
}

export function syncTarget(target, manifest, skillsDir, repoPath) {
  if (!fs.existsSync(repoPath)) {
    throw new Error(`target repo not found: ${repoPath}`);
  }
  const entries = manifest.skills[target];
  if (!entries) throw new Error(`unknown target: ${target}`);
  const outDir = path.join(repoPath, "skills");
  fs.mkdirSync(outDir, { recursive: true });
  for (const [id, entry] of Object.entries(entries)) {
    const dest = path.join(outDir, id, "SKILL.md");
    fs.mkdirSync(path.dirname(dest), { recursive: true });
    fs.copyFileSync(path.join(skillsDir, entry.path), dest);
  }
  for (const id of manifest.removed[target] ?? []) {
    fs.rmSync(path.join(outDir, id), { recursive: true, force: true });
  }
  fs.copyFileSync(path.join(skillsDir, "manifest.json"), path.join(outDir, "manifest.json"));
  const known = new Set([...Object.keys(entries), "manifest.json"]);
  for (const name of fs.readdirSync(outDir)) {
    if (!known.has(name)) {
      console.error(`warning: ${target} skills/ has unknown entry not in manifest: ${name}`);
    }
  }
}

function main() {
  const args = process.argv.slice(2);
  const flag = (name, fallback) => {
    const i = args.indexOf(`--${name}`);
    return i !== -1 && args[i + 1] ? args[i + 1] : fallback;
  };
  const repoRoot = path.dirname(SKILLS_DIR);
  const targets = {
    hermes: flag("hermes", path.join(repoRoot, "..", "clawchat-plugin-hermes-agent")),
    openclaw: flag("openclaw", path.join(repoRoot, "..", "clawchat-plugin-openclaw")),
  };
  const manifest = JSON.parse(fs.readFileSync(MANIFEST_PATH, "utf8"));
  verifyManifestFresh(manifest, SKILLS_DIR);
  for (const [target, repoPath] of Object.entries(targets)) {
    syncTarget(target, manifest, SKILLS_DIR, path.resolve(repoPath));
    console.log(`synced ${target} -> ${repoPath}`);
  }
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  try {
    main();
  } catch (err) {
    console.error(err instanceof Error ? err.message : String(err));
    process.exit(1);
  }
}
