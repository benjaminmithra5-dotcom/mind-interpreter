// Talk now call server: WebRTC signalling, the call timer, ringing and the
// live status board, for benjaminmithra.com. No database: nothing about a
// call is stored.
import http from "node:http";
import express from "express";
import { WebSocketServer } from "ws";
import { config, checkConfig } from "./config.js";
import { passwordMatches, makeSessionToken, sessionCookie, isAdminRequest } from "./auth.js";
import { FailureLimiter } from "./rateLimit.js";
import { CallManager } from "./calls.js";

const problems = checkConfig();
if (problems.length) {
  console.error("The call server can't start until these settings are fixed:\n- " + problems.join("\n- "));
  process.exit(1);
}

// Every Call press counts, so one address can't ring Benjamin over and over.
const callLimiter = new FailureLimiter({ maxFailures: config.callMaxPresses, windowMs: config.callWindowMinutes * 60e3, lockoutMs: config.callWindowMinutes * 60e3 });
const loginLimiter = new FailureLimiter({ maxFailures: config.loginMaxFailures, windowMs: config.loginLockoutMinutes * 60e3, lockoutMs: config.loginLockoutMinutes * 60e3 });

const calls = new CallManager();

const app = express();
app.disable("x-powered-by");
app.set("trust proxy", config.trustProxy === "true" ? true : config.trustProxy === "false" ? false : Number(config.trustProxy) || config.trustProxy);
app.use(express.json({ limit: "16kb" }));

const originAllowed = (origin) => !origin || config.allowedOrigins.length === 0 ? !config.production || !origin : config.allowedOrigins.includes(origin);
const isHttps = (req) => req.secure || req.headers["x-forwarded-proto"] === "https";

app.get("/healthz", (req, res) => res.json({ ok: true }));

// HTTPS only in production, and only the site's own origins.
app.use((req, res, next) => {
  if (config.production && !isHttps(req)) return res.status(403).json({ error: "https-required" });
  const origin = req.headers.origin;
  if (origin && originAllowed(origin)) {
    res.set({ "Access-Control-Allow-Origin": origin, "Access-Control-Allow-Credentials": "true", Vary: "Origin" });
  }
  if (req.method === "OPTIONS") {
    if (!origin || !originAllowed(origin)) return res.sendStatus(403);
    res.set({ "Access-Control-Allow-Methods": "GET, POST, OPTIONS", "Access-Control-Allow-Headers": "Content-Type", "Access-Control-Max-Age": "600" });
    return res.sendStatus(204);
  }
  // Anything that changes data must come from the site itself.
  if (req.method !== "GET" && (!origin || !originAllowed(origin)) && config.production) return res.status(403).json({ error: "origin-not-allowed" });
  if (req.method !== "GET" && origin && !originAllowed(origin)) return res.status(403).json({ error: "origin-not-allowed" });
  next();
});

// ---- public -------------------------------------------------------------
app.get("/api/status", (req, res) => res.json({ status: calls.status() }));

// ---- admin --------------------------------------------------------------
app.post("/api/admin/login", (req, res) => {
  const lock = loginLimiter.status(req.ip);
  if (lock.locked) return res.status(429).json({ ok: false, message: "Too many attempts. Please wait and try again.", retryAfterSeconds: lock.retryAfterSeconds });
  if (!passwordMatches(req.body?.password)) {
    const after = loginLimiter.fail(req.ip);
    return res.status(after.locked ? 429 : 401).json({ ok: false, message: after.locked ? "Too many attempts. Please wait and try again." : "That password isn't right." });
  }
  loginLimiter.succeed(req.ip);
  res.set("Set-Cookie", sessionCookie(makeSessionToken())).json({ ok: true });
});
app.post("/api/admin/logout", (req, res) => res.set("Set-Cookie", sessionCookie("", { clear: true })).json({ ok: true }));
app.get("/api/admin/session", (req, res) => res.json({ loggedIn: isAdminRequest(req) }));

const admin = express.Router();
admin.use((req, res, next) => (isAdminRequest(req) ? next() : res.status(401).json({ error: "login-required" })));

admin.get("/overview", (req, res) => res.json({ status: calls.status(), away: calls.away }));
admin.post("/status", (req, res) => {
  calls.setAway(Boolean(req.body?.away));
  res.json({ status: calls.status(), away: calls.away });
});
app.use("/api/admin", admin);
export const adminRouter = admin;

