#!/usr/bin/env python3
"""Write the `codex-review` commit status on a PR head from GitHub Codex's review state.

success = Codex's summary comment says its code review completed on the current head
and every unresolved Codex review thread carries a known non-blocking badge (P2 / P3).
failure = completed on the current head with unresolved P0 / P1, P4..P9 or unreadable badges.
pending = waiting, running, old head, missing threads, over 100 threads or corrupt summary.
error = review state could not be read, the head moved during the read, or status writes failed.

Head lookup: REST (3 attempts, waits of 2s / 5s), GraphQL (2), event HEAD_SHA, then
git smart-HTTP (2). Non-REST sources leave PR state unknown and treat it as open.
If all fail, exit 1 without writing: both API and git are unavailable, so no status can
be written anyway. An old success can remain only on that same head; the next successful
event run replaces it. Each status write retries once after 2s; failed decision writes
fall back to error (also 2 attempts), even if a failed success POST reached the server.
GITHUB_REF must match refs/heads/DEFAULT_BRANCH when both variables are present.
This prevents stale branch YAML / accidental use, not writers running their own workflow;
protection from writers requires a dedicated GitHub App and ruleset integration_id.

Known limitation: commit statuses belong to a SHA, not a PR, so two open PRs with the same
head share one `codex-review` status (the last run wins).

Only reads the PR and writes commit statuses. Stdlib only, so it runs on a bare runner.
Env: GITHUB_TOKEN, GITHUB_REPOSITORY, PR_NUMBER; optional HEAD_SHA (the event's head, a
fallback target when GitHub's API cannot be read), GITHUB_API_URL, GITHUB_SERVER_URL,
GITHUB_RUN_ID (status links to the run), GITHUB_REF, DEFAULT_BRANCH.
Tests: python3 -m unittest discover -s .github/scripts
"""
import base64
import json
import os
import re
import sys
from time import sleep
import urllib.error
import urllib.request

CONTEXT = "codex-review"
BOTS = {"chatgpt-codex-connector", "chatgpt-codex-connector[bot]"}
SUMMARY = "<!-- codex-pull-request-review-summary -->"
NON_BLOCKING = {"P2", "P3"}  # known lower levels; anything else blocks
HEAD_QUERY = """query($owner: String!, $name: String!, $number: Int!) {
  repository(owner: $owner, name: $name) { pullRequest(number: $number) { headRefOid } }
}
"""
QUERY = """query($owner: String!, $name: String!, $number: Int!) {
  repository(owner: $owner, name: $name) {
    pullRequest(number: $number) {
      headRefOid state
      reviewThreads(first: 100) {
        pageInfo { hasNextPage }
        nodes { isResolved path line comments(first: 1) { nodes { author { login } body } } }
      }
    }
  }
}
"""


def nodes(obj):
    return [n for n in ((obj or {}).get("nodes") or []) if n is not None]


def is_bot(author):
    return (author or {}).get("login") in BOTS


def codex_review(pr):
    """Latest Codex summary's code_review block: {status, commit_sha, ...}; {} if absent or corrupt."""
    summaries = [c for c in nodes(pr.get("comments"))
                 if is_bot(c.get("author")) and SUMMARY in (c.get("body") or "")]
    if not summaries:
        return {}
    body = max(summaries, key=lambda c: c.get("updatedAt") or c.get("createdAt") or "").get("body") or ""
    if "<!-- codex-review-state:v1" in body:
        # a corrupt or unterminated state block must not fall back to the display table
        m = re.search(r"<!-- codex-review-state:v1\s+(.*?)\s*-->", body, re.S)
        try:
            review = json.loads(m.group(1))["code_review"] if m else None
            if isinstance(review, dict):
                return review
        except (ValueError, KeyError, TypeError):
            pass
        return {}
    # older summaries only carry the display table
    for line in body.splitlines():
        t = re.search(r"Code Review.*\*\*(Completed|Running)\*\*.*?\|\s*`([0-9a-fA-F]{7,40})`", line, re.I)
        if t:
            return {"status": t.group(1).lower(), "commit_sha": t.group(2)}
    return {}


