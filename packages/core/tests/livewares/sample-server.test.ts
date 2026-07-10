import { afterEach, describe, expect, it } from "vitest";
import { spawn, type ChildProcess } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const SAMPLE_SRC = path.resolve(__dirname, "../../../../livewares/openclaw/liveware-sample");

let child: ChildProcess | null = null;
let tmpDir = "";

async function waitForEventLines(file: string, count: number, timeoutMs = 5_000): Promise<string[]> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const lines = fs.readFileSync(file, "utf8").trim().split("\n").filter(Boolean);
      if (lines.length >= count) return lines;
    } catch { /* not written yet */ }
    await new Promise((r) => setTimeout(r, 25));
  }
  throw new Error(`events.jsonl did not reach ${count} line(s) within ${timeoutMs}ms`);
}

async function startSample(beforeSpawn?: (dir: string) => void, agentId?: string): Promise<number> {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "liveware-sample-"));
  for (const f of fs.readdirSync(SAMPLE_SRC)) {
    fs.copyFileSync(path.join(SAMPLE_SRC, f), path.join(tmpDir, f));
  }
  beforeSpawn?.(tmpDir);
  const args = [path.join(tmpDir, "server.mjs"), "--dir", tmpDir, "--port", "0"];
  if (agentId) args.push("--agent-id", agentId);
  child = spawn(process.execPath, args, { stdio: ["ignore", "pipe", "pipe"] });
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

const GOOD_SVG =
  '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64"><rect width="64" height="64" rx="14" fill="#FF812A"/><circle cx="32" cy="32" r="14" fill="#FFF"/></svg>';

function stateWithIcon(iconSvg: string) {
  return (dir: string) => {
    fs.writeFileSync(
      path.join(dir, "state.json"),
      JSON.stringify({ title: "Hello from your agent", body: "b", theme: "#FF812A", iconSvg }),
    );
  };
}

