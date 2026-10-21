// Talk now call server: WebRTC signalling, the call timer, minute codes,
// time requests and the live status board, for benjaminmithra.com.
import http from "node:http";
import express from "express";
import { WebSocketServer } from "ws";
import { config, checkConfig } from "./config.js";
import { db, nowIso } from "./db.js";
import { checkCode, publicCodeInfo, createCode, listCodes, addMinutes, setDisabled } from "./codes.js";
import { passwordMatches, makeSessionToken, sessionCookie, isAdminRequest } from "./auth.js";
import { FailureLimiter } from "./rateLimit.js";
import { CallManager, recentCalls } from "./calls.js";

const problems = checkConfig();
if (problems.length) {
  console.error("The call server can't start until these settings are fixed:\n- " + problems.join("\n- "));
  process.exit(1);
}

const codeLimiter = new FailureLimiter({ maxFailures: config.codeMaxFailures, windowMs: config.codeLockoutMinutes * 60e3, lockoutMs: config.codeLockoutMinutes * 60e3 });
const loginLimiter = new FailureLimiter({ maxFailures: config.loginMaxFailures, windowMs: config.loginLockoutMinutes * 60e3, lockoutMs: config.loginLockoutMinutes * 60e3 });

let notifyHook = () => {};
export const setNotifyHook = (fn) => { notifyHook = fn; };
const calls = new CallManager({ notify: (event) => notifyHook(event) });

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

const reasonText = {
  invalid: "That code isn't recognised. Please check it and try again.",
  expired: "That code has expired.",
  "used-up": "That code has no minutes left.",
  locked: "Too many attempts. Please wait a little and try again.",
};

function limitedCodeCheck(req, codeInput) {
  const lock = codeLimiter.status(req.ip);
  if (lock.locked) return { status: 429, body: { valid: false, reason: "locked", message: reasonText.locked, retryAfterSeconds: lock.retryAfterSeconds } };
  const result = checkCode(codeInput);
  if (!result.ok) {
    const after = codeLimiter.fail(req.ip);
    if (after.locked) return { status: 429, body: { valid: false, reason: "locked", message: reasonText.locked, retryAfterSeconds: after.retryAfterSeconds } };
    return { status: 200, body: { valid: false, reason: result.reason, message: reasonText[result.reason] } };
  }
  codeLimiter.succeed(req.ip);
  return { status: 200, body: { valid: true, ...publicCodeInfo(result.row) }, row: result.row };
}

// ---- public -------------------------------------------------------------
app.get("/api/status", (req, res) => res.json({ status: calls.status() }));

app.post("/api/codes/check", (req, res) => {
  const out = limitedCodeCheck(req, req.body?.code);
  res.status(out.status).json(out.body);
});

app.post("/api/requests", (req, res) => {
  const { name = "", code, preferredTime, timezone } = req.body || {};
  const clean = (v, max) => String(v ?? "").trim().slice(0, max);
  if (!clean(preferredTime, 40) || !clean(timezone, 64)) return res.status(400).json({ ok: false, message: "Please choose a day, time and timezone." });
  const out = limitedCodeCheck(req, code);
  if (!out.body.valid) return res.status(out.status).json({ ok: false, ...out.body });
  db.prepare("INSERT INTO requests (code_id, name, preferred_time, timezone, created_at) VALUES (?, ?, ?, ?, ?)").run(out.row.id, clean(name, 80), clean(preferredTime, 40), clean(timezone, 64), nowIso());
  calls.broadcastAdmins({ type: "requests-changed" });
  notifyHook({ type: "request", title: "New time request", body: `${clean(name, 80) || "Someone"} asked for ${clean(preferredTime, 40).replace("T", " ")} (${clean(timezone, 64)})` });
  res.json({ ok: true });
});

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

