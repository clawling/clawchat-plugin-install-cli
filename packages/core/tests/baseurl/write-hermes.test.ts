// packages/core/tests/baseurl/write-hermes.test.ts
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Wrap the fs calls whose failures these tests inject; every wrapper defaults
// to the real implementation.
vi.mock("node:fs", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:fs")>();
  return { ...actual, renameSync: vi.fn(actual.renameSync), fsyncSync: vi.fn(actual.fsyncSync) };
});
import { getHermesEnvPath, writeHermesBaseUrls } from "../../src/baseurl/write-hermes";

let home: string;

beforeEach(() => {
  home = fs.mkdtempSync(path.join(os.tmpdir(), "hermes-home-"));
});
afterEach(() => {
  vi.mocked(fs.renameSync).mockReset();
  vi.mocked(fs.fsyncSync).mockReset();
  fs.rmSync(home, { recursive: true, force: true });
});

function readEnv() {
  return fs.readFileSync(getHermesEnvPath({ homeDir: home, env: {}, platform: "linux" }), "utf8");
}

describe("writeHermesBaseUrls", () => {
  it("creates ~/.hermes/.env with KEY=value lines", () => {
    writeHermesBaseUrls(
      { CLAWCHAT_BASE_URL: "https://api.test:39001", CLAWCHAT_MEDIA_BASE_URL: "https://m.test:39003" },
      { homeDir: home, env: {}, platform: "linux" },
    );
    const text = readEnv();
    expect(text).toContain("CLAWCHAT_BASE_URL=https://api.test:39001\n");
    expect(text).toContain("CLAWCHAT_MEDIA_BASE_URL=https://m.test:39003\n");
  });

  it("replaces an existing key and preserves unrelated lines (e.g. token)", () => {
    const dir = path.join(home, ".hermes");
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, ".env"), "CLAWCHAT_TOKEN=keep\nCLAWCHAT_BASE_URL=https://old\n");
    writeHermesBaseUrls({ CLAWCHAT_BASE_URL: "https://new" }, { homeDir: home, env: {}, platform: "linux" });
    const text = readEnv();
    expect(text).toContain("CLAWCHAT_TOKEN=keep\n");
    expect(text).toContain("CLAWCHAT_BASE_URL=https://new\n");
    expect(text).not.toContain("https://old");
  });

  it("prefers HERMES_HOME/.env when set", () => {
    const hermesHome = path.join(home, "custom-hermes");
    writeHermesBaseUrls({ CLAWCHAT_BASE_URL: "https://api.test" }, { env: { HERMES_HOME: hermesHome } });
    expect(fs.readFileSync(path.join(hermesHome, ".env"), "utf8")).toContain("CLAWCHAT_BASE_URL=https://api.test\n");
  });

  it("normalizes CRLF and blank lines to clean LF output", () => {
    const dir = path.join(home, ".hermes");
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, ".env"), "\r\nCLAWCHAT_TOKEN=keep\r\n");
    writeHermesBaseUrls({ CLAWCHAT_BASE_URL: "https://api.test" }, { homeDir: home, env: {}, platform: "linux" });
    const text = readEnv();
    expect(text).not.toContain("\r");
    expect(text.startsWith("\n")).toBe(false);
    expect(text).toContain("CLAWCHAT_TOKEN=keep\n");
    expect(text).toContain("CLAWCHAT_BASE_URL=https://api.test\n");
  });

  it("is a no-op when no values are provided", () => {
    writeHermesBaseUrls({}, { homeDir: home, env: {}, platform: "linux" });
    expect(fs.existsSync(getHermesEnvPath({ homeDir: home, env: {}, platform: "linux" }))).toBe(false);
  });
  it.skipIf(process.platform === "win32")("creates a new .env owner-only (0600)", () => {
    writeHermesBaseUrls({ CLAWCHAT_BASE_URL: "https://api.test" }, { homeDir: home, env: {}, platform: "linux" });
    const envPath = getHermesEnvPath({ homeDir: home, env: {}, platform: "linux" });
    expect(fs.statSync(envPath).mode & 0o777).toBe(0o600);
  });

  it.skipIf(process.platform === "win32")("keeps the mode of an existing .env and leaves no temp files", () => {
    const dir = path.join(home, ".hermes");
    fs.mkdirSync(dir, { recursive: true });
    const envPath = path.join(dir, ".env");
    fs.writeFileSync(envPath, "CLAWCHAT_TOKEN=keep\n");
    fs.chmodSync(envPath, 0o640);
    writeHermesBaseUrls({ CLAWCHAT_BASE_URL: "https://api.test" }, { homeDir: home, env: {}, platform: "linux" });
    expect(fs.statSync(envPath).mode & 0o777).toBe(0o640);
    expect(fs.readdirSync(dir)).toEqual([".env"]);
  });

  it.skipIf(process.platform === "win32")("writes through a symlinked .env instead of replacing the link", () => {
    const dir = path.join(home, ".hermes");
    fs.mkdirSync(dir, { recursive: true });
    const real = path.join(home, "real.env");
    fs.writeFileSync(real, "CLAWCHAT_TOKEN=keep\n");
    fs.symlinkSync(real, path.join(dir, ".env"));
    writeHermesBaseUrls({ CLAWCHAT_BASE_URL: "https://api.test" }, { homeDir: home, env: {}, platform: "linux" });
    expect(fs.lstatSync(path.join(dir, ".env")).isSymbolicLink()).toBe(true);
    expect(fs.readFileSync(real, "utf8")).toContain("CLAWCHAT_BASE_URL=https://api.test\n");
  });

  it("keeps the existing .env and removes the temp file when the rename fails", () => {
    const dir = path.join(home, ".hermes");
    fs.mkdirSync(dir, { recursive: true });
    const envPath = path.join(dir, ".env");
    fs.writeFileSync(envPath, "CLAWCHAT_TOKEN=keep\n");
    vi.mocked(fs.renameSync).mockImplementationOnce(() => {
      throw Object.assign(new Error("rename failed"), { code: "EIO" });
    });
    expect(() =>
      writeHermesBaseUrls({ CLAWCHAT_BASE_URL: "https://api.test" }, { homeDir: home, env: {}, platform: "linux" }),
    ).toThrow("rename failed");
    expect(vi.mocked(fs.renameSync)).toHaveBeenCalledTimes(1);
    expect(fs.readFileSync(envPath, "utf8")).toBe("CLAWCHAT_TOKEN=keep\n");
    expect(fs.readdirSync(dir)).toEqual([".env"]);
  });

  it.skipIf(process.platform === "win32")("surfaces a directory fsync I/O error after the rename", () => {
    const real = vi.mocked(fs.fsyncSync).getMockImplementation()!;
    // First fsync is the temp file, second the directory.
    vi.mocked(fs.fsyncSync).mockImplementationOnce(real).mockImplementationOnce(() => {
      throw Object.assign(new Error("dir fsync failed"), { code: "EIO" });
    });
    expect(() =>
      writeHermesBaseUrls({ CLAWCHAT_BASE_URL: "https://api.test" }, { homeDir: home, env: {}, platform: "linux" }),
    ).toThrow("dir fsync failed");
  });

  it.skipIf(process.platform === "win32")("tolerates filesystems that cannot fsync a directory", () => {
    const real = vi.mocked(fs.fsyncSync).getMockImplementation()!;
    vi.mocked(fs.fsyncSync).mockImplementationOnce(real).mockImplementationOnce(() => {
      throw Object.assign(new Error("not supported"), { code: "EINVAL" });
    });
    writeHermesBaseUrls({ CLAWCHAT_BASE_URL: "https://api.test" }, { homeDir: home, env: {}, platform: "linux" });
    expect(readEnv()).toBe("CLAWCHAT_BASE_URL=https://api.test\n");
  });

  it.skipIf(process.platform === "win32")("follows `..` after a symlinked directory the way the kernel does", () => {
    // .hermes/sub -> ../b/c, so .hermes/sub/.. is b (not .hermes).
    const dir = path.join(home, ".hermes");
    fs.mkdirSync(path.join(home, "b", "c"), { recursive: true });
    fs.mkdirSync(dir, { recursive: true });
    fs.symlinkSync("../b/c", path.join(dir, "sub"));
    const real = path.join(home, "b", "target.env");
    fs.writeFileSync(real, "CLAWCHAT_TOKEN=keep\n");
    fs.symlinkSync("sub/../target.env", path.join(dir, ".env"));
    writeHermesBaseUrls({ CLAWCHAT_BASE_URL: "https://api.test" }, { homeDir: home, env: {}, platform: "linux" });
    expect(fs.readFileSync(real, "utf8")).toBe("CLAWCHAT_TOKEN=keep\nCLAWCHAT_BASE_URL=https://api.test\n");
    expect(fs.existsSync(path.join(dir, "target.env"))).toBe(false);
    expect(fs.lstatSync(path.join(dir, ".env")).isSymbolicLink()).toBe(true);
  });

  it.skipIf(process.platform === "win32")("creates a dangling link target behind a symlinked directory the way the kernel does", () => {
    const dir = path.join(home, ".hermes");
    fs.mkdirSync(path.join(home, "b", "c"), { recursive: true });
    fs.mkdirSync(dir, { recursive: true });
    fs.symlinkSync("../b/c", path.join(dir, "sub"));
    fs.symlinkSync("sub/../new.env", path.join(dir, ".env"));
    writeHermesBaseUrls({ CLAWCHAT_BASE_URL: "https://api.test" }, { homeDir: home, env: {}, platform: "linux" });
    expect(fs.readFileSync(path.join(home, "b", "new.env"), "utf8")).toBe("CLAWCHAT_BASE_URL=https://api.test\n");
    expect(fs.existsSync(path.join(dir, "new.env"))).toBe(false);
  });

  it.skipIf(process.platform === "win32")("creates the target of a dangling .env symlink and keeps the link", () => {
    const dir = path.join(home, ".hermes");
    fs.mkdirSync(dir, { recursive: true });
    const real = path.join(home, "secrets", "hermes.env");
    fs.mkdirSync(path.dirname(real), { recursive: true });
    fs.symlinkSync(real, path.join(dir, ".env"));
    writeHermesBaseUrls({ CLAWCHAT_BASE_URL: "https://api.test" }, { homeDir: home, env: {}, platform: "linux" });
    expect(fs.lstatSync(path.join(dir, ".env")).isSymbolicLink()).toBe(true);
    expect(fs.readFileSync(real, "utf8")).toBe("CLAWCHAT_BASE_URL=https://api.test\n");
    expect(fs.statSync(real).mode & 0o777).toBe(0o600);
  });

  it.skipIf(process.platform === "win32" || process.getuid?.() === 0)(
    "refuses to replace an existing .env it cannot read",
    () => {
      const dir = path.join(home, ".hermes");
      fs.mkdirSync(dir, { recursive: true });
      const envPath = path.join(dir, ".env");
      fs.writeFileSync(envPath, "CLAWCHAT_TOKEN=keep\n");
      fs.chmodSync(envPath, 0o200);
      try {
        expect(() =>
          writeHermesBaseUrls({ CLAWCHAT_BASE_URL: "https://api.test" }, { homeDir: home, env: {}, platform: "linux" }),
        ).toThrow();
      } finally {
        fs.chmodSync(envPath, 0o600);
      }
      expect(fs.readFileSync(envPath, "utf8")).toBe("CLAWCHAT_TOKEN=keep\n");
    },
  );

  it.skipIf(process.platform === "win32")("resolves a relative .env link from the real directory of a symlinked home", () => {
    // ~/.hermes -> profiles/a ; .env -> ../shared/hermes.env (relative to profiles/a)
    const profile = path.join(home, "profiles", "a");
    fs.mkdirSync(profile, { recursive: true });
    fs.mkdirSync(path.join(home, "profiles", "shared"), { recursive: true });
    fs.symlinkSync(profile, path.join(home, ".hermes"));
    fs.symlinkSync("../shared/hermes.env", path.join(profile, ".env"));
    writeHermesBaseUrls({ CLAWCHAT_BASE_URL: "https://api.test" }, { homeDir: home, env: {}, platform: "linux" });
    expect(fs.readFileSync(path.join(home, "profiles", "shared", "hermes.env"), "utf8")).toBe(
      "CLAWCHAT_BASE_URL=https://api.test\n",
    );
    expect(fs.existsSync(path.join(home, "shared"))).toBe(false);
    expect(fs.lstatSync(path.join(profile, ".env")).isSymbolicLink()).toBe(true);
  });

});
