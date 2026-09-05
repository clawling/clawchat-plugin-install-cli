#!/usr/bin/env node
// ClawChat liveware sample — zero-dependency web service behind the owner's
// first-Liveware guide.
// Contract (consumed by the ClawChat plugin supervisor):
//   node server.mjs --dir <app dir> --port <startPort> [--agent-id <clawchat user id>]
//   * prints ONE stdout line `{"port":N}` once listening
//   * GET / , /app.js , /state , /sse , /healthz , /icon.svg , /tool/ , /data
//     POST /event ; PUT /data
// Layout (the plugin passes `app/`; everything the agent owns lives one level up):
//   <root>/app/            manifest-managed, flat, reinstalled on upgrade
//     index.html app.js server.mjs liveware.json tool-<id>.html
//     state.json events.jsonl        (agent-owned, kept across upgrades)
//   <root>/tool/index.html           the agent's personalized copy (optional)
//   <root>/data.json                 the tool's data (page PUTs it, agent edits it)
// state.json / data.json / tool/ edits (by the agent) are pushed to the page via
// SSE; page interactions are appended to events.jsonl (read by the agent).
// --agent-id (the agent's own ClawChat user id) is merged into /state
// responses and SSE frames as `agentId` — never written into state.json —
// so the page can mint its back-to-chat deep links.
import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";

function arg(name, fallback) {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : fallback;
}

const dir = path.resolve(arg("dir", "."));
const root = path.resolve(dir, "..");
const startPort = Number(arg("port", "43110"));
const agentId = String(arg("agent-id", "")).trim();

function stateWithMeta(state) {
  // state.json is agent-writable and the page renders deep links from this
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
const DATA_FILE = path.join(root, "data.json");
const TOOL_DIR = path.join(root, "tool");
const TOOL_COPY = path.join(TOOL_DIR, "index.html");
const TOOLS = new Set(["shopping-list", "countdown", "habits"]);
const MAX_EVENT_BYTES = 64 * 1024;
const MAX_DATA_BYTES = 64 * 1024;
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
  // Exactly one <svg> element: the boundary check above admits
  // "<svg>…</svg><svg>…</svg>", so count opening tags (also bans nested svg).
  if ((svg.match(/<svg[\s>]/gi) || []).length !== 1) return null;
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

// ---------- SSE ----------
const sseClients = new Set();

function broadcast(event, payload) {
  const frame = `event: ${event}\ndata: ${JSON.stringify({ type: event, ...payload })}\n\n`;
  for (const res of sseClients) res.write(frame);
}

function readJsonFile(file) {
  // The file may be mid-write when watched (the agent rewrites it whole);
  // treat parse failures as "skip" — the next event brings the settled file.
  try {
    return JSON.parse(fs.readFileSync(file, "utf8"));
  } catch {
    return null;
  }
}
const readStateJson = () => readJsonFile(STATE_FILE);

function isPlainObject(v) {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

// ---------- watchers: state.json (app/), data.json + tool/ (<root>) ----------
function debounced(ms, fn) {
  let timer = null;
  return () => {
    clearTimeout(timer);
    timer = setTimeout(fn, ms);
  };
}
const notifyState = debounced(100, () => {
  const state = readStateJson();
  if (state != null) broadcast("state", stateWithMeta(state));
});
// A /data PUT writes data.json itself and broadcasts right away; the watcher's
// echo of that same write is swallowed for a short window so clients don't
// re-fetch twice.
let selfWriteUntil = 0;
const notifyData = debounced(100, () => {
  if (Date.now() < selfWriteUntil) return;
  if (!fs.existsSync(DATA_FILE) || readJsonFile(DATA_FILE) != null) broadcast("data", {});
});
const notifyTool = debounced(150, () => broadcast("tool", {}));

fs.watch(dir, (_event, filename) => {
  if (filename === "state.json") notifyState();
});
fs.watch(root, (_event, filename) => {
  if (filename === "data.json") notifyData();
  if (filename === "tool") watchToolDir(); // created (or removed) by the agent
});
// tool/ does not exist until the agent personalizes; watch it lazily.
let toolWatcher = null;
function watchToolDir() {
  if (toolWatcher) {
    toolWatcher.close();
    toolWatcher = null;
  }
  try {
    toolWatcher = fs.watch(TOOL_DIR, () => notifyTool());
    toolWatcher.on("error", () => {
      toolWatcher = null;
    });
  } catch {
    toolWatcher = null; // tool/ is gone → back to the template; the page reloads on the next event
  }
  notifyTool();
}
if (fs.existsSync(TOOL_DIR)) watchToolDir();

// ---------- static + index ----------
function serveFile(res, file, mime) {
  fs.readFile(file, (err, buf) => {
    if (err) {
      res.writeHead(404, { "content-type": "text/plain" }).end("not found");
      return;
    }
    res.writeHead(200, { "content-type": mime, "cache-control": "no-cache" }).end(buf);
  });
}

function appJsVersion() {
  try {
    return crypto.createHash("sha256").update(fs.readFileSync(path.join(dir, "app.js"))).digest("hex").slice(0, 8);
  } catch {
    return "0";
  }
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
    // Cache-bust app.js with its own content hash: the public tunnel's edge
    // (and a client's HTTP cache) may hold a copy from BEFORE an upgrade, and
    // a stale script against a new shell renders nothing at all (2026-09-05,
    // first rollout: old app.js threw on a missing #title → blank page).
    html = html.replace('src="/app.js"', `src="/app.js?v=${appJsVersion()}"`);
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
    res
      .writeHead(200, { "content-type": "text/html; charset=utf-8", "cache-control": "no-cache" })
      .end(html);
  });
}

