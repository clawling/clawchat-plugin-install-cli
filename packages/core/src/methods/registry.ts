import * as fs from "node:fs";
import * as path from "node:path";
import { DEFAULT_BASE_URL, MAX_UPLOAD_BYTES } from "../config";
import { ClawchatError } from "../errors";
import { requestJson, requestMultipart } from "../http/client";
import { optionalPositiveInteger, pickDefined, requireString } from "./input";
import type { MethodContext, MethodName } from "./types";

function requireAuthToken(method: MethodName, ctx: MethodContext): string {
  if (!ctx.auth?.token) {
    throw new ClawchatError(
      "AUTH_MISSING",
      `ClawChat token not found for ${ctx.target}; activate the target plugin before calling ${method}`,
    );
  }
  return ctx.auth.token;
}

function resolveBaseUrl(ctx: MethodContext): string {
  return ctx.baseUrl || ctx.auth?.baseUrl || DEFAULT_BASE_URL;
}

function buildFileForm(input: Record<string, unknown>, method: MethodName): FormData {
  const filePath = requireString(input, "filePath", method);
  if (!path.isAbsolute(filePath)) {
    throw new ClawchatError("INVALID_INPUT", "filePath must be an absolute path");
  }

  let stat: fs.Stats;
  try {
    stat = fs.statSync(filePath);
  } catch {
    throw new ClawchatError("INVALID_INPUT", `filePath does not exist: ${filePath}`);
  }
  if (!stat.isFile()) {
    throw new ClawchatError("INVALID_INPUT", `filePath must be a file: ${filePath}`);
  }
  if (stat.size > MAX_UPLOAD_BYTES) {
    throw new ClawchatError("INVALID_INPUT", "filePath must be 20MB or smaller");
  }

  const form = new FormData();
  form.append("file", new Blob([fs.readFileSync(filePath)]), path.basename(filePath));
  return form;
}

export async function callClawchatMethod(
  method: MethodName,
  input: Record<string, unknown>,
  ctx: MethodContext,
): Promise<unknown> {
  const baseUrl = resolveBaseUrl(ctx);

  switch (method) {
    case "activate": {
      // Apifox: POST /agents/connect requires X-Device-Id. Runtime API uses the /v1 prefix.
      const code = requireString(input, "code", method);
      return requestJson(
        baseUrl,
        "/v1/agents/connect",
        {
          method: "POST",
          headers: { "X-Device-Id": `clawchat-plugin-install-cli-${ctx.target}` },
          body: {
            code,
            platform: ctx.target,
            type: "clawbot",
          },
        },
        { fetchFn: ctx.fetchFn },
      );
    }
    case "get_account_profile": {
      // Apifox: GET /users/me. Runtime API uses the /v1 prefix.
      return requestJson(
        baseUrl,
        "/v1/users/me",
        { method: "GET", token: requireAuthToken(method, ctx) },
        { fetchFn: ctx.fetchFn },
      );
    }
    case "get_user_profile": {
      // Apifox: GET /users/{id}. Runtime API uses /v1 and the CLI input name userId.
      const userId = encodeURIComponent(requireString(input, "userId", method));
      return requestJson(
        baseUrl,
        `/v1/users/${userId}`,
        { method: "GET", token: requireAuthToken(method, ctx) },
        { fetchFn: ctx.fetchFn },
      );
    }
    case "list_account_friends": {
      // Apifox: GET /friendships. Runtime API uses /v1 and CLI adds page/pageSize query params.
      const page = optionalPositiveInteger(input, "page", 1);
      const pageSize = optionalPositiveInteger(input, "pageSize", 20);
      if (pageSize > 100) {
        throw new ClawchatError("INVALID_INPUT", "pageSize must be between 1 and 100");
      }
      return requestJson(
        baseUrl,
        `/v1/friendships?page=${page}&pageSize=${pageSize}`,
        { method: "GET", token: requireAuthToken(method, ctx) },
        { fetchFn: ctx.fetchFn },
      );
    }
    case "update_account_profile": {
      // Apifox: PATCH /users/me. Runtime API uses the /v1 prefix.
      const body = pickDefined(input, ["nickname", "avatar_url", "bio"]);
      if (Object.keys(body).length === 0) {
        throw new ClawchatError(
          "INVALID_INPUT",
          "update_account_profile requires at least one of nickname, avatar_url, bio",
        );
      }
      return requestJson(
        baseUrl,
        "/v1/users/me",
        { method: "PATCH", token: requireAuthToken(method, ctx), body },
        { fetchFn: ctx.fetchFn },
      );
    }
    case "upload_avatar_image": {
      // Apifox: POST /files/upload-url multipart field `file`. Runtime API uses /v1.
      return requestMultipart(
        baseUrl,
        "/v1/files/upload-url",
        { token: requireAuthToken(method, ctx), form: buildFileForm(input, method) },
        { fetchFn: ctx.fetchFn },
      );
    }
    case "upload_media_file": {
      // Not present in current Apifox OAS. Product requirement uses POST /media/upload.
      return requestMultipart(
        baseUrl,
        "/media/upload",
        { token: requireAuthToken(method, ctx), form: buildFileForm(input, method) },
        { fetchFn: ctx.fetchFn },
      );
    }
    default: {
      const neverMethod: never = method;
      throw new ClawchatError("UNKNOWN_METHOD", `Unknown ClawChat method: ${neverMethod}`);
    }
  }
}

export const METHOD_NAMES: readonly MethodName[] = [
  "activate",
  "get_account_profile",
  "get_user_profile",
  "list_account_friends",
  "update_account_profile",
  "upload_avatar_image",
  "upload_media_file",
];
