// packages/core/tests/installers/openclaw-config-migration.test.ts
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { OPENCLAW_CHANNEL } from "../../src/config";
import {
  applyLegacyOpenClawConfigMigration,
  migrateLegacyOpenClawClawChatConfig,
} from "../../src/installers/openclaw-config-migration";

const OLD_ID = "openclaw-clawchat";
const NEW_ID = "clawchat-plugin-openclaw";

describe("OPENCLAW_CHANNEL invariant", () => {
  it("is the new plugin id", () => {
    expect(OPENCLAW_CHANNEL).toBe(NEW_ID);
  });
});

describe("migrateLegacyOpenClawClawChatConfig (pure)", () => {
  it("migrates a full old-only config: channel block, allow, entries, tools", () => {
    const input = {
      channels: {
        [OLD_ID]: {
          token: "tok",
          userId: "usr_1",
          ownerUserId: "usr_owner",
          refreshToken: "rt",
        },
      },
      plugins: {
        allow: ["something", OLD_ID, "other"],
        entries: {
          [OLD_ID]: { enabled: true, foo: "bar" },
        },
      },
      tools: {
        allow: ["a", OLD_ID, "b"],
        alsoAllow: [OLD_ID, "c"],
      },
    };
    const { config, changes } = migrateLegacyOpenClawClawChatConfig(input);

    // channel block moved
    expect(config.channels[NEW_ID]).toEqual({
      token: "tok",
      userId: "usr_1",
      ownerUserId: "usr_owner",
      refreshToken: "rt",
    });
    expect(config.channels[OLD_ID]).toBeUndefined();

    // allow: old removed, new present, order/dedup preserved
    expect(config.plugins.allow).toEqual(["something", "other", NEW_ID]);

    // entries moved
    expect(config.plugins.entries[NEW_ID]).toEqual({ enabled: true, foo: "bar" });
    expect(config.plugins.entries[OLD_ID]).toBeUndefined();

    // tools replaced + deduped
    expect(config.tools.allow).toEqual(["a", NEW_ID, "b"]);
    expect(config.tools.alsoAllow).toEqual([NEW_ID, "c"]);

    expect(changes.length).toBeGreaterThan(0);
  });

  it("never overwrites an existing new channel block (merge-missing)", () => {
    const input = {
      channels: {
        [OLD_ID]: { token: "old-tok", userId: "old-usr", extra: "fromOld" },
        [NEW_ID]: { token: "new-tok", baseUrl: "https://api" },
      },
    };
    const { config } = migrateLegacyOpenClawClawChatConfig(input);
    expect(config.channels[NEW_ID]).toEqual({
      token: "new-tok", // new wins
      baseUrl: "https://api",
      userId: "old-usr", // copied from old (absent in new)
      extra: "fromOld",
    });
    expect(config.channels[OLD_ID]).toBeUndefined();
  });

  it("appends the new id to allow when absent and removes old", () => {
    const input = { plugins: { allow: [OLD_ID, "x"] } };
    const { config } = migrateLegacyOpenClawClawChatConfig(input);
    expect(config.plugins.allow).toEqual(["x", NEW_ID]);
  });

  it("dedups when both old and new already in allow", () => {
    const input = { plugins: { allow: [OLD_ID, NEW_ID, "x"] } };
    const { config } = migrateLegacyOpenClawClawChatConfig(input);
    expect(config.plugins.allow).toEqual([NEW_ID, "x"]);
  });

  it("merge-missing entries: new wins, old deleted", () => {
    const input = {
      plugins: {
        entries: {
          [OLD_ID]: { a: 1, b: 2 },
          [NEW_ID]: { a: 99 },
        },
      },
    };
    const { config } = migrateLegacyOpenClawClawChatConfig(input);
    expect(config.plugins.entries[NEW_ID]).toEqual({ a: 99, b: 2 });
    expect(config.plugins.entries[OLD_ID]).toBeUndefined();
  });

  it("is idempotent: running twice yields no further changes", () => {
    const input = {
      channels: { [OLD_ID]: { token: "t" } },
      plugins: { allow: [OLD_ID], entries: { [OLD_ID]: { e: 1 } } },
      tools: { allow: [OLD_ID], alsoAllow: [OLD_ID] },
    };
    const first = migrateLegacyOpenClawClawChatConfig(input);
    expect(first.changes.length).toBeGreaterThan(0);
    const second = migrateLegacyOpenClawClawChatConfig(first.config);
    expect(second.changes).toEqual([]);
    expect(second.config).toEqual(first.config);
  });

  it("returns no changes for empty/missing sections", () => {
    expect(migrateLegacyOpenClawClawChatConfig({}).changes).toEqual([]);
    expect(migrateLegacyOpenClawClawChatConfig({ channels: {} }).changes).toEqual([]);
    expect(
      migrateLegacyOpenClawClawChatConfig({ channels: { [NEW_ID]: { token: "t" } } }).changes,
    ).toEqual([]);
    expect(migrateLegacyOpenClawClawChatConfig({ plugins: { allow: ["x"] } }).changes).toEqual([]);
  });

  it("treats an empty old channel block as nothing to migrate", () => {
    const { config, changes } = migrateLegacyOpenClawClawChatConfig({
      channels: { [OLD_ID]: {} },
    });
    // empty object is not a real channel; leave it untouched, no change
    expect(changes).toEqual([]);
    expect(config.channels[OLD_ID]).toEqual({});
  });

  it("does not mutate the input argument", () => {
    const input = {
      channels: { [OLD_ID]: { token: "t" } },
      plugins: { allow: [OLD_ID] },
    };
    const snapshot = JSON.parse(JSON.stringify(input));
    migrateLegacyOpenClawClawChatConfig(input);
    expect(input).toEqual(snapshot);
  });

  it("ignores prototype-pollution keys", () => {
    const input = {
      channels: {
        [OLD_ID]: { token: "t", __proto__: { polluted: true }, constructor: "x" },
      },
    };
    const { config } = migrateLegacyOpenClawClawChatConfig(input);
    expect(config.channels[NEW_ID].token).toBe("t");
    expect((config.channels[NEW_ID] as any).polluted).toBeUndefined();
    expect(({} as any).polluted).toBeUndefined();
  });

  it("tolerates oddly-typed sections without throwing", () => {
    expect(() =>
      migrateLegacyOpenClawClawChatConfig({
        channels: "nope",
        plugins: { allow: "nope", entries: 5 },
        tools: 42,
      } as any),
    ).not.toThrow();
  });
});

