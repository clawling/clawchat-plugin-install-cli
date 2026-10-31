import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { installHermesPlugin } from "@clawling/clawchat-plugin-install-core";
import { runCommand, type CommandRunner } from "../../core/src/installers/run";
import { runClawchatCli } from "../src/cli";
import { assertNoSecrets, createCapturingIo, PLACEHOLDER_SECRETS } from "./helpers/assert-no-secrets";

let home: string;
beforeEach(() => {
  home = fs.mkdtempSync(path.join(os.tmpdir(), "secret-outputs-"));
  for (const name of ["HTTPS_PROXY", "https_proxy", "HTTP_PROXY", "http_proxy", "ALL_PROXY", "all_proxy", "CLAWCHAT_INSTALL_TIMEOUT_SECONDS"]) {
    vi.stubEnv(name, undefined as unknown as string);
  }
});
afterEach(() => {
  vi.unstubAllEnvs();
  fs.rmSync(home, { recursive: true, force: true });
});

function reports(stdout: string, stderr: string) {
  return `${stdout}${stderr}`.split("\n").filter(line => line.startsWith("CLAWCHAT_REPORT:")).join("\n");
}

// Match an already-installed plugin so only activation uses the child runner.
const yaml = 'manifest_version: 1\nname: clawchat\nkind: platform\nversion: 0.1.1\nrequires:\n  hermes: ">=0.12.0"\n';
const capture = async (_cmd: string, args: readonly string[]) => args.includes("--version")
  ? "Hermes v0.22.5" : "│ clawchat │ enabled │ 0.1.1 │ ClawChat │ git │";

it.each(["nonzero", "timeout", "success"] as const)("keeps credentials out of CLI stdout, stderr, reports and forwarded output after %s", async (scenario) => {
  const io = createCapturingIo("", true);
  const activationCode = PLACEHOLDER_SECRETS.activationCode;
  const run: CommandRunner = async (_cmd, args, options) => {
    if (!args.includes("activate")) return;
    // Profile prefixing must preserve the secret's position in transport argv.
    const codeIndex = args.indexOf("activate") + 1;
    expect(options?.secretArgs).toEqual([codeIndex]);
    const childArgs = ["-e", scenario === "timeout"
      ? "require('node:fs').writeSync(2,process.argv[1]);setTimeout(()=>{},10000)"
      : scenario === "nonzero"
        ? "require('node:fs').writeSync(2,process.argv[1]);require('node:fs').writeSync(1,process.argv[1]);process.exit(1)"
        : "require('node:fs').writeSync(1,process.argv[1])", args[codeIndex]!];
    // The child script replaces the Hermes argv prefix, keeping the same secret value.
    await runCommand("node", childArgs, { ...options, secretArgs: [2], timeoutMs: scenario === "timeout" ? 100 : 5000 });
  };
  try {
    const exit = await runClawchatCli(["install", "--target", "hermes", "--profile", "example", "--activate", activationCode], {
      ...io.io,
      installHermesPlugin: options => installHermesPlugin({
        ...options, homeDir: home, writeBaseUrls: () => undefined, run, capture,
        fetchFn: async () => new Response(yaml),
      }),
    });
    expect(exit).toBe(scenario === "success" ? 0 : 1);
    assertNoSecrets({
      stdout: io.stdout, stderr: io.stderr, reports: reports(io.stdout, io.stderr),
      processStdout: io.processStdout, processStderr: io.processStderr,
    });
    expect(io.stdout).toContain("activating ClawChat with the provided code");
    if (scenario === "success") {
      expect(io.stdout).toContain("activation complete");
      expect(io.processStdout).toBe("<redacted>");
      expect(io.stdout).toContain("CLAWCHAT_REPORT: plugin_activated");
    } else {
      expect(io.stderr).toContain("<redacted>");
      expect(io.stderr).toContain(`CLAWCHAT_REPORT: plugin_activate_failed:${scenario === "timeout" ? "timeout" : "other"}`);
      expect(io.stdout).toContain("CLAWCHAT_REPORT: plugin_installed");
    }
  } finally { io.restore(); }
});

it("reports the outlet and secret name without disclosing the value", () => {
  let message = "";
  try { assertNoSecrets({ stderr: PLACEHOLDER_SECRETS.accessToken }); } catch (err) { message = (err as Error).message; }
  expect(message).toBe("stderr contains placeholder secret accessToken");
  assertNoSecrets({ assertionMessage: message });
});
