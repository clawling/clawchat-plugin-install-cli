import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { installHermesPlugin } from "../../src/installers/hermes";

let home: string;

beforeEach(() => {
  home = fs.mkdtempSync(path.join(os.tmpdir(), "hermes-profile-"));
});
afterEach(() => {
  fs.rmSync(home, { recursive: true, force: true });
});

// A minimal plugin.yaml so metadata parsing succeeds without network.
function fakeCapture() {
  return vi.fn(async (_cmd: string, args: readonly string[]) => {
    if (args.includes("--version")) return "hermes 0.13.0";
    if (args.includes("list")) return ""; // plugin not installed -> canonical install
    // fetchPluginYaml pipes a curl of plugin.yaml; return version + no requirement.
    return "version: 9.9.9\n";
  });
}

describe("hermes --profile passthrough", () => {
  it("prepends -p <profile> to delegated hermes calls and writes .env under the profile home", async () => {
    const run = vi.fn(async () => {});
    const capture = fakeCapture();

    await installHermesPlugin({
      profile: "coder",
      homeDir: home,
      apiBaseUrl: "https://api.test:39001",
      run,
      capture,
    });

    // Every delegated `hermes` run/capture for a named profile starts with -p coder.
    for (const call of [...run.mock.calls, ...capture.mock.calls]) {
      const [cmd, args] = call as [string, string[]];
      if (cmd === "hermes") {
        expect(args.slice(0, 2)).toEqual(["-p", "coder"]);
      }
    }
    // Base URLs land in the profile's HERMES_HOME, not ~/.hermes.
    const envPath = path.join(home, ".hermes", "profiles", "coder", ".env");
    expect(fs.readFileSync(envPath, "utf8")).toContain("CLAWCHAT_BASE_URL=https://api.test:39001");
  });

  it("leaves hermes calls unchanged for the default profile", async () => {
    const run = vi.fn(async () => {});
    const capture = fakeCapture();

    await installHermesPlugin({ homeDir: home, run, capture });

    for (const call of [...run.mock.calls, ...capture.mock.calls]) {
      const [cmd, args] = call as [string, string[]];
      if (cmd === "hermes") {
        expect(args[0]).not.toBe("-p");
      }
    }
  });
});
