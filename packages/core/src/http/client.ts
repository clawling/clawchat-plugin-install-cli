import { ClawchatError } from "../errors";

export type FetchLike = typeof fetch;

export interface RequestOptions {
  fetchFn?: FetchLike;
  token?: string;
}

function trimBaseUrl(baseUrl: string): string {
  return baseUrl.replace(/\/+$/, "");
}

export function buildUrl(baseUrl: string, path: string): string {
  return `${trimBaseUrl(baseUrl)}${path}`;
}

async function parseResponse(response: Response): Promise<unknown> {
  const text = await response.text();
  if (!text) {
    return null;
  }
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return text;
  }
}

export async function requestJson(
  baseUrl: string,
  path: string,
  init: {
    method: "GET" | "POST" | "PATCH";
    token?: string;
    body?: Record<string, unknown>;
    headers?: Record<string, string>;
  },
  options: RequestOptions = {},
): Promise<unknown> {
  const headers: Record<string, string> = { ...init.headers };
  if (init.token) {
    headers.authorization = `Bearer ${init.token}`;
  }
  if (init.body !== undefined) {
    headers["content-type"] = "application/json";
  }

  const fetchFn = options.fetchFn ?? fetch;
  const response = await fetchFn(buildUrl(baseUrl, path), {
    method: init.method,
    headers,
    body: init.body === undefined ? undefined : JSON.stringify(init.body),
  });
  const parsed = await parseResponse(response);
  if (!response.ok) {
    throw new ClawchatError(
      "HTTP_ERROR",
      `ClawChat request failed with status ${response.status}: ${JSON.stringify(parsed)}`,
    );
  }
  return parsed;
}

export async function requestMultipart(
  baseUrl: string,
  path: string,
  init: {
    token: string;
    form: FormData;
  },
  options: RequestOptions = {},
): Promise<unknown> {
  const fetchFn = options.fetchFn ?? fetch;
  const response = await fetchFn(buildUrl(baseUrl, path), {
    method: "POST",
    headers: { authorization: `Bearer ${init.token}` },
    body: init.form,
  });
  const parsed = await parseResponse(response);
  if (!response.ok) {
    throw new ClawchatError(
      "HTTP_ERROR",
      `ClawChat request failed with status ${response.status}: ${JSON.stringify(parsed)}`,
    );
  }
  return parsed;
}
