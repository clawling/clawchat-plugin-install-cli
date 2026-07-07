import { afterEach, describe, expect, it } from "vitest";
import { spawn, type ChildProcess } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const SAMPLE_SRC = path.resolve(__dirname, "../../../../livewares/openclaw/liveware-sample");

let child: ChildProcess | null = null;
let tmpDir = "";

async function startSample(): Promise<number> {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "liveware-sample-"));
  for (const f of fs.readdirSync(SAMPLE_SRC)) {
    fs.copyFileSync(path.join(SAMPLE_SRC, f), path.join(tmpDir, f));
  }
  child = spawn(process.execPath, [
    path.join(tmpDir, "server.mjs"), "--dir", tmpDir, "--port", "0",
  ], { stdio: ["ignore", "pipe", "pipe"] });
  return await new Promise<number>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("server did not report port")), 10_000);
    let buf = "";
    child!.stdout!.on("data", (chunk: Buffer) => {
      buf += chunk.toString();
      const line = buf.split("\n").find((l) => l.trim().startsWith("{"));
      if (!line) return;
      clearTimeout(timer);
      resolve(JSON.parse(line).port as number);
    });
    child!.on("exit", (code) => { clearTimeout(timer); reject(new Error(`exit ${code}`)); });
  });
}

afterEach(() => {
  child?.kill("SIGTERM");
  child = null;
  if (tmpDir) fs.rmSync(tmpDir, { recursive: true, force: true });
  tmpDir = "";
});

describe("liveware-sample server.mjs", () => {
  it("serves page, state, records events, pushes SSE on state change", async () => {
    const port = await startSample();
    const base = `http://127.0.0.1:${port}`;

    const health = await (await fetch(`${base}/healthz`)).json();
    expect(health).toEqual({ ok: true });

    const html = await (await fetch(`${base}/`)).text();
    expect(html).toContain("Liveware Sample");

    const state = await (await fetch(`${base}/state`)).json();
    expect(state.title).toBe("Hello from your agent");

    const post = await fetch(`${base}/event`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ type: "click", payload: { button: "like" } }),
    });
    expect((await post.json()).ok).toBe(true);
    const events = fs.readFileSync(path.join(tmpDir, "events.jsonl"), "utf8").trim().split("\n");
    expect(JSON.parse(events[0]!)).toMatchObject({ type: "click", payload: { button: "like" } });

    // SSE: subscribe, then mutate state.json, expect a `state` event with new title.
    const controller = new AbortController();
    const sse = await fetch(`${base}/sse`, { signal: controller.signal });
    const reader = sse.body!.getReader();
    const newState = { title: "Changed by agent", body: "b", theme: "#000000" };
    fs.writeFileSync(path.join(tmpDir, "state.json"), JSON.stringify(newState));
    const received = await new Promise<string>(async (resolve, reject) => {
      const timer = setTimeout(() => reject(new Error("no SSE event")), 10_000);
      let acc = "";
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        acc += Buffer.from(value).toString();
        if (acc.includes("Changed by agent")) { clearTimeout(timer); resolve(acc); return; }
      }
      clearTimeout(timer);
      reject(new Error("stream ended"));
    });
    controller.abort();
    expect(received).toContain("event: state");
  }, 30_000);

  it("probes upward when the start port is occupied", async () => {
    const port = await startSample();
    // Start a second copy asking for the SAME port; it must pick a different one.
    const src = tmpDir;
    const child2 = spawn(process.execPath, [
      path.join(src, "server.mjs"), "--dir", src, "--port", String(port),
    ], { stdio: ["ignore", "pipe", "pipe"] });
    try {
      const port2 = await new Promise<number>((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error("no port line")), 10_000);
        let buf = "";
        child2.stdout!.on("data", (c: Buffer) => {
          buf += c.toString();
          const line = buf.split("\n").find((l) => l.trim().startsWith("{"));
          if (!line) return;
          clearTimeout(timer);
          resolve(JSON.parse(line).port as number);
        });
      });
      expect(port2).not.toBe(port);
    } finally {
      child2.kill("SIGTERM");
    }
  }, 30_000);
});
