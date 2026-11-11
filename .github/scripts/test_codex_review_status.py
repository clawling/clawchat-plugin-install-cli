import base64
import contextlib
import io
import json
import os
import unittest
from unittest import mock

import codex_review_status
from codex_review_status import decide

HEAD = "d7b2062d36cfeea3609f7990b7e4feb7ba7db502"
BOT = {"login": "chatgpt-codex-connector"}


def summary(status="completed", sha=HEAD, unresolved=False, updated="2026-10-27T03:19:45Z"):
    state = {"code_review": {"commit_sha": sha, "has_any_findings": unresolved,
                             "has_unresolved_findings": unresolved, "status": status}}
    return {"author": BOT, "updatedAt": updated,
            "body": "<!-- codex-pull-request-review-summary -->\n"
                    f"<!-- codex-review-state:v1 {json.dumps(state)} -->\n\n## Codex Review Summary\n"}


def thread(level, resolved=False, author=BOT):
    badge = f"**<sub><sub>![{level} Badge](https://img.shields.io/badge/{level}-red)</sub></sub>  Title**" if level else "**Title**"
    return {"isResolved": resolved, "path": "a.go", "line": 3,
            "comments": {"nodes": [{"author": author, "body": badge}]}}


def pr(comments=(), threads=(), head=HEAD, more=False):
    return {"headRefOid": head, "state": "OPEN", "comments": {"nodes": list(comments)},
            "reviewThreads": {"pageInfo": {"hasNextPage": more}, "nodes": list(threads)}}


class Decide(unittest.TestCase):
    def test_no_summary_is_pending(self):
        self.assertEqual(decide(pr())[0], "pending")

    def test_running_is_pending(self):
        self.assertEqual(decide(pr([summary(status="running")]))[0], "pending")

    def test_completed_on_head_without_findings_is_success(self):
        self.assertEqual(decide(pr([summary()]))[0], "success")

    def test_completed_on_old_head_is_pending(self):
        self.assertEqual(decide(pr([summary(sha="1" * 40)]))[0], "pending")

    def test_latest_summary_wins(self):
        old = summary(updated="2026-10-27T03:00:00Z")
        new = summary(status="running", updated="2026-10-27T04:00:00Z")
        self.assertEqual(decide(pr([new, old]))[0], "pending")

    def test_summary_from_other_author_is_ignored(self):
        fake = summary()
        fake["author"] = {"login": "someone"}
        self.assertEqual(decide(pr([fake]))[0], "pending")

    def test_unresolved_p1_is_failure(self):
        state, desc = decide(pr([summary(unresolved=True)], [thread("P1")]))
        self.assertEqual(state, "failure")
        self.assertIn("P1 a.go:3", desc)

    def test_unresolved_p0_and_unknown_badge_block(self):
        self.assertEqual(decide(pr([summary()], [thread("P0")]))[0], "failure")
        self.assertEqual(decide(pr([summary()], [thread(None)]))[0], "failure")

    def test_unterminated_state_block_is_pending(self):
        bad = {"author": BOT, "body": "<!-- codex-pull-request-review-summary -->\n"
                                      "<!-- codex-review-state:v1 {\"code_review\": {}}\n"
                                      "| 📝 **Code Review** | ✅ **Completed** x | `d7b2062` | Manual |"}
        self.assertEqual(decide(pr([bad]))[0], "pending")

    def test_open_p3_passes_but_p4_and_up_block(self):
        self.assertEqual(decide(pr([summary()], [thread("P3")]))[0], "success")
        for level in ("P4", "P9"):
            self.assertEqual(decide(pr([summary()], [thread(level)]))[0], "failure", level)

    def test_resolved_p1_and_open_p2_pass(self):
        self.assertEqual(decide(pr([summary(unresolved=True)], [thread("P1", resolved=True), thread("P2")]))[0],
                         "success")

    def test_reported_findings_without_visible_threads_are_pending(self):
        self.assertEqual(decide(pr([summary(unresolved=True)]))[0], "pending")

    def test_human_threads_do_not_block(self):
        self.assertEqual(decide(pr([summary()], [thread("P0", author={"login": "someone"})]))[0], "success")

    def test_corrupt_state_block_is_pending(self):
        bad = {"author": BOT, "body": "<!-- codex-pull-request-review-summary -->\n"
                                      "<!-- codex-review-state:v1 {not json -->\n"
                                      "| 📝 **Code Review** | ✅ **Completed** x | `d7b2062` | Manual |"}
        self.assertEqual(decide(pr([bad]))[0], "pending")

    def test_legacy_table_summary(self):
        legacy = {"author": BOT, "body": "<!-- codex-pull-request-review-summary -->\n"
                                         "| 📝 **Code Review** | ✅ **Completed** x | `d7b2062` | Manual |"}
        self.assertEqual(decide(pr([legacy]))[0], "success")

    def test_too_many_threads_is_pending(self):
        self.assertEqual(decide(pr([summary()], more=True))[0], "pending")