// The owner's tool: the agent's personalized copy when it exists, else the
// shipped template for the chosen tool. No <title> injection here — the
// container's title comes from the shell at `/`.
//
// Two shapes of the same thing:
//   GET /tool/      the HTML itself (handy in a plain browser)
//   GET /tool.json  {"html": "…"} — what the shell actually uses. The liveware
//                   tunnel's edge treats an HTML document request differently
//                   from the JSON the page already exchanges with /state (a bare
//                   iframe navigation came back as the edge's own 400 page,
//                   2026-09-05), so the shell fetches the tool exactly the way
//                   it fetches state and renders it as an srcdoc iframe.
function readTool(cb) {
  const state = readStateJson();
  const stage = state?.stage ?? "intro";
  const tool = state?.tool;
  if (stage === "intro" || !TOOLS.has(tool)) return cb(404, null);
  fs.readFile(TOOL_COPY, (err, buf) => {
    if (!err) return cb(200, buf);
    fs.readFile(path.join(dir, `tool-${tool}.html`), (err2, buf2) => cb(err2 ? 404 : 200, err2 ? null : buf2));
  });
}
function serveTool(res) {
  readTool((status, buf) => {
    if (status !== 200) return res.writeHead(status, { "content-type": "text/plain" }).end("not found");
    res.writeHead(200, { "content-type": "text/html; charset=utf-8", "cache-control": "no-cache" }).end(buf);
  });
}
function serveToolJson(res) {
  readTool((status, buf) => {
    const headers = { "content-type": "application/json; charset=utf-8", "cache-control": "no-cache" };
    if (status !== 200) return res.writeHead(status, headers).end('{"error":"no tool"}');
    res.writeHead(200, headers).end(JSON.stringify({ html: buf.toString("utf8") }));
  });
}

// ---------- /data ----------
function serveData(res) {
  fs.readFile(DATA_FILE, "utf8", (err, text) => {
    if (err) {
      return res.writeHead(200, { "content-type": "application/json; charset=utf-8" }).end("{}");
    }
    let parsed;
    try {
      parsed = JSON.parse(text);
    } catch {
      // mid-write by the agent — the page keeps what it has; SSE brings the settled file
      return res
        .writeHead(503, { "content-type": "application/json; charset=utf-8" })
        .end('{"error":"data unavailable"}');
    }
    res
      .writeHead(200, { "content-type": "application/json; charset=utf-8", "cache-control": "no-cache" })
      .end(JSON.stringify(isPlainObject(parsed) ? parsed : {}));
  });
}

function readBody(req, res, maxBytes, onJson) {
  const chunks = [];
  let received = 0;
  let overflow = false;
  req.on("data", (chunk) => {
    received += chunk.length;
    if (received > maxBytes) {
      overflow = true;
      res.writeHead(413, { "content-type": "application/json" }).end('{"error":"too large"}');
      req.destroy();
      return;
    }
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
    onJson(parsed);
  });
}

