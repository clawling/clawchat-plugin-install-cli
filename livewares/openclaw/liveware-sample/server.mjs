#!/usr/bin/env node
// ClawChat liveware sample — zero-dependency demo web service.
// Contract (consumed by the ClawChat plugin supervisor):
//   node server.mjs --dir <dir> --port <startPort>
//   * prints ONE stdout line `{"port":N}` once listening
//   * GET / , /app.js , /state , /sse , /healthz ; POST /event
// state.json edits (by the agent) are pushed to the page via SSE;
// page interactions are appended to events.jsonl (read by the agent).
import http from "node:http";
import fs from "node:fs";
import path from "node:path";

function arg(name, fallback) {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : fallback;
}

const dir = path.resolve(arg("dir", "."));
const startPort = Number(arg("port", "43110"));
const STATE_FILE = path.join(dir, "state.json");
const EVENTS_FILE = path.join(dir, "events.jsonl");
const MAX_EVENT_BYTES = 64 * 1024;
const PORT_PROBE_ATTEMPTS = 20;

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
    const frame = `event: state\ndata: ${JSON.stringify(state)}\n\n`;
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

const server = http.createServer((req, res) => {
  const url = (req.url || "/").split("?")[0];

  if (req.method === "GET" && url === "/") return serveFile(res, "index.html", "text/html; charset=utf-8");
  if (req.method === "GET" && url === "/app.js") return serveFile(res, "app.js", "text/javascript; charset=utf-8");
  if (req.method === "GET" && url === "/state") return serveFile(res, "state.json", "application/json; charset=utf-8");
  if (req.method === "GET" && url === "/healthz") {
    return res.writeHead(200, { "content-type": "application/json" }).end('{"ok":true}');
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
    let body = "";
    let overflow = false;
    req.on("data", (chunk) => {
      body += chunk;
      if (body.length > MAX_EVENT_BYTES) { overflow = true; req.destroy(); }
    });
    req.on("end", () => {
      if (overflow) return;
      let parsed;
      try {
        parsed = JSON.parse(body);
      } catch {
        res.writeHead(400, { "content-type": "application/json" }).end('{"error":"bad json"}');
        return;
      }
      const line = JSON.stringify({
        ts: Date.now(),
        type: typeof parsed.type === "string" ? parsed.type : "unknown",
        payload: parsed.payload ?? null,
      });
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