const listRequests = () =>
  db.prepare("SELECT requests.*, codes.code, codes.note FROM requests LEFT JOIN codes ON codes.id = requests.code_id ORDER BY requests.done, requests.id DESC LIMIT 200").all()
    .map((r) => ({ id: r.id, name: r.name, code: r.code, note: r.note, preferredTime: r.preferred_time, timezone: r.timezone, createdAt: r.created_at, done: Boolean(r.done) }));

admin.get("/overview", (req, res) => {
  res.json({ status: calls.status(), away: calls.manualAway, codes: listCodes(), requests: listRequests(), calls: recentCalls(), vapidPublicKey: config.vapid.publicKey || null });
});

const intIn = (v, min, max) => Number.isInteger(v) && v >= min && v <= max;
admin.post("/codes", (req, res) => {
  const { minutes = config.defaultCodeMinutes, mode = "audio", expiresOn = null, note = "" } = req.body || {};
  if (!intIn(minutes, 1, 600)) return res.status(400).json({ message: "Minutes must be a whole number from 1 to 600." });
  if (!["audio", "audio+video"].includes(mode)) return res.status(400).json({ message: "Mode must be audio or audio+video." });
  if (expiresOn && !/^\d{4}-\d{2}-\d{2}$/.test(expiresOn)) return res.status(400).json({ message: "Expiry must be a date." });
  res.json(createCode({ minutes, mode, expiresOn: expiresOn || null, note: String(note).slice(0, 200) }));
});
admin.post("/codes/:id/minutes", (req, res) => {
  const minutes = req.body?.minutes;
  if (!intIn(minutes, 1, 600)) return res.status(400).json({ message: "Minutes must be a whole number from 1 to 600." });
  const out = addMinutes(Number(req.params.id), minutes);
  out ? res.json(out) : res.status(404).json({ message: "No such code." });
});
admin.post("/codes/:id/disabled", (req, res) => {
  const out = setDisabled(Number(req.params.id), Boolean(req.body?.disabled));
  out ? res.json(out) : res.status(404).json({ message: "No such code." });
});
admin.post("/requests/:id/done", (req, res) => {
  db.prepare("UPDATE requests SET done = ? WHERE id = ?").run(req.body?.done === false ? 0 : 1, Number(req.params.id));
  res.json({ ok: true });
});
admin.post("/status", (req, res) => {
  calls.setAway(Boolean(req.body?.away));
  res.json({ status: calls.status(), away: calls.manualAway });
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
    // The visitor's IP, for the code-attempt limit (trust proxy rules apply).
    ws.ip = app.get("trust proxy") ? (String(req.headers["x-forwarded-for"] || "").split(",")[0].trim() || req.socket.remoteAddress) : req.socket.remoteAddress;
    ws.isAlive = true;
    ws.on("pong", () => { ws.isAlive = true; });
    calls.addSocket(ws, { isAdmin: wantsAdmin });
    ws.on("message", (raw) => handleMessage(ws, raw));
    ws.on("close", () => calls.removeSocket(ws));
  });
});

function handleMessage(ws, raw) {
  let msg;
  try { msg = JSON.parse(raw); } catch { return; }
  const reply = (m) => ws.readyState === 1 && ws.send(JSON.stringify(m));
  switch (msg.type) {
    case "call": {
      const lock = codeLimiter.status(ws.ip);
      if (lock.locked) return reply({ type: "call-error", reason: "locked", message: reasonText.locked });
      const out = calls.startCall(ws, msg.code);
      if (out.error) {
        if (out.codeFailure) codeLimiter.fail(ws.ip);
        return reply({ type: "call-error", reason: out.error, message: reasonText[out.error] || "Benjamin isn't available right now." });
      }
      codeLimiter.succeed(ws.ip);
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

// Drop sockets that stopped answering (closed laptops, lost Wi-Fi).
setInterval(() => {
  for (const ws of wss.clients) {
    if (!ws.isAlive) { ws.terminate(); continue; }
    ws.isAlive = false;
    ws.ping();
  }
}, 25_000).unref();

server.listen(config.port, () => console.log(`Call server listening on port ${config.port}`));
export { app, server, calls };
