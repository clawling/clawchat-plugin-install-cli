import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  addOpenClawPluginLoadPath,
  ensureQClawPluginLoadPath,
  findManagedOpenClawPluginDir,
  isQClawConfigPath,
  resolveActiveOpenClawConfigPath,
} from "../../src/installers/openclaw-qclaw";
import { installOpenClawPlugin, updateOpenClawPlugin } from "../../src/installers/openclaw";

// What OpenClaw's managed npm installer names the project directory for
// `@clawling/clawchat-plugin-openclaw` (`safePathSegmentHashed`): the sanitized name
// plus the first 10 hex chars of sha256 of the package name.
const PROJECT_DIR_PREFIX = "clawling-clawchat-plugin-openclaw-";

function writeManagedPackage(stateDir: string, projectDir: string): string {
  const pkgDir = path.join(
    stateDir,
    "npm",
    "projects",
    projectDir,
    "node_modules",
    "@clawling",
    "clawchat-plugin-openclaw",
  );
  fs.mkdirSync(pkgDir, { recursive: true });
  fs.writeFileSync(path.join(pkgDir, "package.json"), '{"name":"@clawling/clawchat-plugin-openclaw"}\n');
  fs.writeFileSync(path.join(pkgDir, "openclaw.plugin.json"), '{"id":"clawchat-plugin-openclaw"}\n');
  return pkgDir;
}

function readConfig(configPath: string): any {
  return JSON.parse(fs.readFileSync(configPath, "utf8"));
}

describe("isQClawConfigPath", () => {
  it("recognises the QClaw state dir on POSIX and Windows", () => {
    expect(isQClawConfigPath("/Users/alice/.qclaw/openclaw.json")).toBe(true);
    expect(isQClawConfigPath("C:\\Users\\alice\\.qclaw\\openclaw.json")).toBe(true);
    expect(isQClawConfigPath("C:\\Users\\alice\\.QClaw\\openclaw.json")).toBe(true);
  });

  it("does not mistake a stock OpenClaw config for QClaw", () => {
    expect(isQClawConfigPath("/Users/alice/.openclaw/openclaw.json")).toBe(false);
    expect(isQClawConfigPath("/srv/qclaw-notes/openclaw.json")).toBe(false);
    expect(isQClawConfigPath("/Users/alice/.qclaw/other.json")).toBe(false);
  });
});

describe("resolveActiveOpenClawConfigPath", () => {
  it("asks the host and expands a home-shortened answer", async () => {
    const capture = vi.fn(async () => "~/.qclaw/openclaw.json\n");
    await expect(resolveActiveOpenClawConfigPath(capture, { homeDir: "/Users/alice", env: {} })).resolves.toBe(
      path.join("/Users/alice", ".qclaw", "openclaw.json"),
    );
    expect(capture).toHaveBeenCalledWith("openclaw", ["config", "file"]);
  });

  it("takes the last path-looking line when the host prints banners first", async () => {
    const capture = vi.fn(async () => "🦞 OpenClaw 2026.6.5\n/Users/alice/.qclaw/openclaw.json\n");
    await expect(resolveActiveOpenClawConfigPath(capture, { homeDir: "/Users/alice", env: {} })).resolves.toBe(
      "/Users/alice/.qclaw/openclaw.json",
    );
  });

  it("falls back to the env/home resolution when the host cannot be asked", async () => {
    const capture = vi.fn(async () => {
      throw new Error("unknown command config file");
    });
    await expect(
      resolveActiveOpenClawConfigPath(capture, { homeDir: "/Users/alice", env: { OPENCLAW_STATE_DIR: "/Users/alice/.qclaw" } }),
    ).resolves.toBe(path.join("/Users/alice/.qclaw", "openclaw.json"));
  });
});

describe("findManagedOpenClawPluginDir", () => {
  let stateDir: string;
  beforeEach(() => {
    stateDir = fs.mkdtempSync(path.join(os.tmpdir(), "qclaw-state-"));
  });
  afterEach(() => {
    fs.rmSync(stateDir, { recursive: true, force: true });
  });

  it("returns the installed package directory inside the managed npm project", () => {
    const pkgDir = writeManagedPackage(stateDir, `${PROJECT_DIR_PREFIX}0123456789`);
    expect(findManagedOpenClawPluginDir(stateDir)).toBe(pkgDir);
  });

  it("prefers the most recently installed generation", () => {
    const older = writeManagedPackage(stateDir, `${PROJECT_DIR_PREFIX}0123456789`);
    const newer = writeManagedPackage(stateDir, `${PROJECT_DIR_PREFIX}0123456789__openclaw-generation__abc`);
    const past = new Date(Date.now() - 60_000);
    fs.utimesSync(path.join(older, "package.json"), past, past);
    expect(findManagedOpenClawPluginDir(stateDir)).toBe(newer);
  });

  it("ignores other packages and empty project dirs", () => {
    fs.mkdirSync(path.join(stateDir, "npm", "projects", `${PROJECT_DIR_PREFIX}deadbeef00`), { recursive: true });
    fs.mkdirSync(path.join(stateDir, "npm", "projects", "someone-else-plugin-1234567890"), { recursive: true });
    expect(findManagedOpenClawPluginDir(stateDir)).toBeNull();
  });

  it("returns null when nothing was installed through npm", () => {
    expect(findManagedOpenClawPluginDir(stateDir)).toBeNull();
  });
});

