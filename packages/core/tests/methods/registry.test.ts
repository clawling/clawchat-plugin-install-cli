import { describe, expect, it, vi } from "vitest";
import { callClawchatMethod } from "../../src/methods/registry";

function jsonResponse(data: unknown): Response {
  return new Response(JSON.stringify({ data }), {
    status: 200,
    headers: { "content-type": "application/json" },
  });
}

describe("callClawchatMethod", () => {
  it("calls activate without an existing token and adds platform/type", async () => {
    const fetchFn = vi.fn(async () => jsonResponse({ ok: true }));

    await callClawchatMethod("activate", { code: "INVITE" }, {
      target: "openclaw",
      baseUrl: "http://server",
      fetchFn,
      auth: null,
    });

    expect(fetchFn).toHaveBeenCalledWith("http://server/v1/agents/connect", {
      method: "POST",
      headers: {
        "X-Device-Id": "clawchat-plugin-install-cli-openclaw",
        "content-type": "application/json",
      },
      body: JSON.stringify({
        code: "INVITE",
        platform: "openclaw",
        type: "clawbot",
      }),
    });
  });

  it("uses bearer token for authenticated JSON methods", async () => {
    const fetchFn = vi.fn(async () => jsonResponse({ id: "me" }));

    await callClawchatMethod("get_account_profile", {}, {
      target: "hermes",
      baseUrl: "http://server",
      fetchFn,
      auth: { target: "hermes", token: "access-token" },
    });

    expect(fetchFn).toHaveBeenCalledWith("http://server/v1/users/me", {
      method: "GET",
      headers: { authorization: "Bearer access-token" },
    });
  });

  it("maps get_user_profile to /v1/users/{userId}", async () => {
    const fetchFn = vi.fn(async () => jsonResponse({ id: "usr_123" }));

    await callClawchatMethod("get_user_profile", { userId: "usr_123" }, {
      target: "openclaw",
      baseUrl: "http://server/",
      fetchFn,
      auth: { target: "openclaw", token: "access-token" },
    });

    expect(fetchFn).toHaveBeenCalledWith("http://server/v1/users/usr_123", {
      method: "GET",
      headers: { authorization: "Bearer access-token" },
    });
  });

  it("defaults friend pagination and validates pageSize", async () => {
    const fetchFn = vi.fn(async () => jsonResponse({ friends: [] }));

    await callClawchatMethod("list_account_friends", {}, {
      target: "openclaw",
      baseUrl: "http://server",
      fetchFn,
      auth: { target: "openclaw", token: "access-token" },
    });

    expect(fetchFn).toHaveBeenCalledWith(
      "http://server/v1/friendships?page=1&pageSize=20",
      { method: "GET", headers: { authorization: "Bearer access-token" } },
    );

    await expect(
      callClawchatMethod("list_account_friends", { pageSize: 101 }, {
        target: "openclaw",
        baseUrl: "http://server",
        fetchFn,
        auth: { target: "openclaw", token: "access-token" },
      }),
    ).rejects.toThrow("pageSize must be between 1 and 100");

    await expect(
      callClawchatMethod("list_account_friends", { page: 0 }, {
        target: "openclaw",
        baseUrl: "http://server",
        fetchFn,
        auth: { target: "openclaw", token: "access-token" },
      }),
    ).rejects.toThrow("page must be a positive integer");

    await expect(
      callClawchatMethod("list_account_friends", { pageSize: 0 }, {
        target: "openclaw",
        baseUrl: "http://server",
        fetchFn,
        auth: { target: "openclaw", token: "access-token" },
      }),
    ).rejects.toThrow("pageSize must be a positive integer");
  });

  it("maps update_account_profile to PATCH /v1/users/me with supplied profile fields", async () => {
    const fetchFn = vi.fn(async () => jsonResponse({ id: "me" }));

    await callClawchatMethod(
      "update_account_profile",
      {
        nickname: "Claw User",
        avatar_url: "http://file/avatar.png",
        bio: "hello",
        ignored: "field",
      },
      {
        target: "openclaw",
        baseUrl: "http://server",
        fetchFn,
        auth: { target: "openclaw", token: "access-token" },
      },
    );

    expect(fetchFn).toHaveBeenCalledWith("http://server/v1/users/me", {
      method: "PATCH",
      headers: {
        authorization: "Bearer access-token",
        "content-type": "application/json",
      },
      body: JSON.stringify({
        nickname: "Claw User",
        avatar_url: "http://file/avatar.png",
        bio: "hello",
      }),
    });
  });

  it("requires at least one update profile field", async () => {
    const fetchFn = vi.fn(async () => jsonResponse({}));

    await expect(
      callClawchatMethod("update_account_profile", {}, {
        target: "openclaw",
        baseUrl: "http://server",
        fetchFn,
        auth: { target: "openclaw", token: "access-token" },
      }),
    ).rejects.toThrow("update_account_profile requires at least one of nickname, avatar_url, bio");
  });

  it("fails authenticated calls without a token", async () => {
    const fetchFn = vi.fn(async () => jsonResponse({}));

    await expect(
      callClawchatMethod("get_account_profile", {}, {
        target: "openclaw",
        baseUrl: "http://server",
        fetchFn,
        auth: null,
      }),
    ).rejects.toThrow("ClawChat token not found for openclaw");
  });
});
