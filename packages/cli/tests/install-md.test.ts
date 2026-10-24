import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";

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

  it("teach widget/v1 the same way on both hosts: one tool, explicit request, full snapshots, taps and resend", () => {
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
    expect(hermes).toContain("Every message is the full snapshot, never a diff. The latest one per `id` wins.");
    expect(hermes).toContain("Do not refresh on a timer");
    expect(hermes).toContain("It only ever goes to your private chat with your partner.");
    for (const line of [
      '[widget todo] checked "Pay rent" (t1)',
      '[widget todo] turned on "Focus" (f1)',
      '[widget todo] pressed "Refresh" (b1)',
      "[widget todo] capture: buy milk",
      "[widget todo] resend",
    ]) {
      expect(hermes).toContain(line);
    }
    expect(hermes).toMatch(/apply each in order, they are not duplicates\. Then send one new full snapshot\./);
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