def pkt(line):
    return f"{len(line) + 4:04x}".encode() + line


class GitHead(unittest.TestCase):
    def run_git(self, replies):
        def reply(req, timeout):
            value = next(replies)
            if isinstance(value, Exception):
                raise value
            return io.BytesIO(value)

        with mock.patch.object(codex_review_status.urllib.request, "urlopen", side_effect=reply) as opened, \
                mock.patch.object(codex_review_status, "sleep") as slept:
            head = codex_review_status.git_head("https://github.example", "o/r", 7, "placeholder-token")
        self.opened, self.slept = opened, slept
        return head

    def test_first_ref_with_capabilities(self):
        data = pkt(b"# service=git-upload-pack\n") + b"0000"
        data += pkt(f"{HEAD} refs/pull/7/head\0multi_ack thin-pack\n".encode()) + b"0000"
        self.assertEqual(self.run_git(iter([data])), HEAD)
        req = self.opened.call_args.args[0]
        self.assertEqual(req.full_url, "https://github.example/o/r.git/info/refs?service=git-upload-pack")
        auth = base64.b64encode(b"x-access-token:placeholder-token").decode()
        self.assertEqual(req.get_header("Authorization"), f"Basic {auth}")
        self.assertEqual(self.opened.call_args.kwargs, {"timeout": 30})

    def test_regular_ref(self):
        data = pkt(f"{'1' * 40} HEAD\0multi_ack\n".encode())
        data += pkt(f"{HEAD} refs/pull/7/head\n".encode()) + b"0000"
        self.assertEqual(self.run_git(iter([data])), HEAD)

    def test_missing_and_similarly_named_refs(self):
        for ref in ("refs/heads/main", "refs/pull/7/headx", "refs/pull/77/head"):
            with self.subTest(ref=ref):
                data = pkt(f"{HEAD} {ref}\n".encode()) + b"0000"
                self.assertIsNone(self.run_git(iter([data, data])))
                self.assertEqual(self.opened.call_count, 2)

    def test_transport_retry(self):
        data = pkt(f"{HEAD} refs/pull/7/head\n".encode()) + b"0000"
        self.assertEqual(self.run_git(iter([OSError("503"), data])), HEAD)
        self.assertEqual(self.opened.call_count, 2)
        self.slept.assert_called_once_with(2)

    def test_malformed_packets_fail_closed(self):
        for data in (b"zzzz", b"0003", b"00ffshort", b"0"):
            with self.subTest(data=data):
                self.assertIsNone(self.run_git(iter([data, data])))