def blocking_threads(pr):
    """Unresolved Codex threads whose badge is not a known non-blocking level (P2 / P3)."""
    out = []
    for thread in nodes(pr.get("reviewThreads")):
        first = (nodes(thread.get("comments")) or [{}])[0]
        if not is_bot(first.get("author")) or thread.get("isResolved") is True:
            continue
        badge = re.search(r"!\[(P[0-9]) Badge\]", first.get("body") or "")
        level = badge.group(1) if badge else "?"
        if level not in NON_BLOCKING:
            out.append(f"{level} {thread.get('path') or '?'}:{thread.get('line') or '?'}")
    return out


def sha_matches(sha, head):
    return bool(isinstance(sha, str) and isinstance(head, str)
                and re.fullmatch(r"[0-9a-fA-F]{7,40}", sha)
                and re.fullmatch(r"[0-9a-fA-F]{40}", head)
                and head.lower().startswith(sha.lower()))


def decide(pr):
    """(state, description) for the PR head."""
    head = pr.get("headRefOid") or ""
    if ((pr.get("reviewThreads") or {}).get("pageInfo") or {}).get("hasNextPage"):
        return "pending", "More than 100 review threads; check by hand"
    review = codex_review(pr)
    status, sha = review.get("status"), review.get("commit_sha")
    if not review:
        return "pending", "Waiting for Codex review"
    if not sha_matches(sha, head):
        return "pending", f"Codex last reviewed {str(sha or '?')[:7]}, head is {head[:7]}; comment @codex review"
    if status != "completed":
        return "pending", f"Codex review {status or 'unknown'} on {head[:7]}"
    # Codex submits its threads before the final summary edit; if it reports findings we
    # cannot see yet, wait rather than pass.
    if review.get("has_unresolved_findings") is True and not any(
            is_bot((nodes(t.get("comments")) or [{}])[0].get("author")) for t in nodes(pr.get("reviewThreads"))):
        return "pending", "Codex reports findings that are not visible yet"
    blocking = blocking_threads(pr)
    if blocking:
        return "failure", f"{len(blocking)} unresolved blocking finding(s): " + ", ".join(blocking)
    return "success", f"Codex reviewed {head[:7]}, no unresolved P0/P1"


def why(e):
    """Log-safe reason: the HTTP code or the exception type, never exception text."""
    return f"HTTP {e.code}" if isinstance(e, urllib.error.HTTPError) else type(e).__name__


def api(method, url, token, payload=None):
    req = urllib.request.Request(url, method=method, data=None if payload is None else json.dumps(payload).encode(),
                                 headers={"Authorization": f"Bearer {token}",
                                          "Accept": "application/vnd.github+json",
                                          "Content-Type": "application/json"})
    with urllib.request.urlopen(req, timeout=30) as resp:
        return json.loads(resp.read() or b"{}")


def all_comments(base, repo, number, token):
    """Every issue comment on the PR, in GraphQL node shape (Codex edits an early summary in place)."""
    out, page = [], 1
    while True:
        batch = api("GET", f"{base}/repos/{repo}/issues/{number}/comments?per_page=100&page={page}", token)
        out += [{"author": {"login": (c.get("user") or {}).get("login")}, "body": c.get("body"),
                 "createdAt": c.get("created_at"), "updatedAt": c.get("updated_at")} for c in batch]
        if len(batch) < 100:
            return out
        page += 1


def read_head(base, repo, owner, name, number, token):
    """(head SHA, state) via REST (3 attempts), then GraphQL (2); unknown state is None."""
    for delay in (0, 2, 5):
        if delay:
            sleep(delay)
        try:
            rest = api("GET", f"{base}/repos/{repo}/pulls/{number}", token)
            head = rest["head"]["sha"]
            if not sha_matches(head, head):
                raise ValueError("invalid REST head")
            return head, rest.get("state")
        except Exception as e:
            print(f"REST head read failed: {why(e)}", file=sys.stderr)
    for attempt in range(2):
        if attempt:
            sleep(2)
        try:
            data = api("POST", f"{base}/graphql", token,
                       {"query": HEAD_QUERY, "variables": {"owner": owner, "name": name, "number": number}})
            if data.get("errors"):
                raise RuntimeError("GraphQL head query failed")
            head = data["data"]["repository"]["pullRequest"]["headRefOid"]
            if not sha_matches(head, head):
                raise ValueError("invalid GraphQL head")
            return head, None
        except Exception as e:
            print(f"GraphQL head read failed: {why(e)}", file=sys.stderr)
    return None, None


