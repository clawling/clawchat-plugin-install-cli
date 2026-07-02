import crypto from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import { ClawchatError } from "../../src/errors";
import {
  checkSkillUpdate,
  fetchSkillMarkdown,
  manifestUrl,
  parseSkillsManifest,
  skillContentUrl,
} from "../../src/skills/check-update";

const BASE = "https://raw.githubusercontent.com/clawling/clawchat-plugin-install-cli";

function sha256(text: string): string {
  return crypto.createHash("sha256").update(Buffer.from(text, "utf8")).digest("hex");
}

const CLAWCHAT_MD = "---\nname: clawchat\nversion: 1.2.0\n---\n# ClawChat\n";
const LIVEWARE_MD = "---\nname: liveware-app\nversion: 1.0.0\n---\n# liveware\n";

function manifest(removed?: Record<string, string[]>): string {
  return JSON.stringify({
    schema: 1,
    skills: {
      openclaw: {
        clawchat: { version: "1.2.0", path: "openclaw/clawchat/SKILL.md", sha256: sha256(CLAWCHAT_MD), bytes: Buffer.byteLength(CLAWCHAT_MD) },
        "liveware-app": { version: "1.0.0", path: "shared/liveware-app/SKILL.md", sha256: sha256(LIVEWARE_MD), bytes: Buffer.byteLength(LIVEWARE_MD) },
      },
      hermes: {
        clawchat: { version: "1.2.0", path: "hermes/clawchat/SKILL.md", sha256: sha256(CLAWCHAT_MD), bytes: Buffer.byteLength(CLAWCHAT_MD) },
      },
    },
    ...(removed !== undefined ? { removed } : {}),
  });
}

function textResponse(body: string, ok = true): Response {
  return new Response(body, { status: ok ? 200 : 404 });
}

describe("url builders", () => {
  it("builds manifest and content urls for a ref", () => {
    expect(manifestUrl("skills-v1.2.0")).toBe(`${BASE}/skills-v1.2.0/skills/manifest.json`);
    expect(skillContentUrl("openclaw/clawchat/SKILL.md", "skills-v1.2.0")).toBe(
      `${BASE}/skills-v1.2.0/skills/openclaw/clawchat/SKILL.md`,
    );
  });
});

describe("checkSkillUpdate", () => {
  it("flags a skill whose remote version is newer than the local one", async () => {
    const fetchFn = vi.fn(async () => textResponse(manifest()));
    const out = await checkSkillUpdate({
      target: "openclaw",
      current: { clawchat: "1.1.0", "liveware-app": "1.0.0" },
      ref: "skills-v1.2.0",
      fetchFn,
    });
    expect(fetchFn).toHaveBeenCalledWith(`${BASE}/skills-v1.2.0/skills/manifest.json`, { method: "GET" });
    expect(out.hasUpdate).toBe(true);
    const clawchat = out.results.find((r) => r.skillId === "clawchat")!;
    expect(clawchat).toMatchObject({ current: "1.1.0", latest: "1.2.0", hasUpdate: true, path: "openclaw/clawchat/SKILL.md" });
    const liveware = out.results.find((r) => r.skillId === "liveware-app")!;
    expect(liveware.hasUpdate).toBe(false);
  });

  it("reports no update when local matches remote", async () => {
    const fetchFn = vi.fn(async () => textResponse(manifest()));
    const out = await checkSkillUpdate({
      target: "openclaw",
      current: { clawchat: "1.2.0", "liveware-app": "1.0.0" },
      fetchFn,
    });
    expect(out.hasUpdate).toBe(false);
  });

  it("treats a not-installed skill (missing from current) as an update", async () => {
    const fetchFn = vi.fn(async () => textResponse(manifest()));
    const out = await checkSkillUpdate({ target: "hermes", current: {}, fetchFn });
    expect(out.results).toEqual([
      expect.objectContaining({ skillId: "clawchat", current: null, latest: "1.2.0", hasUpdate: true }),
    ]);
  });

  it("does NOT downgrade when local is newer than remote", async () => {
    const fetchFn = vi.fn(async () => textResponse(manifest()));
    const out = await checkSkillUpdate({ target: "openclaw", current: { clawchat: "2.0.0", "liveware-app": "1.0.0" }, fetchFn });
    expect(out.results.find((r) => r.skillId === "clawchat")!.hasUpdate).toBe(false);
  });

  it("throws when the target is absent from the manifest", async () => {
    const onlyHermes = JSON.stringify({ schema: 1, skills: { hermes: {} } });
    const fetchFn = vi.fn(async () => textResponse(onlyHermes));
    await expect(checkSkillUpdate({ target: "openclaw", current: {}, fetchFn })).rejects.toThrow(ClawchatError);
  });

  it("throws on a non-ok manifest response", async () => {
    const fetchFn = vi.fn(async () => textResponse("not found", false));
    await expect(checkSkillUpdate({ target: "openclaw", current: {}, fetchFn })).rejects.toThrow(/status 404/);
  });
});

