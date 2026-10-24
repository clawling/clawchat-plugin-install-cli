import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { checkReleaseTag } from "./release-guard.mjs";

const GUARD = fileURLToPath(new URL("./release-guard.mjs", import.meta.url));
const VERSION = "1.2.3";
const TAG = `cli-v${VERSION}`;

// Each node:test file has its own process. Do not inherit git config overrides,
// repository paths, or identity from the caller, including lifecycle settings.
for (const key of Object.keys(process.env)) {
  if (key.startsWith("GIT_")) delete process.env[key];
}
Object.assign(process.env, {
  GIT_CONFIG_GLOBAL: "/dev/null",
  GIT_CONFIG_NOSYSTEM: "1",
  GIT_AUTHOR_NAME: "Release Test",
  GIT_AUTHOR_EMAIL: "release-test@example.invalid", // redact-allow:email
  GIT_COMMITTER_NAME: "Release Test",
  GIT_COMMITTER_EMAIL: "release-test@example.invalid", // redact-allow:email
  GIT_TERMINAL_PROMPT: "0",
});

function git(cwd, ...args) {
  const result = spawnSync("git", [
    "-c", "commit.gpgsign=false", "-c", "tag.gpgsign=false", ...args,
  ], { cwd, encoding: "utf8", shell: false });
  assert.equal(result.error, undefined);
  assert.equal(result.status, 0, result.stderr);
  return result.stdout.trim();
}

function fixture(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "release-guard-"));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const origin = path.join(dir, "origin.git");
  const repo = path.join(dir, "checkout");
  git(dir, "init", "--bare", "--initial-branch=main", origin);
  git(dir, "clone", origin, repo);
  fs.mkdirSync(path.join(repo, "packages/cli"), { recursive: true });
  fs.writeFileSync(path.join(repo, "packages/cli/package.json"), JSON.stringify({ version: VERSION }));
  fs.writeFileSync(path.join(repo, "tracked.txt"), "initial\n");
  fs.writeFileSync(path.join(repo, ".gitignore"), "node_modules/\ndist/\n");
  git(repo, "add", ".");
  git(repo, "commit", "-m", "Initial release fixture");
  git(repo, "push", "origin", "main");
  return { origin, repo };
}

function tagRelease(repo, { push = true } = {}) {
  git(repo, "tag", "-a", TAG, "-m", "Release fixture");
  if (push) git(repo, "push", "origin", `refs/tags/${TAG}`);
}

function advance(repo) {
  fs.appendFileSync(path.join(repo, "tracked.txt"), "next\n");
  git(repo, "commit", "-am", "Next fixture commit");
}

function check(repo, options = {}) {
  return checkReleaseTag({ cwd: repo, tag: TAG, ...options });
}

function assertFailure(repo, problem) {
  const failures = check(repo);
  assert.ok(failures.length > 0);
  assert.match(failures.join("\n"), problem);
}

function cli(repo, args, env = {}) {
  // Never invoke a real npm operation from this suite.
  assert.ok(args[0] !== "promote" || args.includes("--dry-run"));
  const childEnv = { ...process.env };
  delete childEnv.npm_config_tag;
  Object.assign(childEnv, env);
  const result = spawnSync(process.execPath, [GUARD, ...args], {
    cwd: repo, env: childEnv, encoding: "utf8", shell: false,
  });
  assert.equal(result.error, undefined);
  return result;
}

test("annotated pushed main tag passes from a clean detached tag checkout", (t) => {
  const { repo } = fixture(t);
  tagRelease(repo);
  git(repo, "checkout", "--detach", TAG);
  // Ignored build and dependency files do not make a release checkout dirty.
  for (const name of ["node_modules", "dist"]) {
    fs.mkdirSync(path.join(repo, name));
    fs.writeFileSync(path.join(repo, name, "ignored.txt"), "ignored");
  }
  assert.deepEqual(check(repo), []);
});

test("HEAD one commit ahead of the release tag fails", (t) => {
  const { repo } = fixture(t);
  tagRelease(repo);
  advance(repo);
  assertFailure(repo, /HEAD must equal/);
});

test("pushed side branch tag fails remote main ancestry", (t) => {
  const { repo } = fixture(t);
  git(repo, "checkout", "-b", "side");
  advance(repo);
  tagRelease(repo);
  assertFailure(repo, /ancestor of origin\/main/);
});

test("modified tracked file fails the clean working tree check", (t) => {
  const { repo } = fixture(t);
  tagRelease(repo);
  fs.appendFileSync(path.join(repo, "tracked.txt"), "dirty\n");
  assertFailure(repo, /Working tree must be clean/);
});

test("untracked non-ignored file fails even if git config hides untracked files", (t) => {
  const { repo } = fixture(t);
  tagRelease(repo);
  git(repo, "config", "status.showUntrackedFiles", "no");
  fs.writeFileSync(path.join(repo, "untracked.txt"), "dirty\n");
  assertFailure(repo, /Working tree must be clean/);
});

test("local annotated tag that was not pushed fails", (t) => {
  const { repo } = fixture(t);
  tagRelease(repo, { push: false });
  assertFailure(repo, /must be pushed.*tag is not pushed/);
});

