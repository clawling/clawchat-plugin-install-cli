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

test("syncTarget copies every openclaw skill + manifest verbatim", () => {
  const repo = tmpRepo();
  syncTarget("openclaw", manifest, SKILLS_DIR, repo);
  for (const [id, entry] of Object.entries(manifest.skills.openclaw)) {
    const copied = fs.readFileSync(path.join(repo, "skills", id, "SKILL.md"));
    const canonical = fs.readFileSync(path.join(SKILLS_DIR, entry.path));
    assert.deepEqual(copied, canonical, id);
  }
  assert.equal(
    fs.readFileSync(path.join(repo, "skills", "manifest.json"), "utf8"),
    fs.readFileSync(path.join(SKILLS_DIR, "manifest.json"), "utf8"),
  );
});

// Anti-convergence guard: skills routed to different per-host files must stay
// per-host. If someone pointed both manifest entries at one variant, every
// copy-verbatim test above would still pass — this one would not.
test("per-host skill variants diverge and stay host-clean", () => {
  const perHostIds = Object.keys(manifest.skills.hermes).filter((id) => {
    const openclaw = manifest.skills.openclaw[id];
    return openclaw && openclaw.path !== manifest.skills.hermes[id].path;
  });
  // The canonical tree currently carries per-host variants of these; an empty
  // list means the manifest lost its per-host routing entirely.
  assert.ok(perHostIds.length >= 2, `expected per-host skills, got: ${perHostIds}`);

  const foreignMarkers = {
    hermes: /OPENCLAW_HOME|\.openclaw\b/i, // hermes variant must not mention openclaw paths
    openclaw: /HERMES_HOME|\.hermes\b/i, // openclaw variant must not mention hermes paths
  };
  for (const id of perHostIds) {
    const variants = {};
    for (const target of ["hermes", "openclaw"]) {
      const entry = manifest.skills[target][id];
      variants[target] = fs.readFileSync(path.join(SKILLS_DIR, entry.path), "utf8");
      assert.ok(
        !foreignMarkers[target].test(variants[target]),
        `${target} variant of ${id} (${entry.path}) mentions the other host's markers`,
      );
    }
    assert.notEqual(
      manifest.skills.hermes[id].sha256,
      manifest.skills.openclaw[id].sha256,
      `manifest sha256 converged for ${id}`,
    );
    assert.notEqual(variants.hermes, variants.openclaw, `variant files converged for ${id}`);
  }
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
