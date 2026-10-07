import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { frontmatterProblems } from "./skill-frontmatter.mjs";

const SKILLS_DIR = path.resolve(fileURLToPath(new URL("../skills", import.meta.url)));

test("a plain scalar with ': ' inside is rejected", () => {
  const text = "---\nname: x\nversion: 1.0.0\ndescription: Use when \"Restyle my list: …\" is sent.\n---\n";
  const problems = frontmatterProblems(text, "x/SKILL.md");
  assert.equal(problems.length, 1);
  assert.match(problems[0], /description/);
});

test("quoted, folded and colon-free values pass", () => {
  for (const description of [
    "Use when the owner asks.",
    '"Restyle my list: anything"',
    ">-\n  Restyle my list: anything",
    "Use when 改成：… is sent", // full-width colon is not a YAML indicator
  ]) {
    const text = `---\nname: x\nversion: 1.0.0\ndescription: ${description}\n---\n`;
    assert.deepEqual(frontmatterProblems(text, "x/SKILL.md"), [], description);
  }
});

test("a missing version is reported", () => {
  const problems = frontmatterProblems("---\nname: x\ndescription: d\n---\n", "x/SKILL.md");
  assert.deepEqual(problems, ["x/SKILL.md: frontmatter has no `version:`"]);
});

test("every SKILL.md in the canonical tree has YAML-safe frontmatter", () => {
  const problems = [];
  for (const group of fs.readdirSync(SKILLS_DIR, { withFileTypes: true })) {
    if (!group.isDirectory()) continue;
    for (const skill of fs.readdirSync(path.join(SKILLS_DIR, group.name), { withFileTypes: true })) {
      const file = path.join(SKILLS_DIR, group.name, skill.name, "SKILL.md");
      if (!skill.isDirectory() || !fs.existsSync(file)) continue;
      problems.push(...frontmatterProblems(fs.readFileSync(file, "utf8"), `${group.name}/${skill.name}/SKILL.md`));
    }
  }
  assert.deepEqual(problems, []);
});