describe("applyLegacyOpenClawConfigMigration (fs)", () => {
  let home: string;

  beforeEach(() => {
    home = fs.mkdtempSync(path.join(os.tmpdir(), "openclaw-mig-"));
  });
  afterEach(() => {
    fs.rmSync(home, { recursive: true, force: true });
  });

  const configPath = () => path.join(home, ".openclaw", "openclaw.json");

  function writeConfig(obj: unknown) {
    fs.mkdirSync(path.dirname(configPath()), { recursive: true });
    fs.writeFileSync(configPath(), JSON.stringify(obj));
  }
  function readConfig() {
    return JSON.parse(fs.readFileSync(configPath(), "utf8"));
  }

  it("writes the migrated config when there are changes", () => {
    writeConfig({
      channels: { [OLD_ID]: { token: "t", userId: "u" } },
      plugins: { allow: [OLD_ID] },
    });
    const changes = applyLegacyOpenClawConfigMigration({ homeDir: home });
    expect(changes.length).toBeGreaterThan(0);
    const cfg = readConfig();
    expect(cfg.channels[NEW_ID]).toEqual({ token: "t", userId: "u" });
    expect(cfg.channels[OLD_ID]).toBeUndefined();
    expect(cfg.plugins.allow).toEqual([NEW_ID]);
    // trailing newline + 2-space format
    expect(fs.readFileSync(configPath(), "utf8")).toBe(`${JSON.stringify(cfg, null, 2)}\n`);
  });

  it("does not write when there are no changes", () => {
    writeConfig({ channels: { [NEW_ID]: { token: "t" } } });
    const before = fs.statSync(configPath()).mtimeMs;
    const changes = applyLegacyOpenClawConfigMigration({ homeDir: home });
    expect(changes).toEqual([]);
    expect(fs.statSync(configPath()).mtimeMs).toBe(before);
  });

  it("is a no-op (no throw, no file) when config is absent", () => {
    expect(() => applyLegacyOpenClawConfigMigration({ homeDir: home })).not.toThrow();
    expect(applyLegacyOpenClawConfigMigration({ homeDir: home })).toEqual([]);
    expect(fs.existsSync(configPath())).toBe(false);
  });

  it("is a no-op when the config file is invalid JSON", () => {
    fs.mkdirSync(path.dirname(configPath()), { recursive: true });
    fs.writeFileSync(configPath(), "{ not json");
    expect(applyLegacyOpenClawConfigMigration({ homeDir: home })).toEqual([]);
    expect(fs.readFileSync(configPath(), "utf8")).toBe("{ not json");
  });

  it("is idempotent on re-run", () => {
    writeConfig({
      channels: { [OLD_ID]: { token: "t" } },
      plugins: { allow: [OLD_ID] },
    });
    expect(applyLegacyOpenClawConfigMigration({ homeDir: home }).length).toBeGreaterThan(0);
    expect(applyLegacyOpenClawConfigMigration({ homeDir: home })).toEqual([]);
  });
});