def git_head(server, repo, number, token):
    """Read the exact PR head ref from a smart-HTTP pkt-line advertisement (2 attempts)."""
    auth = base64.b64encode(f"x-access-token:{token}".encode()).decode()
    req = urllib.request.Request(f"{server.rstrip('/')}/{repo}.git/info/refs?service=git-upload-pack",
                                 headers={"Authorization": f"Basic {auth}"})
    ref = f"refs/pull/{number}/head".encode()
    for attempt in range(2):
        if attempt:
            sleep(2)
        try:
            with urllib.request.urlopen(req, timeout=30) as resp:
                data = resp.read()
            offset = 0
            while offset < len(data):
                size = int(data[offset:offset + 4], 16)
                offset += 4
                if size == 0:
                    continue
                if size < 4 or offset + size - 4 > len(data):
                    raise ValueError("invalid pkt-line length")
                line = data[offset:offset + size - 4].split(b"\0", 1)[0].rstrip(b"\n")
                offset += size - 4
                match = re.fullmatch(rb"([0-9a-fA-F]{40}) " + re.escape(ref), line)
                if match:
                    return match.group(1).decode()
        except Exception as e:
            print(f"git head read failed: {why(e)}", file=sys.stderr)
    return None


def main():
    ref, default = os.environ.get("GITHUB_REF"), os.environ.get("DEFAULT_BRANCH")
    if ref and default and ref != f"refs/heads/{default}":
        print(f"::error::workflow YAML from {ref} is not the default branch; refusing to write status",
              file=sys.stderr)
        return 1
    token, repo = os.environ["GITHUB_TOKEN"], os.environ["GITHUB_REPOSITORY"]
    number = int(os.environ["PR_NUMBER"])
    base = os.environ.get("GITHUB_API_URL", "https://api.github.com")
    server = os.environ.get("GITHUB_SERVER_URL", "https://github.com")
    run = os.environ.get("GITHUB_RUN_ID")
    target = f"{server}/{repo}/actions/runs/{run}" if run else None
    owner, name = repo.split("/")

    def post(sha, state, description):
        body = {"state": state, "context": CONTEXT, "description": description[:140]}
        if target:
            body["target_url"] = target
        for attempt in range(2):
            try:
                api("POST", f"{base}/repos/{repo}/statuses/{sha}", token, body)
                break
            except Exception as e:
                print(f"failed to write {state} status: {why(e)}", file=sys.stderr)
                if attempt:
                    raise
                sleep(2)
        print(f"{CONTEXT} @{sha[:7]}: {state} — {description}")

    # read the head on its own first, so a failure below can still replace a stale success
    head, state = read_head(base, repo, owner, name, number, token)
    head = head or os.environ.get("HEAD_SHA") or git_head(server, repo, number, token)
    if not head:
        print(f"::error::cannot read the head of PR #{number}; codex-review status left unchanged, "
              "re-run this workflow", file=sys.stderr)
        return 1
    if state not in ("open", None):
        print(f"PR #{number} is {state}; status left unchanged")
        return 0
    try:
        # summary before threads: Codex submits its threads before it marks the summary completed,
        # so a completed summary read first can never pair with a thread snapshot missing its findings
        comments = all_comments(base, repo, number, token)
        data = api("POST", f"{base}/graphql", token,
                   {"query": QUERY, "variables": {"owner": owner, "name": name, "number": number}})
        if data.get("errors"):
            raise RuntimeError(str(data["errors"])[:200])
        pr = data["data"]["repository"]["pullRequest"]
        if pr["headRefOid"] != head:
            raise RuntimeError(f"head moved during read ({head[:7]} -> {pr['headRefOid'][:7]})")
        pr["comments"] = {"nodes": comments}
        post(head, *decide(pr))
        return 0
    except Exception as e:  # fail closed, including a success POST whose response was lost
        print(f"failed to read or write Codex state: {why(e)}", file=sys.stderr)
        try:
            post(head, "error", "Could not read Codex review state; re-run this workflow")
        except Exception:
            print(f"::error::status on {head[:7]} may still be stale; re-run this workflow", file=sys.stderr)
        return 1


if __name__ == "__main__":
    sys.exit(main())
