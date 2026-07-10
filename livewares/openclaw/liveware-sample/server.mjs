#!/usr/bin/env node
// ClawChat liveware sample — zero-dependency demo web service.
// Contract (consumed by the ClawChat plugin supervisor):
//   node server.mjs --dir <dir> --port <startPort> [--agent-id <clawchat user id>]
//   * prints ONE stdout line `{"port":N}` once listening
//   * GET / , /app.js , /state , /sse , /healthz , /icon.svg ; POST /event
// state.json edits (by the agent) are pushed to the page via SSE;
// page interactions are appended to events.jsonl (read by the agent).
// --agent-id (the agent's own ClawChat user id) is merged into /state
// responses and SSE frames as `agentId` — never written into state.json —
// so the page can mint its back-to-chat deep link.
import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";

function arg(name, fallback) {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : fallback;
}

const dir = path.resolve(arg("dir", "."));
const startPort = Number(arg("port", "43110"));
const agentId = String(arg("agent-id", "")).trim();

function stateWithMeta(state) {
  // state.json is agent-writable and the page renders a deep link from this
  // field — only the supervisor-provided CLI value may populate it, so strip
  // any `agentId` key an agent (or a malicious /event-adjacent write) put
  // directly into state.json before merging in the trusted CLI value.
  // `iconSvg` is likewise stripped: the page must never receive raw SVG (it
  // could get inlined into the DOM someday) — it gets a content-hash
  // `iconVersion` instead and loads the icon via <img src="/icon.svg?v=…">,
  // keeping the SVG in an image context where scripts never execute.
  const { agentId: _ignored, iconSvg, ...rest } = state;
  const out = agentId ? { ...rest, agentId } : rest;
  const icon = validateIconSvg(iconSvg);
  if (icon) out.iconVersion = iconHash(icon);
  return out;
}

const STATE_FILE = path.join(dir, "state.json");
const EVENTS_FILE = path.join(dir, "events.jsonl");
const MAX_EVENT_BYTES = 64 * 1024;
const MAX_EVENTS_BYTES = 5 * 1024 * 1024;
const PORT_PROBE_ATTEMPTS = 20;
const ICON_MAX_BYTES = 16 * 1024;
// Reject-list, case-insensitive. A hit rejects the WHOLE value — no
// sanitize-and-rewrite (rewriting untrusted markup is where sanitizers fail).
// The SVG is agent-authored, but an agent can be talked into copying hostile
// markup from the conversation, so the enforcement point is here at the exit.
const ICON_REJECT_RE =
  /<script|<foreignobject|<iframe|<embed|<image|<!doctype|<!entity|<\?|javascript:|data:|\bon[a-z]+\s*=/i;
// Every href / xlink:href value must be a local fragment (#…) — no external fetches.
const ICON_HREF_RE = /(?:xlink:)?href\s*=\s*("([^"]*)"|'([^']*)'|([^\s>]+))/gi;

function validateIconSvg(value) {
  if (typeof value !== "string") return null;
  const svg = value.trim();
  if (!svg || Buffer.byteLength(svg, "utf8") > ICON_MAX_BYTES) return null;
  if (!/^<svg[\s>]/i.test(svg) || !/<\/svg>$/i.test(svg)) return null;
  if (ICON_REJECT_RE.test(svg)) return null;
  for (const m of svg.matchAll(ICON_HREF_RE)) {
    const v = (m[2] ?? m[3] ?? m[4] ?? "").trim();
    if (!v.startsWith("#")) return null;
  }
  return svg;
}

function iconHash(svg) {
  return crypto.createHash("sha256").update(svg, "utf8").digest("hex").slice(0, 8);
}

// events.jsonl is appended to on every /event POST (unauthenticated, reachable
// through the public tunnel). Cap its growth: once it exceeds MAX_EVENTS_BYTES,
// keep only the newest ~half (by lines) before the next append.
function capEventsFileIfNeeded() {
  let stat;
  try {
    stat = fs.statSync(EVENTS_FILE);
  } catch {
    return; // file doesn't exist yet — nothing to cap
  }
  if (stat.size <= MAX_EVENTS_BYTES) return;
  try {
    const content = fs.readFileSync(EVENTS_FILE, "utf8");
    const lines = content.split("\n").filter((l) => l.length > 0);
    const targetBytes = MAX_EVENTS_BYTES / 2;
    let kept = [];
    let bytes = 0;
    for (let i = lines.length - 1; i >= 0; i--) {
      const lineBytes = Buffer.byteLength(lines[i], "utf8") + 1;
      if (bytes + lineBytes > targetBytes) break;
      kept.push(lines[i]);
      bytes += lineBytes;
    }
    kept.reverse();
    fs.writeFileSync(EVENTS_FILE, kept.length ? kept.join("\n") + "\n" : "");
  } catch {
    // best-effort; if truncation fails, leave the file as-is rather than lose data
  }
}

const sseClients = new Set();

function readStateJson() {
  // state.json may be mid-write when watched; treat parse failures as "skip".
  try {
    return JSON.parse(fs.readFileSync(STATE_FILE, "utf8"));
  } catch {
    return null;
  }
}