describe("addOpenClawPluginLoadPath", () => {
  let dir: string;
  let configPath: string;
  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), "qclaw-cfg-"));
    configPath = path.join(dir, "openclaw.json");
  });
  afterEach(() => {
    fs.rmSync(dir, { recursive: true, force: true });
  });

  const PLUGIN_DIR = path.join("/home/alice/.qclaw/npm/projects", `${PROJECT_DIR_PREFIX}0123456789`, "node_modules", "@clawling", "clawchat-plugin-openclaw");

  it("appends the plugin directory after QClaw's own entries and keeps the rest of the config", () => {
    fs.writeFileSync(
      configPath,
      JSON.stringify({
        gateway: { port: 18789 },
        plugins: { allow: ["clawchat-plugin-openclaw"], load: { paths: ["C:\\QClaw\\resources\\openclaw\\config\\extensions"], watch: true } },
      }),
    );

    expect(addOpenClawPluginLoadPath(configPath, PLUGIN_DIR)).toBe("added");

    const cfg = readConfig(configPath);
    expect(cfg.plugins.load.paths).toEqual(["C:\\QClaw\\resources\\openclaw\\config\\extensions", PLUGIN_DIR]);
    expect(cfg.plugins.load.watch).toBe(true);
    expect(cfg.plugins.allow).toEqual(["clawchat-plugin-openclaw"]);
    expect(cfg.gateway).toEqual({ port: 18789 });
  });

  it("is idempotent", () => {
    fs.writeFileSync(configPath, JSON.stringify({ plugins: { load: { paths: [] } } }));
    expect(addOpenClawPluginLoadPath(configPath, PLUGIN_DIR)).toBe("added");
    const first = fs.readFileSync(configPath, "utf8");
    expect(addOpenClawPluginLoadPath(configPath, PLUGIN_DIR)).toBe("present");
    expect(fs.readFileSync(configPath, "utf8")).toBe(first);
    expect(readConfig(configPath).plugins.load.paths).toEqual([PLUGIN_DIR]);
  });

  it("treats a trailing separator as the same entry", () => {
    fs.writeFileSync(configPath, JSON.stringify({ plugins: { load: { paths: [`${PLUGIN_DIR}/`] } } }));
    expect(addOpenClawPluginLoadPath(configPath, PLUGIN_DIR)).toBe("present");
  });

  it("replaces a stale entry for an older install of the same package", () => {
    const stale = path.join("/home/alice/.qclaw/npm/projects", `${PROJECT_DIR_PREFIX}0123456789__openclaw-generation__old`, "node_modules", "@clawling", "clawchat-plugin-openclaw");
    fs.writeFileSync(configPath, JSON.stringify({ plugins: { load: { paths: ["/opt/other", stale] } } }));

    expect(addOpenClawPluginLoadPath(configPath, PLUGIN_DIR)).toBe("added");
    expect(readConfig(configPath).plugins.load.paths).toEqual(["/opt/other", PLUGIN_DIR]);
  });

  it("creates the plugins.load section when it is missing", () => {
    fs.writeFileSync(configPath, JSON.stringify({ channels: { x: {} } }));
    expect(addOpenClawPluginLoadPath(configPath, PLUGIN_DIR)).toBe("added");
    const cfg = readConfig(configPath);
    expect(cfg.plugins.load.paths).toEqual([PLUGIN_DIR]);
    expect(cfg.channels).toEqual({ x: {} });
  });

  it("refuses to rewrite a config it cannot parse", () => {
    fs.writeFileSync(configPath, "{ // json5 comment\n plugins: {} }");
    expect(() => addOpenClawPluginLoadPath(configPath, PLUGIN_DIR)).toThrow();
    expect(fs.readFileSync(configPath, "utf8")).toBe("{ // json5 comment\n plugins: {} }");
  });

  it("refuses to clobber a load.paths value that is not a list", () => {
    fs.writeFileSync(configPath, JSON.stringify({ plugins: { load: { paths: "C:\\QClaw\\extensions" } } }));
    expect(() => addOpenClawPluginLoadPath(configPath, PLUGIN_DIR)).toThrow();
    expect(readConfig(configPath).plugins.load.paths).toBe("C:\\QClaw\\extensions");
  });
});