describe("parseSkillsManifest", () => {
  it("rejects an unsupported schema", () => {
    expect(() => parseSkillsManifest(JSON.stringify({ schema: 2, skills: {} }))).toThrow(/schema/);
  });
  it("rejects an entry with a malformed sha256", () => {
    const bad = JSON.stringify({ schema: 1, skills: { openclaw: { clawchat: { version: "1.0.0", path: "p", sha256: "xyz", bytes: 1 } } } });
    expect(() => parseSkillsManifest(bad)).toThrow(/sha256/);
  });
});

describe("fetchSkillMarkdown", () => {
  const entry = { path: "openclaw/clawchat/SKILL.md", sha256: sha256(CLAWCHAT_MD), bytes: Buffer.byteLength(CLAWCHAT_MD) };

  it("returns the markdown when the sha256 matches", async () => {
    const fetchFn = vi.fn(async () => textResponse(CLAWCHAT_MD));
    await expect(fetchSkillMarkdown(entry, { ref: "skills-v1.2.0", fetchFn })).resolves.toBe(CLAWCHAT_MD);
    expect(fetchFn).toHaveBeenCalledWith(`${BASE}/skills-v1.2.0/skills/openclaw/clawchat/SKILL.md`, { method: "GET" });
  });

  it("throws on a sha256 mismatch (tampered content)", async () => {
    const fetchFn = vi.fn(async () => textResponse(CLAWCHAT_MD + "tampered"));
    await expect(fetchSkillMarkdown(entry, { fetchFn })).rejects.toThrow(/sha256 mismatch/);
  });

  it("throws when the response exceeds the size cap", async () => {
    const huge = "x".repeat(256 * 1024 + 1);
    const fetchFn = vi.fn(async () => textResponse(huge));
    await expect(
      fetchSkillMarkdown({ path: "p", sha256: sha256(huge), bytes: huge.length }, { fetchFn }),
    ).rejects.toThrow(/over the/);
  });
});

describe("removed tombstones", () => {
  it("parses a manifest with a removed list", () => {
    const m = parseSkillsManifest(JSON.stringify({
      schema: 1,
      skills: { openclaw: {}, hermes: {} },
      removed: { openclaw: ["retired-skill"], hermes: [] },
    }));
    expect(m.removed).toEqual({ openclaw: ["retired-skill"], hermes: [] });
  });

  it("defaults removed to {} when absent (backward compat)", () => {
    const m = parseSkillsManifest(JSON.stringify({ schema: 1, skills: { openclaw: {} } }));
    expect(m.removed).toEqual({});
  });

  it("rejects an id present in both skills and removed for the same target", () => {
    expect(() => parseSkillsManifest(JSON.stringify({
      schema: 1,
      skills: { openclaw: { foo: { version: "1.0.0", path: "openclaw/foo/SKILL.md", sha256: "a".repeat(64), bytes: 1 } } },
      removed: { openclaw: ["foo"] },
    }))).toThrow(/both/);
  });

  it("rejects a malformed removed value", () => {
    expect(() => parseSkillsManifest(JSON.stringify({
      schema: 1, skills: {}, removed: { openclaw: [42] },
    }))).toThrow(/removed/);
  });

  it("checkSkillUpdate surfaces removedIds for the target", async () => {
    const fetchFn = vi.fn(async () => textResponse(manifest({ openclaw: ["retired-skill"], hermes: [] })));
    const out = await checkSkillUpdate({
      target: "openclaw",
      current: { clawchat: "1.2.0", "liveware-app": "1.0.0" },
      fetchFn,
    });
    expect(out.removedIds).toEqual(["retired-skill"]);
    expect(out.hasUpdate).toBe(false);
  });
});
