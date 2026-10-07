// Lint a SKILL.md frontmatter for the YAML mistakes that silently break hosts.
//
// Hosts (and both adapters) parse the frontmatter as YAML. A top-level value
// written as a plain (unquoted) scalar is not valid YAML when it contains
// ": " or " #" — the first reads as a nested mapping, the second as a comment.
// The parse then fails and each host falls back differently: Hermes reads no
// `version` and re-seeds the skill on every start, OpenClaw falls back to a
// line parser. No YAML library is a dependency here, so this checks the one
// form our skills use — single-line `key: value` entries — and leaves quoted,
// block (`>-`, `|`) and flow values alone. Use `description: >-` (value
// indented on the next line) for prose that needs a colon.
//
// Returns a list of human-readable problems; empty means OK.
export function frontmatterProblems(text, file) {
  const normalized = text.replace(/^﻿/, "").replace(/\r\n?/g, "\n");
  if (!normalized.startsWith("---\n")) return [`${file}: missing YAML frontmatter`];
  const end = normalized.indexOf("\n---", 3);
  if (end === -1) return [`${file}: unterminated frontmatter`];
  const lines = normalized.slice(4, end).split("\n");
  const problems = [];
  const keys = new Set();
  lines.forEach((line, i) => {
    if (line.trim() === "" || /^[ \t]/.test(line) || line.startsWith("#")) return;
    const m = line.match(/^([A-Za-z0-9_-]+):(?:[ \t]+(.*))?$/);
    if (!m) {
      problems.push(`${file}:${i + 2}: not a \`key: value\` line`);
      return;
    }
    keys.add(m[1]);
    const value = (m[2] ?? "").trim();
    if (value === "" || /^["'|>[{&*!]/.test(value)) return;
    if (/:\s/.test(value) || value.endsWith(":") || /\s#/.test(value) || /^[@`%,?:-]/.test(value)) {
      problems.push(
        `${file}:${i + 2}: \`${m[1]}\` is a plain YAML scalar that cannot hold ": ", " #" or a leading indicator — quote it or use \`${m[1]}: >-\``,
      );
    }
  });
  for (const key of ["name", "version", "description"]) {
    if (!keys.has(key)) problems.push(`${file}: frontmatter has no \`${key}:\``);
  }
  return problems;
}