// ---- WebSocket: live status, ringing and call signalling -----------------
const server = http.createServer(app);
const wss = new WebSocketServer({ noServer: true, maxPayload: 64 * 1024 });

server.on("upgrade", (req, socket, head) => {
  const url = new URL(req.url, "http://x");
  const origin = req.headers.origin;
  const forbidden = url.pathname !== "/ws" || (origin && !originAllowed(origin)) || (config.production && (!origin || req.headers["x-forwarded-proto"] !== "https"));
  if (forbidden) {
    socket.write("HTTP/1.1 403 Forbidden\r\n\r\n");
    return socket.destroy();
  }
  wss.handleUpgrade(req, socket, head, (ws) => {
    const wantsAdmin = url.searchParams.get("role") === "admin";
    if (wantsAdmin && !isAdminRequest(req)) {
      ws.close(4401, "login-required");
      return;
    }
    // The visitor's IP, for the Call-press limit (trust proxy rules apply).
    ws.ip = app.get("trust proxy") ? (String(req.headers["x-forwarded-for"] || "").split(",")[0].trim() || req.socket.remoteAddress) : req.socket.remoteAddress;
    ws.isAlive = true;
    ws.on("pong", () => { ws.isAlive = true; });
    calls.addSocket(ws, { isAdmin: wantsAdmin });
    ws.on("message", (raw) => handleMessage(ws, raw));
    ws.on("close", () => calls.removeSocket(ws));
  });
});

// Basic checks on the caller's name and email. They're only passed on to
// Benjamin's admin page while the call rings, never logged or stored.
const EMAIL = /^[^\s@<>]+@[^\s@<>]+\.[^\s@<>]{2,}$/;
function validCaller(msg) {
  const name = typeof msg.name === "string" ? msg.name.trim().replace(/\s+/g, " ") : "";
  const email = typeof msg.email === "string" ? msg.email.trim() : "";
  if (name.length < 1 || name.length > 80 || email.length > 200 || !EMAIL.test(email)) return null;
  return { name, email };
}

function handleMessage(ws, raw) {
  let msg;
  try { msg = JSON.parse(raw); } catch { return; }
  const reply = (m) => ws.readyState === 1 && ws.send(JSON.stringify(m));
  switch (msg.type) {
    case "call": {
      // CALL_MAX_PRESSES presses go through; after that, wait for the window.
      if (callLimiter.status(ws.ip).locked) return reply({ type: "call-error", reason: "rate-limited" });
      callLimiter.fail(ws.ip);
      const caller = validCaller(msg);
      if (!caller) return reply({ type: "call-error", reason: "invalid" });
      const out = calls.startCall(ws, caller);
      if (out.error) return reply({ type: "call-error", reason: out.error });
      return reply({ type: "ringing", ...out });
    }
    case "rejoin":
      if (!calls.rejoinVisitor(ws, msg.callId, msg.token)) reply({ type: "ended", callId: msg.callId, reason: "gone" });
      return;
    case "signal":
      return calls.relaySignal(ws, msg.data);
    case "media":
      return calls.mediaState(ws, msg.state);
    case "hangup":
      return calls.hangup(ws);
  }
  if (!ws.isAdmin) return;
  switch (msg.type) {
    case "accept": return calls.accept(ws, msg.callId);
    case "decline": return calls.decline(ws, msg.callId);
    case "rejoin-admin":
      if (!calls.rejoinAdmin(ws, msg.callId)) reply({ type: "ended", callId: msg.callId, reason: "gone" });
      return;
    case "set-away": return calls.setAway(msg.away);
  }
}

// Drop pages that stopped answering (closed laptops, sleeping phones, lost
// Wi-Fi) within a few seconds, so a silent admin page turns the status to
// "Away" quickly.
setInterval(() => {
  for (const ws of wss.clients) {
    if (!ws.isAlive) { ws.terminate(); continue; }
    ws.isAlive = false;
    ws.ping();
  }
}, config.heartbeatSeconds * 1000).unref();

server.listen(config.port, () => console.log(`Call server listening on port ${config.port}`));
export { app, server, calls };
