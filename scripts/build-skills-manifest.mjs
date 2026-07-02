#!/usr/bin/env node
// Build (or verify) skills/manifest.json from the canonical SKILL.md tree.
//
// The manifest is the cross-language contract consumed by the two ClawChat
// agent adapters (openclaw TS, hermes Python) to decide whether their locally
// installed skill markdown is out of date. It is keyed by host target so the
// host-specific `clawchat` skill can diverge (OpenClaw vs Hermes CLI) while a
// genuinely shared skill (`liveware-app`) is stored once under `shared/`.
//
// Each entry records the skill `version` (read from the SKILL.md frontmatter,
// the file's own source of truth), the `sha256` and `bytes` of the file (so an
// adapter can integrity-check a download), and the repo-relative `path`.
//
// Usage:
//   node scripts/build-skills-manifest.mjs           # write skills/manifest.json
//   node scripts/build-skills-manifest.mjs --check    # verify it is up to date (CI)
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { fileURLToPath } from "node:url";

const SKILLS_DIR = path.resolve(fileURLToPath(new URL("../skills", import.meta.url)));
const MANIFEST_PATH = path.join(SKILLS_DIR, "manifest.json");

// (target, skillId) -> repo-relative path under skills/. `shared/*` files are
// referenced by more than one target on purpose (single source, no drift).
const LAYOUT = {
  openclaw: {
    clawchat: "openclaw/clawchat/SKILL.md",
    "liveware-app": "shared/liveware-app/SKILL.md",
  },
  hermes: {
    clawchat: "hermes/clawchat/SKILL.md",
    "liveware-app": "shared/liveware-app/SKILL.md",
    // Temporary: verifies the dynamic skill-update pipeline; remove after test.
    "clawchat-update-test": "hermes/clawchat-update-test/SKILL.md",
  },
};

function frontmatterVersion(text, file) {
  if (!text.startsWith("---")) {
    throw new Error(`${file}: missing YAML frontmatter`);
  }
  const end = text.indexOf("\n---", 3);
  if (end === -1) {
    throw new Error(`${file}: unterminated frontmatter`);
  }
  const fm = text.slice(0, end);
  const m = fm.match(/^version:\s*["']?([^"'\n]+)["']?\s*$/m);
  if (!m) {
    throw new Error(`${file}: frontmatter has no \`version:\``);
  }
  const v = m[1].trim();
  if (!/^\d+(?:\.\d+){1,3}(?:-\d+)?$/.test(v)) {
    throw new Error(`${file}: version "${v}" is not X.Y[.Z][-build]`);
  }
  return v;
}

function build() {
  const skills = {};
  for (const [target, entries] of Object.entries(LAYOUT)) {
    skills[target] = {};
    for (const [skillId, rel] of Object.entries(entries)) {
      const abs = path.join(SKILLS_DIR, rel);
      const buf = fs.readFileSync(abs);
      const text = buf.toString("utf8");
      skills[target][skillId] = {
        version: frontmatterVersion(text, rel),
        path: rel,
        sha256: crypto.createHash("sha256").update(buf).digest("hex"),
        bytes: buf.length,
      };
    }
  }
  return { schema: 1, skills };
}

const manifest = build();
const serialized = JSON.stringify(manifest, null, 2) + "\n";

if (process.argv.includes("--check")) {
  const current = fs.existsSync(MANIFEST_PATH) ? fs.readFileSync(MANIFEST_PATH, "utf8") : "";
  if (current !== serialized) {
    console.error("skills/manifest.json is stale — run: node scripts/build-skills-manifest.mjs");
    process.exit(1);
  }
  console.log("skills/manifest.json is up to date");
} else {
  fs.writeFileSync(MANIFEST_PATH, serialized);
  console.log(`wrote ${path.relative(process.cwd(), MANIFEST_PATH)}`);
}