describe("liveware-sample server.mjs", () => {
  it("serves page, state, records events, pushes SSE on state change", async () => {
    const port = await startSample();
    const base = `http://127.0.0.1:${port}`;

    const health = await (await fetch(`${base}/healthz`)).json();
    expect(health).toEqual({ ok: true });

    const html = await (await fetch(`${base}/`)).text();
    // <title> is server-rendered from state.json (the client names liveware
    // surfaces by fetching it), so the default state title shows here.
    expect(html).toContain("<title>Hello from your agent</title>");

    const state = await (await fetch(`${base}/state`)).json();
    expect(state.title).toBe("Hello from your agent");

    const post = await fetch(`${base}/event`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ type: "click", payload: { button: "like" } }),
    });
    expect((await post.json()).ok).toBe(true);
    const events = await waitForEventLines(path.join(tmpDir, "events.jsonl"), 1);
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

  it("handles Chinese text in payload and maintains round-trip integrity", async () => {
    const port = await startSample();
    const base = `http://127.0.0.1:${port}`;
    const chineseText = "你好，Liveware 演示！";

    const post = await fetch(`${base}/event`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ type: "note", payload: { text: chineseText } }),
    });
    expect((await post.json()).ok).toBe(true);

    const events = await waitForEventLines(path.join(tmpDir, "events.jsonl"), 1);
    const lastEvent = JSON.parse(events[events.length - 1]!);
    expect(lastEvent.type).toBe("note");
    expect(lastEvent.payload.text).toBe(chineseText);
  });

  it("caps events.jsonl growth when it exceeds the size threshold", async () => {
    const fillerLine = JSON.stringify({ ts: 0, type: "filler", payload: { blob: "x".repeat(200) } });
    const port = await startSample((dir) => {
      const eventsPath = path.join(dir, "events.jsonl");
      const lineWithNewline = fillerLine + "\n";
      const targetBytes = 6 * 1024 * 1024;
      const repeats = Math.ceil(targetBytes / Buffer.byteLength(lineWithNewline, "utf8"));
      fs.writeFileSync(eventsPath, lineWithNewline.repeat(repeats));
      expect(fs.statSync(eventsPath).size).toBeGreaterThan(5 * 1024 * 1024);
    });
    const base = `http://127.0.0.1:${port}`;

    const post = await fetch(`${base}/event`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ type: "after-cap", payload: { marker: true } }),
    });
    expect((await post.json()).ok).toBe(true);

    const eventsPath = path.join(tmpDir, "events.jsonl");
    const deadline = Date.now() + 5_000;
    let lastLine = "";
    let size = Infinity;
    while (Date.now() < deadline) {
      size = fs.statSync(eventsPath).size;
      const lines = fs.readFileSync(eventsPath, "utf8").trim().split("\n").filter(Boolean);
      lastLine = lines[lines.length - 1] ?? "";
      if (size < 3 * 1024 * 1024 && JSON.parse(lastLine).type === "after-cap") break;
      await new Promise((r) => setTimeout(r, 25));
    }
    expect(JSON.parse(lastLine)).toMatchObject({ type: "after-cap", payload: { marker: true } });
    expect(size).toBeLessThan(3 * 1024 * 1024);
  }, 30_000);

  it("rejects an oversized /event payload and does not persist it", async () => {
    const port = await startSample();
    const base = `http://127.0.0.1:${port}`;
    const hugeText = "y".repeat(70 * 1024); // > 64KB MAX_EVENT_BYTES cap in server.mjs
    const body = JSON.stringify({ type: "note", payload: { text: hugeText } });

    try {
      const res = await fetch(`${base}/event`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body,
      });
      // If the request somehow completed, the server must still refuse it.
      expect(res.status).not.toBe(200);
    } catch (err) {
      // Expected path: the server destroys the connection mid-request once
      // the byte cap is exceeded, so fetch rejects with a network error.
      expect(err).toBeInstanceOf(Error);
    }

    // Give the server a moment to settle, then confirm the oversized
    // payload never made it into events.jsonl.
    await new Promise((r) => setTimeout(r, 300));
    const eventsPath = path.join(tmpDir, "events.jsonl");
    const content = fs.existsSync(eventsPath) ? fs.readFileSync(eventsPath, "utf8") : "";
    expect(content).not.toContain(hugeText);
  }, 15_000);

  it("merges --agent-id into /state and SSE state frames, alongside state.json fields", async () => {
    const port = await startSample(undefined, "usr_test123");
    const base = `http://127.0.0.1:${port}`;

    const state = await (await fetch(`${base}/state`)).json();
    expect(state).toMatchObject({
      title: "Hello from your agent",
      agentId: "usr_test123",
    });

    // SSE: subscribe, then mutate state.json, expect the pushed frame to
    // carry agentId alongside the new state fields.
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
    expect(received).toContain('"agentId":"usr_test123"');
  }, 30_000);

  it("omits agentId from /state when spawned without --agent-id", async () => {
    const port = await startSample();
    const base = `http://127.0.0.1:${port}`;

    const state = await (await fetch(`${base}/state`)).json();
    expect(state.title).toBe("Hello from your agent");
    expect("agentId" in state).toBe(false);
  });

  it("never passes a state.json-supplied agentId through — only the CLI value counts", async () => {
    const spoofState = (dir: string) => {
      fs.writeFileSync(
        path.join(dir, "state.json"),
        JSON.stringify({ title: "Hello from your agent", body: "b", theme: "#000000", agentId: "usr_evil" }),
      );
    };

    // Without --agent-id: the spoofed key must not surface at all.
    const portNoFlag = await startSample(spoofState);
    const stateNoFlag = await (await fetch(`http://127.0.0.1:${portNoFlag}/state`)).json();
    expect("agentId" in stateNoFlag).toBe(false);
    child?.kill("SIGTERM");
    child = null;
    fs.rmSync(tmpDir, { recursive: true, force: true });

    // With --agent-id: only the CLI-provided value must show, never the spoofed one.
    const portWithFlag = await startSample(spoofState, "usr_test123");
    const stateWithFlag = await (await fetch(`http://127.0.0.1:${portWithFlag}/state`)).json();
    expect(stateWithFlag.agentId).toBe("usr_test123");
  });

  it("renders the current state.json title into the served <title> tag", async () => {
    // The ClawChat client resolves a liveware's display name by fetching the
    // page HTML and parsing <title> (no JS execution) — a rename via state.json
    // must therefore be server-rendered, or every client surface stays stale.
    const port = await startSample((dir) => {
      fs.writeFileSync(
        path.join(dir, "state.json"),
        JSON.stringify({ title: "氪星球", body: "b", theme: "#FF812A" }),
      );
    });
    const html = await (await fetch(`http://127.0.0.1:${port}/`)).text();
    expect(html).toContain("<title>氪星球</title>");
    expect(html).not.toContain("<title>Liveware Sample</title>");
  });

  it("HTML-escapes the state.json title and falls back to the static tag when state is unreadable", async () => {
    const port = await startSample((dir) => {
      fs.writeFileSync(
        path.join(dir, "state.json"),
        JSON.stringify({ title: '<script>alert(1)</script>&"', body: "b", theme: "#FF812A" }),
      );
    });
    const html = await (await fetch(`http://127.0.0.1:${port}/`)).text();
    expect(html).not.toContain("<script>alert(1)</script>");
    expect(html).toContain("&lt;script&gt;alert(1)&lt;/script&gt;&amp;&quot;");
    child?.kill("SIGTERM");
    child = null;
    fs.rmSync(tmpDir, { recursive: true, force: true });

    // Unparseable state.json → serve index.html untouched (static fallback title).
    const portBroken = await startSample((dir) => {
      fs.writeFileSync(path.join(dir, "state.json"), "{not json");
    });
    const htmlBroken = await (await fetch(`http://127.0.0.1:${portBroken}/`)).text();
    expect(htmlBroken).toContain("<title>Liveware Sample</title>");
  });

  it("serves a valid iconSvg at /icon.svg with image-context security headers", async () => {
    const port = await startSample(stateWithIcon(GOOD_SVG));
    const res = await fetch(`http://127.0.0.1:${port}/icon.svg`);
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("image/svg+xml");
    expect(res.headers.get("x-content-type-options")).toBe("nosniff");
    expect(res.headers.get("content-security-policy")).toBe(
      "default-src 'none'; style-src 'unsafe-inline'",
    );
    expect(res.headers.get("cache-control")).toBe("public, max-age=31536000, immutable");
    expect(await res.text()).toBe(GOOD_SVG);
  });

  it("404s /icon.svg when state.json has no iconSvg", async () => {
    const port = await startSample();
    expect((await fetch(`http://127.0.0.1:${port}/icon.svg`)).status).toBe(404);
  });

  it("rejects unsafe or malformed iconSvg values with a 404 (whole-value reject, no sanitize-and-serve)", async () => {
    const bad: Array<[string, string]> = [
      ["script element", '<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>'],
      ["event handler attribute", '<svg xmlns="http://www.w3.org/2000/svg" onload="alert(1)"></svg>'],
      ["foreignObject", '<svg xmlns="http://www.w3.org/2000/svg"><foreignObject>x</foreignObject></svg>'],
      ["external href", '<svg xmlns="http://www.w3.org/2000/svg"><a href="https://evil.example">x</a></svg>'],
      ["external xlink:href", '<svg xmlns="http://www.w3.org/2000/svg"><use xlink:href="https://evil.example/s.svg#i"/></svg>'],
      ["data: URI", '<svg xmlns="http://www.w3.org/2000/svg"><image href="data:image/png;base64,AAAA"/></svg>'],
      ["image element even with fragment href", '<svg xmlns="http://www.w3.org/2000/svg"><image href="#local"/></svg>'],
      ["trailing content after root", '<svg xmlns="http://www.w3.org/2000/svg"></svg><b>tail</b>'],
      ["not an svg root", "<div>hi</div>"],
      ["oversize", `<svg xmlns="http://www.w3.org/2000/svg"><desc>${"x".repeat(17 * 1024)}</desc></svg>`],
    ];
    for (const [label, svg] of bad) {
      const port = await startSample(stateWithIcon(svg));
      const res = await fetch(`http://127.0.0.1:${port}/icon.svg`);
      expect(res.status, label).toBe(404);
      child?.kill("SIGTERM");
      child = null;
      fs.rmSync(tmpDir, { recursive: true, force: true });
      tmpDir = "";
    }
  }, 60_000);

  it("renders a versioned <link rel=icon> and exposes iconVersion (never raw iconSvg) via /state + SSE", async () => {
    const port = await startSample(stateWithIcon(GOOD_SVG));
    const base = `http://127.0.0.1:${port}`;

    const html = await (await fetch(`${base}/`)).text();
    const m = html.match(
      /<link rel="icon" type="image\/svg\+xml" href="\/icon\.svg\?v=([0-9a-f]{8})" \/>/,
    );
    expect(m).not.toBeNull();

    const state = await (await fetch(`${base}/state`)).json();
    expect(state.iconVersion).toBe(m![1]);
    expect("iconSvg" in state).toBe(false);

    // SSE: subscribe, swap in a DIFFERENT svg, expect the frame to carry a
    // NEW iconVersion and never the raw markup.
    const controller = new AbortController();
    const sse = await fetch(`${base}/sse`, { signal: controller.signal });
    const reader = sse.body!.getReader();
    const BLUE_SVG =
      '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64"><circle cx="32" cy="32" r="28" fill="#1E66F5"/></svg>';
    fs.writeFileSync(
      path.join(tmpDir, "state.json"),
      JSON.stringify({ title: "Changed by agent", body: "b", theme: "#000000", iconSvg: BLUE_SVG }),
    );
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
    expect(received).toContain('"iconVersion":"');
    expect(received).not.toContain("iconSvg");

    // Content change → different hash (the cache-busting contract).
    const state2 = await (await fetch(`${base}/state`)).json();
    expect(state2.iconVersion).toMatch(/^[0-9a-f]{8}$/);
    expect(state2.iconVersion).not.toBe(state.iconVersion);
  }, 30_000);

  it("omits <link rel=icon> and iconVersion when iconSvg is missing or invalid", async () => {
    const portNone = await startSample();
    const htmlNone = await (await fetch(`http://127.0.0.1:${portNone}/`)).text();
    expect(htmlNone).not.toContain('rel="icon"');
    const stateNone = await (await fetch(`http://127.0.0.1:${portNone}/state`)).json();
    expect("iconVersion" in stateNone).toBe(false);
    child?.kill("SIGTERM");
    child = null;
    fs.rmSync(tmpDir, { recursive: true, force: true });
    tmpDir = "";

    const portBad = await startSample(
      stateWithIcon('<svg xmlns="http://www.w3.org/2000/svg" onload="alert(1)"></svg>'),
    );
    const htmlBad = await (await fetch(`http://127.0.0.1:${portBad}/`)).text();
    expect(htmlBad).not.toContain('rel="icon"');
    const stateBad = await (await fetch(`http://127.0.0.1:${portBad}/state`)).json();
    expect("iconVersion" in stateBad).toBe(false);
  });

  it("never streams raw state.json bytes from /state when the file is unparsable", async () => {
    const port = await startSample((dir) => {
      fs.writeFileSync(
        path.join(dir, "state.json"),
        '{not json "iconSvg": "<svg onload=evil()>"',
      );
    });
    const res = await fetch(`http://127.0.0.1:${port}/state`);
    expect(res.status).toBe(503);
    const body = await res.text();
    expect(body).not.toContain("iconSvg");
    expect(body).not.toContain("<svg");
  });
});
