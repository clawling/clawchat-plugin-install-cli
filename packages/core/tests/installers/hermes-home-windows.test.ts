import * as path from "node:path";
import { describe, expect, it } from "vitest";
import { resolveHermesProfileHome } from "../../src/installers/hermes-profile";
import { getHermesEnvPath } from "../../src/baseurl/write-hermes";
import { readHermesAuth } from "../../src/auth/hermes";
import * as fs from "node:fs";
import * as os from "node:os";

/**
 * Hermes' home is `%LOCALAPPDATA%\hermes` on Windows, not `~/.hermes` — see
 * `hermes_constants._get_platform_default_hermes_home`. This package hardcoded
 * the POSIX layout everywhere, so on a Windows desktop with no HERMES_HOME
 * exported the installer wrote `CLAWCHAT_BASE_URL` into `C:\Users\<u>\.hermes\`
 * (a directory Hermes never reads) and `readHermesAuth` looked for the token
 * there too — reporting "not authenticated" for a perfectly paired agent.
 */
describe("Windows Hermes home", () => {
  const homeDir = "C:\\Users\\u";
  const localAppData = "C:\\Users\\u\\AppData\\Local";
  const win = { homeDir, platform: "win32" as const };

  it("resolves the default profile under LOCALAPPDATA", () => {
    expect(resolveHermesProfileHome(undefined, { ...win, env: { LOCALAPPDATA: localAppData } })).toBe(
      path.join(localAppData, "hermes"),
    );
  });

  it("resolves a named profile under LOCALAPPDATA", () => {
    expect(
      resolveHermesProfileHome("test-connect", { ...win, env: { LOCALAPPDATA: localAppData } }),
    ).toBe(path.join(localAppData, "hermes", "profiles", "test-connect"));
  });

  it("derives the AppData layout from homeDir when LOCALAPPDATA is unset", () => {
    expect(resolveHermesProfileHome(undefined, { ...win, env: {} })).toBe(
      path.join(homeDir, "AppData", "Local", "hermes"),
    );
  });

  it("still honors an explicit HERMES_HOME", () => {
    expect(
      resolveHermesProfileHome("test-connect", {
        ...win,
        env: { LOCALAPPDATA: localAppData, HERMES_HOME: "D:\\hermes" },
      }),
    ).toBe(path.join("D:\\hermes", "profiles", "test-connect"));
  });

  it("keeps ~/.hermes on POSIX", () => {
    expect(
      resolveHermesProfileHome(undefined, { homeDir: "/home/u", platform: "linux", env: {} }),
    ).toBe(path.join("/home/u", ".hermes"));
  });

  it("points the base-url writer at the Windows home", () => {
    expect(getHermesEnvPath({ ...win, env: { LOCALAPPDATA: localAppData } })).toBe(
      path.join(localAppData, "hermes", ".env"),
    );
  });

  it("reads the token from the Windows home", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "clawchat-hermes-home-"));
    const home = path.join(root, "AppData", "Local", "hermes");
    fs.mkdirSync(home, { recursive: true });
    fs.writeFileSync(path.join(home, ".env"), "CLAWCHAT_TOKEN=windows-token\n", "utf8");

    const auth = readHermesAuth({
      homeDir: root,
      platform: "win32",
      env: { LOCALAPPDATA: path.join(root, "AppData", "Local") },
    });

    expect(auth?.token).toBe("windows-token");
  });
});
