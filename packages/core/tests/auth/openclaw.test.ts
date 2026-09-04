import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { getOpenClawConfigPath, readOpenClawAuth } from "../../src/auth/openclaw";

const dirs: string[] = [];

function tmpHome(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "clawchat-openclaw-"));
  dirs.push(dir);
  return dir;
}

afterEach(() => {
  for (const dir of dirs.splice(0)) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

describe("readOpenClawAuth", () => {
  it("reads token, refresh token, and user id from openclaw.json", () => {
    const homeDir = tmpHome();
    const openclawDir = path.join(homeDir, ".openclaw");
    fs.mkdirSync(openclawDir, { recursive: true });
    fs.writeFileSync(
      path.join(openclawDir, "openclaw.json"),
      JSON.stringify({
        channels: {
          "clawchat-plugin-openclaw": {
            enabled: true,
            token: "access-token",
            refreshToken: "refresh-token",
            userId: "usr_agent",
          },
        },
      }),
    );

    expect(readOpenClawAuth({ homeDir })).toEqual({
      target: "openclaw",
      token: "access-token",
      refreshToken: "refresh-token",
      userId: "usr_agent",
    });
  });

  it("returns null when the config file is missing", () => {
    expect(readOpenClawAuth({ homeDir: tmpHome() })).toBeNull();
  });

  it("returns null when the clawchat channel token is missing", () => {
    const homeDir = tmpHome();
    const openclawDir = path.join(homeDir, ".openclaw");
    fs.mkdirSync(openclawDir, { recursive: true });
    fs.writeFileSync(
      path.join(openclawDir, "openclaw.json"),
      JSON.stringify({ channels: { "clawchat-plugin-openclaw": { enabled: true } } }),
    );

    expect(readOpenClawAuth({ homeDir })).toBeNull();
  });
});

describe("getOpenClawConfigPath", () => {
  // The host resolves its config as OPENCLAW_CONFIG_PATH → <OPENCLAW_STATE_DIR>/openclaw.json
  // → ~/.openclaw/openclaw.json (verified against openclaw 2026.8.2 with `openclaw config get`).
  // Hardcoding the home layout made the installer write base URLs into a file the
  // host never reads whenever the host runs with a relocated state dir.
  it("prefers OPENCLAW_CONFIG_PATH over every other location", () => {
    const homeDir = tmpHome();
    expect(
      getOpenClawConfigPath({
        homeDir,
        env: { OPENCLAW_CONFIG_PATH: "/srv/openclaw/custom.json", OPENCLAW_STATE_DIR: "/srv/state" },
      }),
    ).toBe("/srv/openclaw/custom.json");
  });

  it("falls back to openclaw.json inside OPENCLAW_STATE_DIR", () => {
    const homeDir = tmpHome();
    expect(getOpenClawConfigPath({ homeDir, env: { OPENCLAW_STATE_DIR: "/data/openclaw" } })).toBe(
      path.join("/data/openclaw", "openclaw.json"),
    );
  });

  it("falls back to the home layout when neither variable is set", () => {
    const homeDir = tmpHome();
    expect(getOpenClawConfigPath({ homeDir, env: {} })).toBe(
      path.join(homeDir, ".openclaw", "openclaw.json"),
    );
  });

  it("ignores blank environment values", () => {
    const homeDir = tmpHome();
    expect(
      getOpenClawConfigPath({ homeDir, env: { OPENCLAW_CONFIG_PATH: "  ", OPENCLAW_STATE_DIR: "" } }),
    ).toBe(path.join(homeDir, ".openclaw", "openclaw.json"));
  });
});

describe("readOpenClawAuth with a relocated state dir", () => {
  it("reads the token from the config the host actually uses", () => {
    const stateDir = tmpHome();
    fs.writeFileSync(
      path.join(stateDir, "openclaw.json"),
      JSON.stringify({
        channels: { "clawchat-plugin-openclaw": { token: "state-dir-token" } },
      }),
    );

    expect(readOpenClawAuth({ homeDir: tmpHome(), env: { OPENCLAW_STATE_DIR: stateDir } })).toMatchObject(
      { token: "state-dir-token" },
    );
  });
});
