import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { PROGRESS_REPORT_REASONS } from "@clawling/clawchat-plugin-install-core";

const INSTALL_MD = resolve(__dirname, "../../../install.md");
const PROTOCOL_MD = resolve(__dirname, "../../../docs/agent-protocol.md");
const WIKI_START = "https://agent-connection.clawling.com/start.md";

describe("published runtime guides", () => {
  const install = readFileSync(INSTALL_MD, "utf8");
  const protocol = readFileSync(PROTOCOL_MD, "utf8");

  it("install.md routes problems to the wiki field report, not to an issue tracker", () => {
    const header = install.split("\n").slice(0, 12).join("\n");
    expect(header).toContain(`${WIKI_START} Appendix B`);
    expect(header).not.toMatch(/open an issue|report an issue|github\.com\/.*\/issues/i);
  });

  it("install.md tells the agent how to hand the wiki version to the plugin", () => {
    expect(install).toContain("CLAWCHAT_WIKI_VERSION");
    expect(install).toContain("$env:CLAWCHAT_WIKI_VERSION");
  });

  it("agent-protocol.md header routes problems to the wiki field report", () => {
    const header = protocol.split("\n").slice(0, 9).join("\n");
    expect(header).toContain(`${WIKI_START} Appendix B`);
    expect(header).not.toMatch(/as an issue/);
  });

  it("neither guide's install-time content carries an internal host or port", () => {
    // install.md is checked in full; docs/agent-protocol.md on its header only
    // (the same 9-line window as the previous test), since its body is a
    // protocol reference. Internal service names are deliberately not listed
    // here: spelling them out would put them in this public repo. The
    // maintainers' pre-commit redaction check covers them on every added line.
    const protocolHeader = protocol.split("\n").slice(0, 9).join("\n");
    for (const text of [install, protocolHeader]) {
      expect(text).not.toMatch(/:(8931|39002|10086)\b/);
      expect(text).not.toMatch(/\b(nest|company)\.[a-z0-9-]+\.(com|cn|net)\b/i);
    }
  });

  it("install.md leaves a scanner refusal to the owner and never steers a failed install to --force", () => {
    const scanner = install.split("- **The host's scanner blocked the install")[1]?.split("\n- **")[0] ?? "";
    expect(scanner).toMatch(/owner\s+explicitly\s+approves/);
    expect(scanner).toMatch(/Never\s+override it on your own/);
    expect(scanner).toMatch(/mirror/);
    const installFails = install.split("- **Install fails (step 2).**")[1]?.split("\n- **")[0] ?? "";
    expect(installFails).not.toMatch(/fall back to|\[update `--force`\]/);
    expect(install).not.toMatch(/then fall back to\s+\[update `--force`\]/);
  });

  it("install.md treats Hermes' [y/N] scan prompt as the owner's to answer, never the agent's", () => {
    const scanner = install.split("- **The host's scanner blocked the install")[1]?.split("\n- **")[0] ?? "";
    expect(scanner).toContain("Install anyway?");
    expect(scanner).toContain("clawling/clawchat-plugin-hermes-agent");
    expect(scanner).toMatch(/\*\*owner\*\*\s+answers\s+`y`/);
    expect(scanner).toMatch(/only\s+when\s+the\s+owner\s+explicitly\s+tells\s+you\s+to/);
    expect(scanner).toMatch(/don't\s+type\s+`y`\s+yourself/);
    expect(scanner).toMatch(/Unattended\s+install/);
    expect(scanner).toMatch(/rather\s+than\s+forcing/);
    const step2 = install.split("## 2. Install")[1]?.split("\n## 3.")[0] ?? "";
    expect(step2).toMatch(/expected\s+for\s+this\s+plugin/);
    expect(step2).toMatch(/don't\s+answer\s+the\s+prompt/);
  });

  it("install.md step 4 makes the agent verify the gateway actually restarted", () => {
    const step4 = install.split("## 4. Restart the agent")[1]?.split("\n## 5.")[0] ?? "";
    expect(step4).toContain("verify the gateway actually restarted");
    expect(step4).toContain("proves nothing");
    expect(step4).toContain("hermes gateway status");
    expect(step4).toContain("not the plugin's greeting");
  });

  it("install.md step 4 probes OpenClaw before asking the user to restart", () => {
    const step4 = install.split("## 4. Restart the agent")[1]?.split("\n## 5.")[0] ?? "";
    const probe = step4.indexOf("**OpenClaw: probe first.**");
    const required = step4.indexOf("**Required for Hermes, and for OpenClaw when that probe did not show the\nchannel connected.**");
    const askUser = step4.indexOf("**ask the user to restart the agent themselves**");
    expect(probe).toBeGreaterThanOrEqual(0);
    expect(required).toBeGreaterThan(probe);
    expect(askUser).toBeGreaterThan(required);
    const probeBlock = step4.slice(probe, required);
    expect(probeBlock).toContain("openclaw channels status --probe");
    expect(probeBlock).toMatch(/running\s+and\s+connected,\s+no\s+restart\s+is\s+needed\s+-\s+skip\s+to\s+step\s+5/);
    expect(probeBlock).toMatch(/If\s+it\s+does\s+not,\s+the\s+restart\s+below\s+is\s+required/);
    expect(step4).not.toMatch(/^\*\*Required\.\*\*/m);
  });

  it("install.md sends a Hermes without `hermes clawchat` to the activation guide, not a shell python", () => {
    const step3 = install.split("## 3. Activate")[1]?.split("\n## 4.")[0] ?? "";
    expect(step3).toContain("https://github.com/clawling/clawchat-plugin-hermes-agent/blob/main/docs/activation.md");
    expect(step3).toMatch(/no\s+`hermes clawchat`\s+command\s+\(Hermes\s+v0\.12\.0\)/);
    expect(install).not.toContain("clawchat_cli.py");
    expect(install).not.toContain("PyYAML");
    expect(install).not.toMatch(/0\.12 fallback/);
  });

  it("install.md documents the Hermes install timeout flag the CLI accepts", () => {
    const troubleshooting = install.split("## Troubleshooting")[1] ?? "";
    expect(troubleshooting).toContain("--install-timeout 300");
    expect(troubleshooting).toContain("CLAWCHAT_INSTALL_TIMEOUT_SECONDS=300");
  });

  it("install.md tells a QClaw user how the plugin gets onto plugins.load.paths", () => {
    const qclaw = install.split("- **OpenClaw inside QClaw")[1]?.split("\n- **")[0] ?? "";
    expect(qclaw).toContain("plugin not found");
    expect(qclaw).toContain("~/.qclaw/openclaw.json");
    expect(qclaw).toContain("plugins.load.paths");
    expect(qclaw).toContain("node_modules/@clawling/clawchat-plugin-openclaw");
    expect(qclaw).toContain("openclaw doctor --fix");
  });

  it("install.md reads active_profile from the Hermes root even when HERMES_HOME is a named profile", () => {
    const section = install.split("**Hermes with more than one profile**")[1] ?? "";
    const bash = section.match(/```bash\n([\s\S]*?)```/)?.[1] ?? "";
    expect(bash).toContain("active_profile");
    const root = mkdtempSync(join(tmpdir(), "hermes-root-"));
    const profile = join(root, "profiles", "coder");
    const bin = join(root, "bin");
    mkdirSync(profile, { recursive: true });
    mkdirSync(bin);
    writeFileSync(join(root, "active_profile"), "coder\n");
    writeFileSync(join(bin, "hermes"), "#!/bin/sh\nexit 0\n", { mode: 0o755 });
    const out = execFileSync("bash", ["-c", bash], {
      env: { PATH: `${bin}:${process.env.PATH}`, HOME: root, HERMES_HOME: profile },
      encoding: "utf8",
    });
    expect(out.split("\n")).toContain("coder");
    expect(out).not.toContain("active_profile=default");

    const powershell = section.match(/```powershell\n([\s\S]*?)```/)?.[1] ?? "";
    expect(powershell).toContain("Join-Path $root 'active_profile'");
    expect(powershell).toContain("$root -match '[\\\\/]profiles[\\\\/]");
  });

  it("install.md says where the wiki version actually is (response header / trailing comment)", () => {
    expect(install).not.toContain("shown at the top of that page");
    expect(install).toContain("X-Wiki-Version");
    expect(install).toContain("<!-- clawchat-wiki <version> -->");
  });
});

const readSkill = (target: string, id: string) =>
  readFileSync(resolve(__dirname, `../../../skills/${target}/${id}/SKILL.md`), "utf8");

describe("bundled clawchat-core skills", () => {
  const SKILLS = ["hermes", "openclaw"].map((t) => readSkill(t, "clawchat-core"));
  it("route reconnects and reports to the wiki, and no longer name retired app screens", () => {
    for (const text of SKILLS) {
      expect(text).toContain("https://agent-connection.clawling.com/reconnect.md");
      expect(text).toContain("https://agent-connection.clawling.com/start.md");
      expect(text).not.toContain("注册 Agent");
      expect(text).not.toContain("创建新身份");
    }
  });

  it("keep onboarding.json per Hermes profile and in the OS home on OpenClaw", () => {
    expect(readSkill("openclaw", "clawchat-core")).toContain("~/clawchat/onboarding.json");
    const hermes = readSkill("hermes", "clawchat-core");
    expect(hermes).toContain("`<agent_files_dir>/onboarding.json`");
    expect(hermes).toContain("## ClawChat Agent Files");
    expect(hermes).toContain('"${HERMES_HOME:-$HOME/.hermes}/clawchat/onboarding.json"');
    expect(hermes).toContain("Join-Path $env:LOCALAPPDATA 'hermes'");
    expect(hermes).not.toContain("write it to `~/clawchat/onboarding.json`");
  });

  it.each(["named profile", "unset HERMES_HOME"])("read Hermes active_profile from the root with %s", (scenario) => {
    const section = readSkill("hermes", "clawchat-core").split("### Target the right Hermes profile")[1] ?? "";
    const bash = section.match(/```bash\n([\s\S]*?)```/)?.[1] ?? "";
    expect(bash).toContain('cat "$root/active_profile"');
    const home = mkdtempSync(join(tmpdir(), "hermes skill home-"));
    try {
      const named = scenario === "named profile";
      const root = join(home, named ? "custom root" : ".hermes");
      const profile = join(root, "profiles", "example");
      const bin = join(home, "bin");
      mkdirSync(profile, { recursive: true });
      mkdirSync(bin);
      writeFileSync(join(root, "active_profile"), "root-profile\n");
      writeFileSync(join(profile, "active_profile"), "wrong-profile\n");
      if (named) {
        mkdirSync(join(home, ".hermes"));
        writeFileSync(join(home, ".hermes", "active_profile"), "wrong-root\n");
      }
      writeFileSync(join(bin, "hermes"), '#!/bin/sh\n[ "$*" = "profile list" ]\n', { mode: 0o755 });
      const out = execFileSync("bash", ["-c", bash], {
        env: {
          PATH: `${bin}:${process.env.PATH}`,
          HOME: home,
          ...(named ? { HERMES_HOME: profile } : {}),
        },
        stdio: ["ignore", "pipe", "pipe"],
        encoding: "utf8",
      });
      expect(out.split("\n")).toContain("root-profile");
      expect(out).not.toMatch(/wrong-profile|wrong-root|active_profile=default/);
    } finally {
      rmSync(home, { recursive: true, force: true });
    }
  });

  it("resolve the Hermes PowerShell active_profile at the root above a named profile", () => {
    const section = readSkill("hermes", "clawchat-core").split("### Target the right Hermes profile")[1] ?? "";
    const powershell = section.match(/```powershell\n([\s\S]*?)```/)?.[1] ?? "";
    expect(powershell).toContain("if ($env:HERMES_HOME) { $env:HERMES_HOME } else { Join-Path $env:LOCALAPPDATA 'hermes' }");
    expect(powershell).toContain("$root -match '[\\\\/]profiles[\\\\/][^\\\\/]+$'");
    expect(powershell).toContain("$root = Split-Path (Split-Path $root -Parent) -Parent");
    expect(powershell).toContain("$active = Join-Path $root 'active_profile'");
    expect(powershell).toContain("if (Test-Path $active) { Get-Content $active } else { 'active_profile=default' }");
  });

  it("activate a new OpenClaw agent with an unused named account and route its normalized id", () => {
    const text = readSkill("openclaw", "clawchat-core");
    const row = text.split("\n").find((line) => line.startsWith("| The owner wants a **new agent**")) ?? "";
    expect(row).toContain("Create a separate OpenClaw agent");
    expect(row).toContain("new, unused named ClawChat account");
    expect(row).toContain("`/clawchat-activate <CODE> --account <name>`");
    expect(row).toContain("`openclaw channels add --channel clawchat-plugin-openclaw --account <name> --token <CODE>`");
    expect(row).toContain("`bindings[].match.accountId` with that account's normalized id");
    expect(row).toContain("normalized to lowercase with characters outside `a-z0-9_-` replaced by `-`");
    expect(row).toContain("Leave the current account untouched; do not use `--new-account`");
  });

  it("let Hermes send a file to another conversation via clawchat_send_file, not send_message", () => {
    const hermes = readSkill("hermes", "clawchat-core");
    expect(hermes).toMatch(/call `clawchat_send_file` with `chat_id`/);
    expect(hermes).toMatch(/Owner says "send this file to group X"/);
    expect(hermes).toMatch(/`clawchat_mention_message` is \*\*text only\*\*/);
    expect(hermes).toMatch(/then `clawchat_send_file` to the same `chat_id` in the same turn/);
    expect(hermes).toContain("`as_document: true`");
    expect(hermes).not.toContain('target: "clawchat:cnv_<id>"');
    expect(hermes).not.toMatch(/call Hermes `send_message`/);
    expect(hermes).not.toContain("only supported way to attach media");
  });

  it("say an approved receipt is done and only approved_retry calls again", () => {
    for (const text of SKILLS) {
      expect(text).toMatch(/\*\*`approved`\*\* — the server already carried out the operation/);
      expect(text).toMatch(/do not call it again/);
      expect(text).toMatch(/\*\*`approved_retry`\*\* — the only outcome that asks you to call again/);
      expect(text).toMatch(/receipt's `result`/);
    }
  });

  it("teach widget/v1 the same way on both hosts: one tool, explicit request, full snapshots, design, removal, taps and resend", () => {
    const widgetSection = (text: string) =>
      text.split("## Home-screen widgets (widget/v1)")[1]?.split(/\n## /)[0] ?? "";
    const [hermes, openclaw] = SKILLS.map(widgetSection);
    expect(hermes).not.toBe("");
    expect(hermes).toBe(openclaw);
    for (const text of SKILLS) {
      expect(text).toMatch(/^description: .*updating the owner's home-screen widgets/m);
    }
    expect(hermes).toContain("You write it with `clawchat_widget_send`");
    expect(hermes).toContain("Send one only after your partner asked for a widget");
    expect(hermes).toContain("Every message is the full snapshot, never a diff; the latest one per `id` wins.");
    expect(hermes).toContain("It only ever goes to your private chat with them.");
    // Behaviour sections come before the format reference, in this order, so a
    // host that truncates long tool results still keeps them.
    const headings = [...(hermes ?? "").matchAll(/^### (.+)$/gm)].map((m) => m[1]);
    expect(headings).toEqual([
      "When to send",
      "When to update",
      "Design",
      "Layouts",
      "Removing one",
      "Document",
      "Blocks",
      "Actions: `{\"do\": …}`",
      "Data that changes by itself",
      "What comes back",
    ]);
    expect(hermes).toContain('send `{"v": 1, "id": "todo", "removed": true}` with its `id`');
    for (const line of [
      '[widget todo] checked "Pay rent" (t1)',
      '[widget todo] turned on "Focus" (f1)',
      '[widget todo] pressed "Refresh" (b1)',
      "[widget todo] capture: buy milk",
      "[widget todo] resend",
      "[widget todo] removed",
    ]) {
      expect(hermes).toContain(line);
    }
    expect(hermes).toContain(
      "apply each in order, they are not duplicates. Then send one new full snapshot, except after `removed`: send nothing for that widget (see Removing one).",
    );
    expect(hermes).toContain('`capture`: opens your chat with "<title>: " already typed; what they add reaches you as an ordinary message.');
    expect(hermes).not.toContain("quick-entry box");
    expect(hermes).toContain("`resend` means a device lost the widget: send the latest snapshot again.");
  });

  it("let moment images be an http(s) URL or an absolute local path, with no phantom upload tool", () => {
    for (const text of SKILLS) {
      expect(text).toMatch(/`images` (entry )?(of `clawchat_create_moment` )?is an http\(s\) URL or an absolute local file path/);
      expect(text).not.toContain("moment-image tools");
      expect(text).not.toContain("upload local images first");
    }
  });
});

describe("per-host greeting and liveware skills", () => {
  it.each(["openclaw", "hermes"])("prefer PATH then the downloaded CLI and use LIVEWARE_BIN throughout on %s", (target) => {
    const text = readSkill(target, "clawchat-liveware");
    const prerequisites = (text.split("## Prerequisites — check first, stop if unmet")[1]?.split("\n2. Authentication")[0] ?? "")
      .replace(/\s+/g, " ");
    expect(prerequisites).toContain("Resolve the CLI from PATH first with `command -v liveware`");
    expect(prerequisites).toContain("`Get-Command liveware -CommandType Application -ErrorAction SilentlyContinue`");
    const cacheRoot = target === "openclaw" ? "<stateDir>" : "<cacheRoot>";
    expect(prerequisites).toContain(`If absent, check the plugin's downloaded executable at \`${cacheRoot}/clawchat/liveware/liveware\``);
    expect(prerequisites).toContain("(`liveware.exe` on native Windows)");
    expect(prerequisites).toContain("Save the found executable's absolute path as `LIVEWARE_BIN`");
    expect(prerequisites).toContain("Only if neither PATH nor the downloaded copy provides an executable, tell the user this environment does not support liveware app hosting and STOP");
    expect(prerequisites).toContain("Do not attempt any further step or invent a URL");
    expect(prerequisites).toContain('Use `"$LIVEWARE_BIN"` for every CLI command');
    expect(prerequisites).toContain("in PowerShell invoke it as `& $LIVEWARE_BIN`");
    const commands = [...text.matchAll(/`((?:liveware|"\$LIVEWARE_BIN") (?:app|tunnel|status)\b[^`]*)`/g)].map((m) => m[1]!);
    expect(commands.length).toBeGreaterThan(10);
    for (const command of commands) {
      expect(command, command).toMatch(/^"\$LIVEWARE_BIN" /);
    }
  });

  it("resolve the OpenClaw CLI cache by state/config/home precedence and share it across accounts", () => {
    const text = readSkill("openclaw", "clawchat-liveware").replace(/\s+/g, " ");
    expect(text).toContain("first non-empty setting: `OPENCLAW_STATE_DIR`, then the parent directory of `OPENCLAW_CONFIG_PATH`, then `$OPENCLAW_HOME/.openclaw`, else `~/.openclaw` under the OS home");
    expect(text).toContain("Expand a leading `~` in the state/config overrides against the effective home (`OPENCLAW_HOME`, else the OS home)");
    expect(text).toContain("The binary cache is shared by all accounts; do not look under `clawchat/accounts/<id>` for it");
  });

  it("resolve the Hermes CLI cache from the plugin process home rather than the served profile", () => {
    const text = readSkill("hermes", "clawchat-liveware").replace(/\s+/g, " ");
    expect(text).toContain("`<cacheRoot>` is the **plugin process's** `HERMES_HOME`, or that process's OS home plus `.hermes` if unset");
    expect(text).toContain("matching the CLI cache resolver even on Windows");
    expect(text).toContain("This cache is process-wide under a multiplexing gateway; do not derive it from `agent_files_dir` or substitute the served profile's home for the process home");
  });

  it("resolve the OpenClaw sample and config from state overrides and the current normalized account", () => {
    const text = readSkill("openclaw", "clawchat-liveware-sample").replace(/\s+/g, " ");
    expect(text).toContain("taking the first non-empty value in this order: 1. `OPENCLAW_STATE_DIR`. 2. The parent directory of `OPENCLAW_CONFIG_PATH`. 3. `$OPENCLAW_HOME/.openclaw` when `OPENCLAW_HOME` is set. 4. `~/.openclaw` under the OS home otherwise");
    expect(text).toContain("Expand a leading `~` in the state/config overrides against the effective home (`OPENCLAW_HOME`, else the OS home)");
    expect(text).toContain("`OPENCLAW_HOME` replaces the home directory, not the state directory");
    expect(text).toContain("Do not select a directory merely because it exists");
    expect(text).toContain("`<stateDir>/clawchat/liveware-sample` for the `default` account");
    expect(text).toContain("`<stateDir>/clawchat/accounts/<id>/liveware-sample` for a named account");
    expect(text).toContain("current account's normalized id, not its display name or another account's tree");
    expect(text).toContain("Edit `OPENCLAW_CONFIG_PATH` when set, otherwise `<stateDir>/openclaw.json`, resolving `<stateDir>` and a leading `~` as above");
  });

  it("resolve the Hermes sample and config from agent_files_dir or the current absolute profile home", () => {
    const text = readSkill("hermes", "clawchat-liveware-sample").replace(/\s+/g, " ");
    expect(text).toContain("Prefer `<agent_files_dir>/liveware-sample`, using the absolute `agent_files_dir`");
    expect(text).toContain("from the `## ClawChat Agent Files` section");
    expect(text).toContain("Without that context, use `$HERMES_HOME/clawchat/liveware-sample` for the current profile");
    expect(text).toContain("default root is `~/.hermes` on POSIX or `%LOCALAPPDATA%\\hermes` on native Windows");
    expect(text).toContain("a named profile's `HERMES_HOME` is `<root>/profiles/<name>`");
    expect(text).toContain("Never build the path from `~` yourself or select the default profile because its directory exists");
    expect(text).toContain("tools may have `HOME=$HERMES_HOME/home`; use the supplied absolute profile path instead");
    expect(text).toContain("Edit the current profile's `$HERMES_HOME/config.yaml`");
    expect(text).toContain("If using `agent_files_dir`, this is `config.yaml` in its parent directory; never build this path from `~`");
  });

  it("point Hermes greetings at the profile's HERMES_HOME and OpenClaw's at ~/clawchat", () => {
    const hermes = readSkill("hermes", "clawchat-set-greeting");
    expect(hermes).toContain("$HERMES_HOME/clawchat/");
    expect(hermes).toMatch(/default profile only/i);
    expect(hermes).toMatch(/Named profiles never fall back/);
    expect(hermes).not.toContain("`~/clawchat/greeting.md` (the");
    expect(hermes).toContain("`agent_files_dir: <absolute path>`");
    expect(hermes).toMatch(/empty\s+file resets to the built-in prompt/);
    const openclaw = readSkill("openclaw", "clawchat-set-greeting");
    expect(openclaw).toContain("~/clawchat/greeting.md");
    expect(openclaw).toContain("~/clawchat/friend-greeting.md");
  });

  it("make every Hermes liveware command name the agent's own account", () => {
    const hermes = readSkill("hermes", "clawchat-liveware");
    const commands = [...hermes.matchAll(/`((?:liveware|"\$LIVEWARE_BIN") (?:app|tunnel|status)\b[^`]*)`/g)].map((m) => m[1]!);
    expect(commands.length).toBeGreaterThan(10);
    // Bare subcommand names in prose (e.g. "if `liveware app inspect` is rejected") are not commands.
    const runnable = commands.filter((c) => /\s(<|"|http|--)/.test(c) || /^(?:liveware|"\$LIVEWARE_BIN") (app list|status)$/.test(c));
    for (const command of runnable) {
      expect(command, command).toMatch(/--account <account>$/);
    }
    expect(hermes).toContain("clawchat_liveware_login");
    expect(hermes).toMatch(/`account` field of the `clawchat_liveware_login` result/);
    for (const sub of ["`tunnel bind` / `bind-static`", "`agent`", "`uninstall`"]) {
      expect(hermes).toContain(sub);
    }
    const openclaw = readSkill("openclaw", "clawchat-liveware");
    expect(openclaw).not.toContain("--account");
  });
});

describe("shared orchestration skill", () => {
  it("explains a 21001 pending approval and its permission-result outcomes", () => {
    const text = readSkill("shared", "clawchat-orchestration");
    const row = text.split("\n").find((line) => line.startsWith("| `21001` |"));
    expect(row).toBeDefined();
    expect(row).toMatch(/`approved_retry` = call the same tool once more/);
    expect(row).toMatch(/`denied` \/ `auto_denied` \/ `expired` \/ `failed` = do not retry/);
    expect(row).toContain("`conversation_id`");
  });
});

describe("wiki progress forwarding instructions", () => {
  const install = readFileSync(INSTALL_MD, "utf8");
  const report = install.split("**Report each stage to the connection wiki (only if it sent you here).**")[1]?.split("## 0.")[0] ?? "";

  it("lists every whitelisted reason in a compact subsection before step zero", () => {
    expect(report.length).toBeGreaterThan(0);
    expect(Buffer.byteLength(report)).toBeLessThanOrEqual(2500);
    expect(Buffer.byteLength(install)).toBeLessThan(40_000);
    for (const reason of PROGRESS_REPORT_REASONS) expect(report).toContain(reason);
    const list = report.split("```text\n")[1]?.split("```")[0]?.trim().split("\n");
    expect(list).toEqual(PROGRESS_REPORT_REASONS);
  });

  it("restricts forwarding to wiki-routed agents with a code and makes it best-effort", () => {
    expect(report).toMatch(/Only if you came through the connection wiki and hold a pairing code/);
    expect(report).toContain("fetch once\nper reason");
    expect(report).toContain("Best-effort");
    expect(report).toContain("never retry");
    expect(report).toContain("never wait");
    expect(report).toContain("never let it block or change");
    expect(report).toContain("Add nothing else to the URL");
    expect(report).toContain("/hello?c=<your code>&agent=<openclaw|hermes>&step=progress&reason=<reason>");
    expect(report).toContain("Report the failure before working the Troubleshooting case");
    expect(report).not.toMatch(/T\d+/);
    const hosts = [...report.matchAll(/https?:\/\/([a-z0-9.-]+)/gi)].map((match) => match[1]);
    expect(hosts).toEqual(["agent-connection.clawling.com"]);
  });
});
