import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { callClawchatMethod } from "../../src/methods/registry";

const dirs: string[] = [];

function tmpFile(size = 3): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "clawchat-upload-"));
  dirs.push(dir);
  const filePath = path.join(dir, "avatar.png");
  fs.writeFileSync(filePath, Buffer.alloc(size, 1));
  return filePath;
}

function jsonResponse(data: unknown): Response {
  return new Response(JSON.stringify({ data }), {
    status: 200,
    headers: { "content-type": "application/json" },
  });
}

afterEach(() => {
  for (const dir of dirs.splice(0)) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

describe("upload methods", () => {
  it("uploads avatar image as multipart field file", async () => {
    const filePath = tmpFile();
    const fetchFn = vi.fn<Parameters<typeof fetch>, ReturnType<typeof fetch>>(
      async () => jsonResponse({ url: "http://file" }),
    );

    await callClawchatMethod("upload_avatar_image", { filePath }, {
      target: "openclaw",
      baseUrl: "http://server",
      fetchFn,
      auth: { target: "openclaw", token: "access-token" },
    });

    const [url, init] = fetchFn.mock.calls[0]!;
    expect(url).toBe("http://server/v1/files/upload-url");
    expect(init).toBeDefined();
    const requestInit = init!;
    expect(requestInit.method).toBe("POST");
    expect(requestInit.headers).toEqual({ authorization: "Bearer access-token" });
    expect(requestInit.body).toBeInstanceOf(FormData);
    expect((requestInit.body as FormData).get("file")).toBeInstanceOf(Blob);
  });

  it("uploads media file to /media/upload", async () => {
    const filePath = tmpFile();
    const fetchFn = vi.fn<Parameters<typeof fetch>, ReturnType<typeof fetch>>(
      async () => jsonResponse({ url: "http://file" }),
    );

    await callClawchatMethod("upload_media_file", { filePath }, {
      target: "hermes",
      baseUrl: "http://server",
      fetchFn,
      auth: { target: "hermes", token: "access-token" },
    });

    expect(fetchFn.mock.calls[0]![0]).toBe("http://server/media/upload");
  });

  it("rejects relative paths", async () => {
    await expect(
      callClawchatMethod("upload_avatar_image", { filePath: "avatar.png" }, {
        target: "openclaw",
        baseUrl: "http://server",
        fetchFn: vi.fn(),
        auth: { target: "openclaw", token: "access-token" },
      }),
    ).rejects.toThrow("filePath must be an absolute path");
  });

  it("rejects files over 20MB", async () => {
    const filePath = tmpFile(20 * 1024 * 1024 + 1);

    await expect(
      callClawchatMethod("upload_media_file", { filePath }, {
        target: "openclaw",
        baseUrl: "http://server",
        fetchFn: vi.fn(),
        auth: { target: "openclaw", token: "access-token" },
      }),
    ).rejects.toThrow("filePath must be 20MB or smaller");
  });
});