describe("ensureQClawPluginLoadPath", () => {
  let home: string;
  beforeEach(() => {
    home = fs.mkdtempSync(path.join(os.tmpdir(), "qclaw-home-"));
  });
  afterEach(() => {
    fs.rmSync(home, { recursive: true, force: true });
  });

  it("registers the managed plugin directory when the active config is QClaw's", async () => {
    const stateDir = path.join(home, ".qclaw");
    const configPath = path.join(stateDir, "openclaw.json");
    const pkgDir = writeManagedPackage(stateDir, `${PROJECT_DIR_PREFIX}0123456789`);
    fs.writeFileSync(configPath, JSON.stringify({ plugins: { load: { paths: ["/qclaw/config/extensions"] } } }));
    const capture = vi.fn(async () => `${configPath}\n`);
    const progress = vi.fn();

    await ensureQClawPluginLoadPath({ capture, homeDir: home, env: {}, onProgress: progress });

    expect(readConfig(configPath).plugins.load.paths).toEqual(["/qclaw/config/extensions", pkgDir]);
    expect(progress.mock.calls.flat().join("\n")).toMatch(/QClaw/);
    expect(progress.mock.calls.flat().join("\n")).toMatch(/doctor --fix/);
  });

  it("leaves a stock OpenClaw config alone", async () => {
    const configPath = path.join(home, ".openclaw", "openclaw.json");
    fs.mkdirSync(path.dirname(configPath), { recursive: true });
    writeManagedPackage(path.join(home, ".openclaw"), `${PROJECT_DIR_PREFIX}0123456789`);
    const original = JSON.stringify({ plugins: { load: { paths: [] } } });
    fs.writeFileSync(configPath, original);
    const capture = vi.fn(async () => `${configPath}\n`);

    await ensureQClawPluginLoadPath({ capture, homeDir: home, env: {} });

    expect(fs.readFileSync(configPath, "utf8")).toBe(original);
  });

  it("warns with the manual step instead of failing when the plugin directory is missing", async () => {
    const configPath = path.join(home, ".qclaw", "openclaw.json");
    fs.mkdirSync(path.dirname(configPath), { recursive: true });
    fs.writeFileSync(configPath, "{}");
    const capture = vi.fn(async () => `${configPath}\n`);
    const progress = vi.fn();

    await expect(ensureQClawPluginLoadPath({ capture, homeDir: home, env: {}, onProgress: progress })).resolves.toBeUndefined();

    expect(fs.readFileSync(configPath, "utf8")).toBe("{}");
    expect(progress.mock.calls.flat().join("\n")).toMatch(/plugins\.load\.paths/);
  });
});

describe("OpenClaw installer on QClaw", () => {
  let home: string;
  beforeEach(() => {
    home = fs.mkdtempSync(path.join(os.tmpdir(), "qclaw-install-"));
  });
  afterEach(() => {
    fs.rmSync(home, { recursive: true, force: true });
  });

  function qclawHost(configPath: string) {
    return vi.fn(async (_cmd: string, args: readonly string[]) => {
      const joined = args.join(" ");
      if (joined === "config get agents.defaults.workspace") return `${home}/.qclaw/workspace\n`;
      if (joined === "plugins install --help") return "Options:\n";
      if (joined === "config file") return `${configPath}\n`;
      throw new Error(`unexpected capture: ${joined}`);
    });
  }

  for (const [name, action] of [
    ["install", installOpenClawPlugin],
    ["update", updateOpenClawPlugin],
  ] as const) {
    it(`adds the plugin directory to plugins.load.paths after ${name}`, async () => {
      const stateDir = path.join(home, ".qclaw");
      const configPath = path.join(stateDir, "openclaw.json");
      fs.mkdirSync(stateDir, { recursive: true });
      fs.writeFileSync(configPath, JSON.stringify({ plugins: { load: { paths: ["/qclaw/config/extensions"] } } }));
      // The delegated `openclaw plugins install/update` is what lays the package down.
      let pkgDir = "";
      const run = vi.fn(async () => {
        pkgDir = writeManagedPackage(stateDir, `${PROJECT_DIR_PREFIX}0123456789`);
      });

      await action({ run, capture: qclawHost(configPath), homeDir: home, writeBaseUrls: vi.fn() });

      expect(readConfig(configPath).plugins.load.paths).toEqual(["/qclaw/config/extensions", pkgDir]);
    });
  }
});