test("different remote tag object fails even when both tags name the same commit", (t) => {
  const { repo } = fixture(t);
  tagRelease(repo);
  git(repo, "tag", "-f", "-a", TAG, "-m", "Different annotation");
  assertFailure(repo, /remote tag object differs from local tag object/);
});

test("lightweight tag fails the annotated tag requirement", (t) => {
  const { repo } = fixture(t);
  git(repo, "tag", TAG);
  git(repo, "push", "origin", `refs/tags/${TAG}`);
  assertFailure(repo, /annotated tag.*lightweight/);
});

test("missing tag fails and reports independent problems together", (t) => {
  const { repo } = fixture(t);
  fs.appendFileSync(path.join(repo, "tracked.txt"), "dirty\n");
  const failures = check(repo).join("\n");
  assert.match(failures, /must exist locally as an annotated tag/);
  assert.match(failures, /tag is not pushed/);
  assert.match(failures, /Working tree must be clean/);
});

test("failed remote main refresh fails despite a cached tracking ref", (t) => {
  const { origin, repo } = fixture(t);
  tagRelease(repo);
  git(origin, "update-ref", "-d", "refs/heads/main");
  assertFailure(repo, /Cannot refresh origin\/main/);
});

test("remote lookup errors fail closed", (t) => {
  const { repo } = fixture(t);
  tagRelease(repo);
  git(repo, "remote", "remove", "origin");
  const failures = check(repo).join("\n");
  assert.match(failures, /must be pushed and identical on origin/);
  assert.match(failures, /Cannot refresh origin\/main/);
});

test("running outside a git repository fails closed", (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "release-guard-outside-"));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  assertFailure(dir, /Cannot find repository root/);
});

test("publish exempts the dev channel without a release tag", (t) => {
  const { repo } = fixture(t);
  const result = cli(repo, ["publish"], { npm_config_tag: "dev" });
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /dev channel is exempt/);
});

test("publish enforces latest by default when npm_config_tag is unset", (t) => {
  const { repo } = fixture(t);
  const result = cli(repo, ["publish"]);
  assert.equal(result.status, 1);
  assert.match(result.stderr, /cli-v1\.2\.3 must exist locally as an annotated tag/);
});

test("publish accepts a valid tag from packages/cli and explicit latest is enforced", (t) => {
  const { repo } = fixture(t);
  tagRelease(repo);
  const cwd = path.join(repo, "packages/cli");
  const result = cli(cwd, ["publish"]);
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /Release guard OK: cli-v1\.2\.3/);
  fs.appendFileSync(path.join(repo, "tracked.txt"), "dirty\n");
  const dirty = cli(cwd, ["publish"], { npm_config_tag: "latest" });
  assert.equal(dirty.status, 1);
  assert.match(dirty.stderr, /Working tree must be clean/);
});

test("publish fails closed if the package version cannot be loaded", (t) => {
  const { repo } = fixture(t);
  fs.writeFileSync(path.join(repo, "packages/cli/package.json"), "invalid json");
  const result = cli(repo, ["publish"]);
  assert.equal(result.status, 1);
  assert.match(result.stderr, /Release guard failed/);
});

test("promote dry-run prints the command and permits another dirty checkout", (t) => {
  const { repo } = fixture(t);
  tagRelease(repo);
  advance(repo);
  fs.writeFileSync(path.join(repo, "untracked.txt"), "dirty\n");
  assert.deepEqual(check(repo, { requireHead: false }), []);
  const result = cli(repo, ["promote", VERSION, "--dry-run"]);
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /Would run: npm dist-tag add @clawling\/clawchat-plugin-install-cli@1\.2\.3 latest/);
});

for (const scenario of ["missing", "unpushed"]) {
  test(`promote dry-run rejects ${scenario} tag`, (t) => {
    const { repo } = fixture(t);
    if (scenario === "unpushed") tagRelease(repo, { push: false });
    const result = cli(repo, ["promote", VERSION, "--dry-run"]);
    assert.equal(result.status, 1);
    assert.match(result.stderr, scenario === "missing" ? /must exist locally/ : /tag is not pushed/);
    assert.doesNotMatch(result.stdout, /Would run:/);
  });
}

test("promote dry-run rejects a pushed tag outside remote main", (t) => {
  const { repo } = fixture(t);
  git(repo, "checkout", "-b", "side");
  advance(repo);
  tagRelease(repo);
  const result = cli(repo, ["promote", VERSION, "--dry-run"]);
  assert.equal(result.status, 1);
  assert.match(result.stderr, /ancestor of origin\/main/);
  assert.doesNotMatch(result.stdout, /Would run:/);
});

for (const version of ["1.2.3-dev.1", "1.2.3+build", "v1.2.3", "01.2.3", "1.2"]) {
  test(`promote rejects non-final or invalid version ${version}`, (t) => {
    const { repo } = fixture(t);
    const result = cli(repo, ["promote", version, "--dry-run"]);
    assert.equal(result.status, 1);
    assert.match(result.stderr, /requires a final plain semver X\.Y\.Z/);
    assert.doesNotMatch(result.stdout, /Would run:/);
  });
}