let notifyTimer = null;
fs.watch(dir, (_event, filename) => {
  if (filename !== "state.json") return;
  clearTimeout(notifyTimer);
  notifyTimer = setTimeout(() => {
    const state = readStateJson();
    if (state == null) return;
    const frame = `event: state\ndata: ${JSON.stringify(stateWithMeta(state))}\n\n`;
    for (const res of sseClients) res.write(frame);
  }, 100);
});

function serveFile(res, filename, mime) {
  fs.readFile(path.join(dir, filename), (err, buf) => {
    if (err) {
      res.writeHead(404, { "content-type": "text/plain" }).end("not found");
      return;
    }
    res.writeHead(200, { "content-type": mime }).end(buf);
  });
}

function escapeHtml(s) {
  return s
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

// The ClawChat client names every liveware surface (launcher tile, 活件卡,
// container chrome) from the page HTML's <title> — fetched without running
// JS. A rename via state.json must therefore be rendered server-side, or the
// client keeps resolving the stale static title.
function serveIndexHtml(res) {
  fs.readFile(path.join(dir, "index.html"), (err, buf) => {
    if (err) {
      res.writeHead(404, { "content-type": "text/plain" }).end("not found");
      return;
    }
    const state = readStateJson();
    const title = typeof state?.title === "string" ? state.title.trim() : "";
    let html = buf.toString("utf8");
    if (title) html = html.replace(/<title>[^<]*<\/title>/, `<title>${escapeHtml(title)}</title>`);
    // The ClawChat client resolves a liveware's icon from the served HTML's
    // <link rel=icon> (no JS execution) — like <title>, it must be rendered
    // server-side or every client surface stays on the ✦ fallback.
    const icon = validateIconSvg(state?.iconSvg);
    if (icon) {
      html = html.replace(
        "</head>",
        `  <link rel="icon" type="image/svg+xml" href="/icon.svg?v=${iconHash(icon)}" />\n</head>`,
      );
    }
    res.writeHead(200, { "content-type": "text/html; charset=utf-8" }).end(html);
  });
}

const server = http.createServer((req, res) => {
  const url = (req.url || "/").split("?")[0];

  if (req.method === "GET" && url === "/") return serveIndexHtml(res);
  if (req.method === "GET" && url === "/app.js") return serveFile(res, "app.js", "text/javascript; charset=utf-8");
  if (req.method === "GET" && url === "/state") {
    const state = readStateJson();
    if (state == null) return serveFile(res, "state.json", "application/json; charset=utf-8");
    return res
      .writeHead(200, { "content-type": "application/json; charset=utf-8" })
      .end(JSON.stringify(stateWithMeta(state)));
  }
  if (req.method === "GET" && url === "/healthz") {
    return res.writeHead(200, { "content-type": "application/json" }).end('{"ok":true}');
  }
  if (req.method === "GET" && url === "/icon.svg") {
    const icon = validateIconSvg(readStateJson()?.iconSvg);
    if (!icon) return res.writeHead(404, { "content-type": "text/plain" }).end("not found");
    return res
      .writeHead(200, {
        "content-type": "image/svg+xml",
        "x-content-type-options": "nosniff",
        "content-security-policy": "default-src 'none'; style-src 'unsafe-inline'",
        // The <link>/<img> URL always carries the content hash (?v=), so
        // long-lived immutable caching is safe.
        "cache-control": "public, max-age=31536000, immutable",
      })
      .end(icon);
  }
  if (req.method === "GET" && url === "/sse") {
    res.writeHead(200, {
      "content-type": "text/event-stream",
      "cache-control": "no-cache",
      connection: "keep-alive",
    });
    res.write(": connected\n\n");
    sseClients.add(res);
    req.on("close", () => sseClients.delete(res));
    return;
  }
  if (req.method === "POST" && url === "/event") {
    let chunks = [];
    let received = 0;
    let overflow = false;
    req.on("data", (chunk) => {
      received += chunk.length;
      if (received > MAX_EVENT_BYTES) { overflow = true; req.destroy(); return; }
      chunks.push(chunk);
    });
    req.on("end", () => {
      if (overflow) return;
      let parsed;
      try {
        parsed = JSON.parse(Buffer.concat(chunks).toString("utf8"));
      } catch {
        res.writeHead(400, { "content-type": "application/json" }).end('{"error":"bad json"}');
        return;
      }
      const line = JSON.stringify({
        ts: Date.now(),
        type: typeof parsed.type === "string" ? parsed.type : "unknown",
        payload: parsed.payload ?? null,
      });
      capEventsFileIfNeeded();
      fs.appendFile(EVENTS_FILE, line + "\n", () => {});
      res.writeHead(200, { "content-type": "application/json" }).end('{"ok":true}');
    });
    return;
  }
  res.writeHead(404, { "content-type": "text/plain" }).end("not found");
});

function listen(port, attemptsLeft) {
  server.once("error", (err) => {
    if (err && err.code === "EADDRINUSE" && port !== 0 && attemptsLeft > 0) {
      listen(port + 1, attemptsLeft - 1);
      return;
    }
    console.error(String(err));
    process.exit(1);
  });
  server.listen(port, "127.0.0.1", () => {
    server.removeAllListeners("error");
    process.stdout.write(JSON.stringify({ port: server.address().port }) + "\n");
  });
}

listen(startPort, PORT_PROBE_ATTEMPTS);
