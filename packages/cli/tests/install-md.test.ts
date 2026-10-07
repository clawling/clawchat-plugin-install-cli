import { readFileSync } from "node:fs";
import { resolve } from "node:path";
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
    const commands = [...hermes.matchAll(/`(liveware (?:app|tunnel|status)\b[^`]*)`/g)].map((m) => m[1]!);
    expect(commands.length).toBeGreaterThan(10);
    // Bare subcommand names in prose (e.g. "if `liveware app inspect` is rejected") are not commands.
    const runnable = commands.filter((c) => /\s(<|"|http|--)/.test(c) || /^liveware (app list|status)$/.test(c));
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