// Anyone with the public URL can PUT /data — the content is untrusted text
// (the skill says so); only its size and shape are enforced here.
function putData(req, res) {
  readBody(req, res, MAX_DATA_BYTES, (parsed) => {
    if (!isPlainObject(parsed)) {
      res.writeHead(400, { "content-type": "application/json" }).end('{"error":"expected a JSON object"}');
      return;
    }
    const tmp = `${DATA_FILE}.${process.pid}.${Date.now()}.tmp`;
    fs.writeFile(tmp, JSON.stringify(parsed, null, 2) + "\n", (err) => {
      if (err) {
        res.writeHead(500, { "content-type": "application/json" }).end('{"error":"write failed"}');
        return;
      }
      fs.rename(tmp, DATA_FILE, (err2) => {
        if (err2) {
          fs.unlink(tmp, () => {});
          res.writeHead(500, { "content-type": "application/json" }).end('{"error":"write failed"}');
          return;
        }
        selfWriteUntil = Date.now() + 500;
        broadcast("data", {});
        res.writeHead(200, { "content-type": "application/json" }).end('{"ok":true}');
      });
    });
  });
}

// ---------- /stage: the page's own "got it" ----------
// The only transition the page may make by itself: personalized → kept (the
// owner acknowledged the finish card). Everything else in state.json stays
// the agent's; a nod is not worth a chat round-trip. Rewrites the file whole
// and atomically (tmp + rename), same discipline the agent is told to keep.
function postStage(req, res) {
  readBody(req, res, MAX_EVENT_BYTES, (parsed) => {
    if (parsed?.stage !== "kept") {
      return res.writeHead(400, { "content-type": "application/json" }).end('{"error":"only stage=kept"}');
    }
    const state = readStateJson();
    if (state == null) {
      return res.writeHead(503, { "content-type": "application/json" }).end('{"error":"state unavailable"}');
    }
    if (state.stage !== "personalized") {
      return res.writeHead(409, { "content-type": "application/json" }).end('{"error":"not in personalized stage"}');
    }
    const next = { ...state, stage: "kept" };
    const tmp = `${STATE_FILE}.${process.pid}.${Date.now()}.tmp`;
    fs.writeFile(tmp, JSON.stringify(next, null, 2) + "\n", (err) => {
      if (err) return res.writeHead(500, { "content-type": "application/json" }).end('{"error":"write failed"}');
      fs.rename(tmp, STATE_FILE, (err2) => {
        if (err2) {
          fs.unlink(tmp, () => {});
          return res.writeHead(500, { "content-type": "application/json" }).end('{"error":"write failed"}');
        }
        capEventsFileIfNeeded();
        fs.appendFile(EVENTS_FILE, JSON.stringify({ ts: Date.now(), type: "keep", payload: { tool: next.tool ?? null } }) + "\n", () => {});
        broadcast("state", stateWithMeta(next)); // the watcher's echo is harmless
        res.writeHead(200, { "content-type": "application/json" }).end('{"ok":true}');
      });
    });
  });
}

const server = http.createServer((req, res) => {
  const url = (req.url || "/").split("?")[0];

  if (req.method === "GET" && url === "/") return serveIndexHtml(res);
  if (req.method === "GET" && url === "/app.js") {
    return serveFile(res, path.join(dir, "app.js"), "text/javascript; charset=utf-8");
  }
  if (req.method === "GET" && (url === "/tool/" || url === "/tool")) return serveTool(res);
  if (req.method === "GET" && url === "/tool.json") return serveToolJson(res);
  if (req.method === "GET" && url === "/data") return serveData(res);
  if (req.method === "PUT" && url === "/data") return putData(req, res);
  if (req.method === "POST" && url === "/stage") return postStage(req, res);
  if (req.method === "GET" && url === "/state") {
    const state = readStateJson();
    // state.json may be mid-write (torn read). NEVER stream the raw file —
    // it bypasses stateWithMeta's iconSvg/agentId stripping. The page treats
    // a non-ok /state as a failed load (catch path); SSE recovers once the
    // agent's write completes.
    if (state == null) {
      return res
        .writeHead(503, { "content-type": "application/json; charset=utf-8" })
        .end('{"error":"state unavailable"}');
    }
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
    return readBody(req, res, MAX_EVENT_BYTES, (parsed) => {
      const line = JSON.stringify({
        ts: Date.now(),
        type: typeof parsed?.type === "string" ? parsed.type : "unknown",
        payload: parsed?.payload ?? null,
      });
      capEventsFileIfNeeded();
      fs.appendFile(EVENTS_FILE, line + "\n", () => {});
      res.writeHead(200, { "content-type": "application/json" }).end('{"ok":true}');
    });
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
