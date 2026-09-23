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

  it("install.md step 4 makes the agent verify the gateway actually restarted", () => {
    const step4 = install.split("## 4. Restart the agent")[1]?.split("\n## 5.")[0] ?? "";
    expect(step4).toContain("verify the gateway actually restarted");
    expect(step4).toContain("proves nothing");
    expect(step4).toContain("hermes gateway status");
    expect(step4).toContain("not the plugin's greeting");
  });

  it("install.md says where the wiki version actually is (response header / trailing comment)", () => {
    expect(install).not.toContain("shown at the top of that page");
    expect(install).toContain("X-Wiki-Version");
    expect(install).toContain("<!-- clawchat-wiki <version> -->");
  });
});

describe("bundled clawchat-core skills", () => {
  const SKILLS = ["hermes", "openclaw"].map((t) =>
    readFileSync(resolve(__dirname, `../../../skills/${t}/clawchat-core/SKILL.md`), "utf8"),
  );
  it("route reconnects and reports to the wiki, and no longer name retired app screens", () => {
    for (const text of SKILLS) {
      expect(text).toContain("https://agent-connection.clawling.com/reconnect.md");
      expect(text).toContain("https://agent-connection.clawling.com/start.md");
      expect(text).toContain("~/clawchat/onboarding.json");
      expect(text).not.toContain("注册 Agent");
      expect(text).not.toContain("创建新身份");
    }
  });
});