class Main(unittest.TestCase):
    """main() against a stubbed GitHub API."""

    def run_main(self, graphql, comments, pulls_fail=0, head_query=None, env_head=None,
                 git_reply=None, post_fail=0, head_query_fail=0, env_extra=None):
        posted, self.calls, self.post_attempts, self.api_posts = [], [], [], []
        fails = [pulls_fail, head_query_fail, post_fail]

        def api(method, url, token, payload=None):
            self.calls.append(url)
            if method == "POST":
                self.api_posts.append((url, payload))
            if url.endswith("/pulls/7"):
                if fails[0]:
                    fails[0] -= 1
                    raise OSError("503")
                return {"state": "open", "head": {"sha": HEAD}}
            if url.endswith("/graphql"):
                if payload["query"] == codex_review_status.HEAD_QUERY:
                    if fails[1]:
                        fails[1] -= 1
                        raise OSError("graphql down")
                    if head_query is None:
                        raise OSError("graphql down")
                    return head_query
                return graphql
            if "/issues/7/comments" in url:
                page = int(url.rsplit("page=", 1)[1])
                return comments[page - 1] if page <= len(comments) else []
            if "/statuses/" in url:
                status = (url.rsplit("/", 1)[1], payload["state"])
                self.post_attempts.append(status)
                if fails[2]:
                    fails[2] -= 1
                    raise OSError("transport error with placeholder-secret")
                posted.append(status)
                return {}
            raise AssertionError(url)

        env = {"GITHUB_TOKEN": "t", "GITHUB_REPOSITORY": "o/r", "PR_NUMBER": "7"}
        if env_head:
            env["HEAD_SHA"] = env_head
        env.update(env_extra or {})
        self.stderr = io.StringIO()

        def git_response(req, timeout):
            if git_reply is None:
                raise OSError("git down")
            return io.BytesIO(git_reply)

        with mock.patch.dict(os.environ, env, clear=True), \
                mock.patch.object(codex_review_status, "api", api), \
                mock.patch.object(codex_review_status, "sleep") as slept, \
                mock.patch.object(codex_review_status.urllib.request, "urlopen", side_effect=git_response) as opened, \
                contextlib.redirect_stderr(self.stderr):
            rc = codex_review_status.main()
        self.sleeps = slept.call_args_list
        self.git_calls = opened.call_args_list
        self.assertNotIn("placeholder-secret", self.stderr.getvalue())
        return rc, posted

    @staticmethod
    def rest(c):
        return {"user": c["author"], "body": c["body"], "created_at": c.get("updatedAt"),
                "updated_at": c.get("updatedAt")}

    def test_graphql_error_still_writes_error_on_head(self):
        rc, posted = self.run_main({"errors": [{"message": "boom"}]}, [])
        self.assertEqual((rc, posted), (1, [(HEAD, "error")]))

    def test_head_read_retries_rest_once(self):
        rc, posted = self.run_main({"errors": [{"message": "boom"}]}, [], pulls_fail=1)
        self.assertEqual((rc, posted), (1, [(HEAD, "error")]))
        self.assertEqual(self.calls.count("https://api.github.com/repos/o/r/pulls/7"), 2)
        self.assertEqual(self.sleeps, [mock.call(2)])

    def test_head_falls_back_to_graphql_then_writes_error(self):
        gql_head = {"data": {"repository": {"pullRequest": {"headRefOid": HEAD}}}}
        rc, posted = self.run_main({"errors": [{"message": "boom"}]}, [], pulls_fail=3, head_query=gql_head)
        self.assertEqual((rc, posted), (1, [(HEAD, "error")]))
        self.assertEqual(self.calls.count("https://api.github.com/repos/o/r/pulls/7"), 3)
        self.assertEqual(self.sleeps, [mock.call(2), mock.call(5)])
        self.assertEqual(self.git_calls, [])

    def test_head_query_retries_once(self):
        gql_head = {"data": {"repository": {"pullRequest": {"headRefOid": HEAD}}}}
        rc, posted = self.run_main({"errors": [{"message": "boom"}]}, [], pulls_fail=3,
                                   head_query=gql_head, head_query_fail=1)
        self.assertEqual((rc, posted), (1, [(HEAD, "error")]))
        queries = [body for _, body in self.api_posts if body.get("query") == codex_review_status.HEAD_QUERY]
        self.assertEqual(len(queries), 2)

    def test_head_falls_back_to_event_sha(self):
        rc, posted = self.run_main({"errors": [{"message": "boom"}]}, [], pulls_fail=3, env_head=HEAD)
        self.assertEqual((rc, posted), (1, [(HEAD, "error")]))
        queries = [body for _, body in self.api_posts if body.get("query") == codex_review_status.HEAD_QUERY]
        self.assertEqual(len(queries), 2)
        self.assertEqual(self.git_calls, [])

    def test_head_falls_back_to_git_then_writes_error(self):
        data = pkt(f"{HEAD} refs/pull/7/head\n".encode()) + b"0000"
        rc, posted = self.run_main({"errors": [{"message": "boom"}]}, [], pulls_fail=3, git_reply=data)
        self.assertEqual((rc, posted), (1, [(HEAD, "error")]))
        self.assertEqual(len(self.git_calls), 1)
        self.assertEqual(self.calls.count("https://api.github.com/repos/o/r/pulls/7"), 3)
        queries = [body for _, body in self.api_posts if body.get("query") == codex_review_status.HEAD_QUERY]
        self.assertEqual(len(queries), 2)

    def test_unreadable_head_fails_without_touching_status(self):
        rc, posted = self.run_main({"errors": [{"message": "boom"}]}, [], pulls_fail=3)
        self.assertEqual((rc, posted), (1, []))
        self.assertEqual(self.post_attempts, [])
        self.assertEqual(len(self.git_calls), 2)
        self.assertIn("::error::", self.stderr.getvalue())

    def test_summary_found_beyond_first_comment_page(self):
        filler = [{"user": {"login": "someone"}, "body": "hi"}] * 100
        gql = {"data": {"repository": {"pullRequest": pr()}}}
        rc, posted = self.run_main(gql, [[self.rest(summary())] + filler[:99], filler[:5]])
        self.assertEqual((rc, posted), (0, [(HEAD, "success")]))
        rc, posted = self.run_main(gql, [filler, [self.rest(summary())]])
        self.assertEqual((rc, posted), (0, [(HEAD, "success")]))

    def test_summary_is_read_before_threads(self):
        self.run_main({"data": {"repository": {"pullRequest": pr()}}}, [[self.rest(summary())]])
        first_comments = next(i for i, u in enumerate(self.calls) if "/comments" in u)
        self.assertLess(first_comments, self.calls.index("https://api.github.com/graphql"))

    def test_head_moved_during_read_is_error(self):
        gql = {"data": {"repository": {"pullRequest": pr(head="1" * 40)}}}
        rc, posted = self.run_main(gql, [[self.rest(summary())]])
        self.assertEqual((rc, posted), (1, [(HEAD, "error")]))

    def test_decision_post_retry_succeeds(self):
        for state, comments, threads in (("success", [summary()], []),
                                         ("failure", [summary()], [thread("P1")]),
                                         ("pending", [], [])):
            with self.subTest(state=state):
                gql = {"data": {"repository": {"pullRequest": pr(threads=threads)}}}
                rc, posted = self.run_main(gql, [[self.rest(c) for c in comments]], post_fail=1)
                self.assertEqual((rc, posted), (0, [(HEAD, state)]))
                self.assertEqual(self.post_attempts, [(HEAD, state)] * 2)
                self.assertEqual(self.sleeps, [mock.call(2)])

    def test_failed_decision_posts_fall_back_to_error(self):
        for state, comments, threads in (("success", [summary()], []),
                                         ("failure", [summary()], [thread("P1")]),
                                         ("pending", [], [])):
            with self.subTest(state=state):
                gql = {"data": {"repository": {"pullRequest": pr(threads=threads)}}}
                rc, posted = self.run_main(gql, [[self.rest(c) for c in comments]], post_fail=2)
                self.assertEqual((rc, posted), (1, [(HEAD, "error")]))
                self.assertEqual(self.post_attempts, [(HEAD, state)] * 2 + [(HEAD, "error")])

    def test_all_status_writes_fail_and_warn_about_stale_status(self):
        gql = {"data": {"repository": {"pullRequest": pr()}}}
        rc, posted = self.run_main(gql, [[self.rest(summary())]], post_fail=4)
        self.assertEqual((rc, posted), (1, []))
        self.assertEqual(self.post_attempts, [(HEAD, "success")] * 2 + [(HEAD, "error")] * 2)
        self.assertEqual(self.sleeps, [mock.call(2), mock.call(2)])
        self.assertIn(f"::error::status on {HEAD[:7]} may still be stale", self.stderr.getvalue())

    def test_read_error_status_retries(self):
        rc, posted = self.run_main({"errors": [{"message": "boom"}]}, [], post_fail=1)
        self.assertEqual((rc, posted), (1, [(HEAD, "error")]))
        self.assertEqual(self.post_attempts, [(HEAD, "error")] * 2)
        self.assertEqual(self.sleeps, [mock.call(2)])

    def test_non_default_workflow_ref_is_rejected_without_api_calls(self):
        rc, posted = self.run_main({}, [], env_extra={"GITHUB_REF": "refs/heads/other", "DEFAULT_BRANCH": "main"})
        self.assertEqual((rc, posted), (1, []))
        self.assertEqual(self.calls, [])
        self.assertEqual(self.git_calls, [])
        self.assertIn("workflow YAML from refs/heads/other is not the default branch; refusing to write status",
                      self.stderr.getvalue())

    def test_default_workflow_ref_is_allowed(self):
        gql = {"data": {"repository": {"pullRequest": pr()}}}
        rc, posted = self.run_main(gql, [[self.rest(summary())]],
                                   env_extra={"GITHUB_REF": "refs/heads/main", "DEFAULT_BRANCH": "main"})
        self.assertEqual((rc, posted), (0, [(HEAD, "success")]))

    def test_ref_guard_skipped_if_either_variable_is_missing(self):
        gql = {"data": {"repository": {"pullRequest": pr()}}}
        for env in ({"GITHUB_REF": "refs/heads/other"}, {"DEFAULT_BRANCH": "main"}):
            with self.subTest(env=env):
                rc, posted = self.run_main(gql, [[self.rest(summary())]], env_extra=env)
                self.assertEqual((rc, posted), (0, [(HEAD, "success")]))


class Why(unittest.TestCase):
    def test_http_code_is_logged_but_not_exception_text(self):
        import urllib.error
        err = urllib.error.HTTPError("https://x/placeholder-secret", 503, "placeholder-secret", None, None)
        self.assertEqual(codex_review_status.why(err), "HTTP 503")
        self.assertEqual(codex_review_status.why(OSError("placeholder-secret")), "OSError")


if __name__ == "__main__":
    unittest.main()
