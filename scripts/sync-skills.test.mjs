import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { syncTarget, verifyManifestFresh } from "./sync-skills.mjs";

const SKILLS_DIR = path.resolve(fileURLToPath(new URL("../skills", import.meta.url)));
const manifest = JSON.parse(fs.readFileSync(path.join(SKILLS_DIR, "manifest.json"), "utf8"));

function tmpRepo() {
  return fs.mkdtempSync(path.join(os.tmpdir(), "sync-skills-"));
}

test("verifyManifestFresh passes on the real tree", () => {
  verifyManifestFresh(manifest, SKILLS_DIR); // throws on drift
});

test("syncTarget copies every hermes skill + manifest verbatim", () => {
  const repo = tmpRepo();
  syncTarget("hermes", manifest, SKILLS_DIR, repo);
  for (const [id, entry] of Object.entries(manifest.skills.hermes)) {
    const copied = fs.readFileSync(path.join(repo, "skills", id, "SKILL.md"));
    const canonical = fs.readFileSync(path.join(SKILLS_DIR, entry.path));
    assert.deepEqual(copied, canonical, id);
  }
  assert.equal(
    fs.readFileSync(path.join(repo, "skills", "manifest.json"), "utf8"),
    fs.readFileSync(path.join(SKILLS_DIR, "manifest.json"), "utf8"),
  );
});

test("syncTarget deletes tombstoned dirs and is idempotent", () => {
  const repo = tmpRepo();
  const stale = path.join(repo, "skills", "set-greeting");
  fs.mkdirSync(stale, { recursive: true });
  fs.writeFileSync(path.join(stale, "SKILL.md"), "old");
  syncTarget("hermes", manifest, SKILLS_DIR, repo);
  assert.equal(fs.existsSync(stale), false);
  const before = fs.readdirSync(path.join(repo, "skills")).sort();
  syncTarget("hermes", manifest, SKILLS_DIR, repo); // second run: no-op
  assert.deepEqual(fs.readdirSync(path.join(repo, "skills")).sort(), before);
});

test("syncTarget rejects a missing repo path", () => {
  assert.throws(() => syncTarget("hermes", manifest, SKILLS_DIR, "/nonexistent/repo"));
});
