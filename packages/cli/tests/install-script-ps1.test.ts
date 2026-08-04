import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";
import { describe, expect, it } from "vitest";

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(here, "../../..");
const bashScript = readFileSync(resolve(repoRoot, "scripts/install-clawchat.sh"), "utf8");
const psScriptPath = resolve(repoRoot, "scripts/install-clawchat.ps1");
const psScript = readFileSync(psScriptPath, "utf8");

function hasPwsh(): boolean {
  for (const exe of ["pwsh", "powershell"]) {
    if (spawnSync(exe, ["-NoProfile", "-Command", "exit 0"], { encoding: "utf8" }).status === 0) {
      return true;
    }
  }
  return false;
}

/**
 * The PowerShell script is the Windows twin of the bash one and the two are
 * published side by side to R2. They cannot share code, so the only thing
 * keeping them from drifting is this: every user-visible string and every
 * package identifier must appear in both. A change to one that forgets the
 * other fails here rather than shipping a Windows script that installs the
 * wrong spec or prints different usage.
 */
describe("scripts/install-clawchat.ps1 <-> install-clawchat.sh parity", () => {
  const shared = [
    // Package identifiers — a drift here installs the wrong thing.
    "@clawling/clawchat-plugin-install-cli@latest",
    "@clawling/clawchat-plugin-openclaw",
    // Usage text.
    "Installs, updates, or repairs ClawChat plugin support for the selected target.",
    "The script does not install a global clawchat CLI. It runs the latest CLI with npx.",
    // Diagnostics and outcomes.
    "--target must be one of: openclaw, hermes",
    "npx is required to run @clawling/clawchat-plugin-install-cli",
    "Update failed; retrying with --force.",
    "Update completed.",
    "Forced update completed.",
    "Install completed.",
  ];

  it.each(shared)("both scripts carry %j", (text) => {
    expect(bashScript, "missing from install-clawchat.sh").toContain(text);
    expect(psScript, "missing from install-clawchat.ps1").toContain(text);
  });

  it("keeps the usage line pointing at its own filename", () => {
    expect(bashScript).toContain("Usage: scripts/install-clawchat.sh <openclaw|hermes>");
    expect(psScript).toContain("Usage: install-clawchat.ps1 <openclaw|hermes>");
  });

  it("uses the Windows venv layout, never the POSIX one", () => {
    expect(psScript).toContain(".venv\\Scripts");
    expect(psScript).not.toContain(".venv/bin");
  });

  it("declares no script-level param() block, so `--help` reaches \\$args instead of failing to bind", () => {
    // Script-level param() sits at column 0; the function-level ones are
    // indented and are fine — only the former triggers parameter binding on
    // the script's own arguments.
    expect(psScript).not.toMatch(/^param\s*\(/m);
    expect(psScript).toContain("$args");
  });
});

/**
 * Behavioural coverage. Only the paths that need no fake binaries on PATH —
 * enough to prove the script parses, its usage/exit-code contract matches bash,
 * and PowerShell does not choke on `--help`.
 *
 * Skipped wherever PowerShell is absent, which includes the Linux dev box this
 * was written on: treat a green run here as evidence only when it did not skip.
 */
describe.skipIf(!hasPwsh())("scripts/install-clawchat.ps1 behaviour", () => {
  const exe = spawnSync("pwsh", ["-NoProfile", "-Command", "exit 0"]).status === 0 ? "pwsh" : "powershell";

  function runScript(args: string[]) {
    return spawnSync(exe, ["-NoProfile", "-ExecutionPolicy", "Bypass", "-File", psScriptPath, ...args], {
      cwd: repoRoot,
      encoding: "utf8",
    });
  }

  it("prints usage and exits 0 for --help", () => {
    for (const flag of ["-h", "--help"]) {
      const result = runScript([flag]);
      expect(result.status, `${flag} should exit 0`).toBe(0);
      expect(result.stderr).toContain(
        "Installs, updates, or repairs ClawChat plugin support for the selected target.",
      );
    }
  });

  it("requires an explicit supported target", () => {
    const missing = runScript([]);
    const invalid = runScript(["codex"]);

    expect(missing.status).toBe(1);
    expect(missing.stderr).toContain("Usage: install-clawchat.ps1 <openclaw|hermes>");
    expect(invalid.status).toBe(1);
    expect(invalid.stderr).toContain("--target must be one of: openclaw, hermes");
  });
});
