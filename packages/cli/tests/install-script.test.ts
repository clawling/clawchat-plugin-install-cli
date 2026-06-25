import { chmodSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";
import { describe, expect, it } from "vitest";

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(here, "../../..");
const scriptPath = resolve(repoRoot, "scripts/install-clawchat.sh");

function makeExecutable(path: string, body: string) {
  writeFileSync(path, body, "utf8");
  chmodSync(path, 0o755);
}

function createHarness() {
  const dir = mkdtempSync(join(tmpdir(), "clawchat-install-script-"));
  const bin = join(dir, "bin");
  const log = join(dir, "commands.log");
  mkdirSync(bin);
  writeFileSync(log, "", "utf8");
  return { dir, bin, log };
}

function runScript(args: string[], bin: string, env: NodeJS.ProcessEnv = {}) {
  return spawnSync("bash", [scriptPath, ...args], {
    cwd: repoRoot,
    env: {
      ...process.env,
      ...env,
      PATH: `${bin}:/usr/bin:/bin`,
    },
    encoding: "utf8",
  });
}

describe("scripts/install-clawchat.sh", () => {
  it("describes plugin-only installation in usage text", () => {
    const { bin } = createHarness();

    const result = runScript(["--help"], bin);

    expect(result.status).toBe(0);
    expect(result.stderr).toContain("Installs, updates, or repairs ClawChat plugin support for the selected target.");
    expect(result.stderr).not.toContain("plugin and skill support");
  });

  it("requires an explicit supported target", () => {
    const { bin } = createHarness();

    const missing = runScript([], bin);
    const invalid = runScript(["codex"], bin);

    expect(missing.status).toBe(1);
    expect(missing.stderr).toContain("Usage: scripts/install-clawchat.sh <openclaw|hermes>");
    expect(invalid.status).toBe(1);
    expect(invalid.stderr).toContain("--target must be one of: openclaw, hermes");
  });

  it("runs install for the target through npx without a global clawchat CLI", () => {
    const { bin, log } = createHarness();
    makeExecutable(join(bin, "openclaw"), "#!/usr/bin/env bash\nexit 0\n");
    makeExecutable(join(bin, "npx"), `#!/usr/bin/env bash
echo "npx $*" >> "${log}"
if [[ "$1" == "-y" && "$2" == "@clawling/clawchat-plugin-install-cli@latest" && "$3" == "install" && "$4" == "--target" && "$5" == "openclaw" ]]; then
  exit 0
fi
exit 2
`);

    const result = runScript(["openclaw"], bin);

    expect(result.status).toBe(0);
    expect(readFileSync(log, "utf8")).toContain("npx -y @clawling/clawchat-plugin-install-cli@latest install --target openclaw");
  });

  it("runs update instead of install when OpenClaw plugin is already installed", () => {
    const { bin, log } = createHarness();
    makeExecutable(join(bin, "openclaw"), `#!/usr/bin/env bash
if [[ "$*" == "plugins list --json" ]]; then
  printf '%s\n' '{"plugins":[{"name":"@clawling/clawchat-plugin-openclaw","version":"0.1.0"}]}'
fi
exit 0
`);
    makeExecutable(join(bin, "npx"), `#!/usr/bin/env bash
echo "npx $*" >> "${log}"
if [[ "$1" == "-y" && "$2" == "@clawling/clawchat-plugin-install-cli@latest" && "$3" == "update" && "$4" == "--target" && "$5" == "openclaw" && "$#" == "5" ]]; then
  exit 0
fi
exit 2
`);

    const result = runScript(["openclaw"], bin);

    expect(result.status).toBe(0);
    const calls = readFileSync(log, "utf8");
    expect(calls).toContain("npx -y @clawling/clawchat-plugin-install-cli@latest update --target openclaw");
    expect(calls).not.toContain("install --target openclaw");
  });

  it("retries installed Hermes plugin updates with force when update fails", () => {
    const { bin, log } = createHarness();
    makeExecutable(join(bin, "hermes"), `#!/usr/bin/env bash
if [[ "$*" == "plugins list" ]]; then
  printf '%s\n' 'clawchat enabled 0.1.0'
fi
exit 0
`);
    makeExecutable(join(bin, "npx"), `#!/usr/bin/env bash
echo "npx $*" >> "${log}"
if [[ "$1" == "-y" && "$2" == "@clawling/clawchat-plugin-install-cli@latest" && "$3" == "update" && "$4" == "--target" && "$5" == "hermes" && "$#" == "5" ]]; then
  exit 2
fi
if [[ "$1" == "-y" && "$2" == "@clawling/clawchat-plugin-install-cli@latest" && "$3" == "update" && "$4" == "--target" && "$5" == "hermes" && "$6" == "--force" ]]; then
  exit 0
fi
exit 2
`);

    const result = runScript(["hermes"], bin);

    expect(result.status).toBe(0);
    const calls = readFileSync(log, "utf8");
    expect(calls).toContain("npx -y @clawling/clawchat-plugin-install-cli@latest update --target hermes");
    expect(calls).toContain("npx -y @clawling/clawchat-plugin-install-cli@latest update --target hermes --force");
    expect(calls).not.toContain("install --target hermes");
  });

  it("does not install the global CLI before running install", () => {
    const { bin, log } = createHarness();
    makeExecutable(join(bin, "hermes"), "#!/usr/bin/env bash\nexit 0\n");
    makeExecutable(join(bin, "npm"), `#!/usr/bin/env bash
echo "npm $*" >> "${log}"
exit 2
`);
    makeExecutable(join(bin, "npx"), `#!/usr/bin/env bash
echo "npx $*" >> "${log}"
if [[ "$1" == "-y" && "$2" == "@clawling/clawchat-plugin-install-cli@latest" && "$3" == "install" && "$4" == "--target" && "$5" == "hermes" ]]; then
  exit 0
fi
exit 2
`);

    const result = runScript(["hermes"], bin);

    expect(result.status).toBe(0);
    const calls = readFileSync(log, "utf8");
    expect(calls).not.toContain("npm install -g");
    expect(calls).toContain("npx -y @clawling/clawchat-plugin-install-cli@latest install --target hermes");
  });

  it("activates a discovered Hermes virtualenv before checking PATH", () => {
    const { dir, bin, log } = createHarness();
    const hermesBin = join(dir, ".hermes", "hermes-agent", ".venv", "bin");
    mkdirSync(hermesBin, { recursive: true });
    writeFileSync(join(hermesBin, "activate"), `PATH="${hermesBin}:$PATH"\n`, "utf8");
    makeExecutable(join(hermesBin, "hermes"), "#!/usr/bin/env bash\nexit 0\n");
    makeExecutable(join(bin, "npx"), `#!/usr/bin/env bash
echo "npx $*" >> "${log}"
if [[ "$1" == "-y" && "$2" == "@clawling/clawchat-plugin-install-cli@latest" && "$3" == "install" && "$4" == "--target" && "$5" == "hermes" ]]; then
  exit 0
fi
exit 2
`);

    const result = runScript(["hermes"], bin, { HOME: dir });

    expect(result.status).toBe(0);
    expect(readFileSync(log, "utf8")).toContain("npx -y @clawling/clawchat-plugin-install-cli@latest install --target hermes");
  });

  it("uses npx even when a stale global clawchat CLI exists", () => {
    const { bin, log } = createHarness();
    makeExecutable(join(bin, "openclaw"), "#!/usr/bin/env bash\nexit 0\n");
    makeExecutable(join(bin, "clawchat"), `#!/usr/bin/env bash
echo "old-clawchat $*" >> "${log}"
exit 2
`);
    makeExecutable(join(bin, "npx"), `#!/usr/bin/env bash
echo "npx $*" >> "${log}"
if [[ "$1" == "-y" && "$2" == "@clawling/clawchat-plugin-install-cli@latest" && "$3" == "install" && "$4" == "--target" && "$5" == "openclaw" ]]; then
  exit 0
fi
exit 2
`);

    const result = runScript(["openclaw"], bin);

    expect(result.status).toBe(0);
    const calls = readFileSync(log, "utf8");
    expect(calls).not.toContain("old-clawchat");
    expect(calls).toContain("npx -y @clawling/clawchat-plugin-install-cli@latest install --target openclaw");
  });

  it("prints a clear error when npx is missing", () => {
    const { bin } = createHarness();
    makeExecutable(join(bin, "openclaw"), "#!/usr/bin/env bash\nexit 0\n");

    const result = runScript(["openclaw"], bin);

    expect(result.status).toBe(1);
    expect(result.stderr).toContain("npx is required to run @clawling/clawchat-plugin-install-cli");
  });
});
