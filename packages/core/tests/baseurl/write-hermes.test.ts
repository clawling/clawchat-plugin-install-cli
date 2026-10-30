// packages/core/tests/baseurl/write-hermes.test.ts
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { getHermesEnvPath, writeHermesBaseUrls } from "../../src/baseurl/write-hermes";

let home: string;

beforeEach(() => {
  home = fs.mkdtempSync(path.join(os.tmpdir(), "hermes-home-"));
});
afterEach(() => {
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

  it.skipIf(process.platform === "win32")("removes the temp file and keeps the target when the rename fails", () => {
    const dir = path.join(home, ".hermes");
    // A non-empty directory at the .env path makes the final rename fail.
    const envPath = path.join(dir, ".env");
    fs.mkdirSync(envPath, { recursive: true });
    fs.writeFileSync(path.join(envPath, "keep"), "x");
    expect(() =>
      writeHermesBaseUrls({ CLAWCHAT_BASE_URL: "https://api.test" }, { homeDir: home, env: {}, platform: "linux" }),
    ).toThrow();
    expect(fs.readdirSync(dir)).toEqual([".env"]);
    expect(fs.readdirSync(envPath)).toEqual(["keep"]);
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

});
