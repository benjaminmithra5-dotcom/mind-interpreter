// The call manager: status board, ringing, the server-owned timer, the
// 2-minute warning, the wrap-up, reconnection and call records.
//
// One call at a time. The timer only runs while both people are connected;
// every tick takes one second off the code, so minutes are spent as they
// are used and a dropped call never loses more than it used.
import crypto from "node:crypto";
import { config } from "./config.js";
import { db, nowIso, getSetting, setSetting } from "./db.js";
import { checkCode, deductSecond, secondsRemaining, publicCodeInfo } from "./codes.js";

const OPEN = 1; // WebSocket.OPEN
const send = (ws, msg) => { if (ws && ws.readyState === OPEN) ws.send(JSON.stringify(msg)); };

export class CallManager {
  constructor({ notify = () => {} } = {}) {
    this.sockets = new Set(); // every connected page, for the live status
    this.admins = new Set(); // signed-in admin pages (computer, phone)
    this.call = null;
    this.manualAway = getSetting("manualAway", false);
    this.lastAdminSeenAt = 0;
    this.lastStatus = null;
    this.notify = notify; // (event) => push notification to Benjamin's devices
    this.timer = setInterval(() => this.tick(), config.tickMs);
    this.timer.unref?.();
  }

  // ---- status -----------------------------------------------------------
  adminPresent() {
    if (this.admins.size > 0) return true;
    // A short grace so a phone that briefly backgrounds the admin page
    // doesn't flip straight to "Away".
    return Date.now() - this.lastAdminSeenAt < config.adminAwayGraceSeconds * config.tickMs;
  }
  status() {
    if (this.call) return "on_call";
    if (!this.adminPresent() || this.manualAway) return "away";
    return "available";
  }
  broadcastStatus(force = false) {
    const status = this.status();
    if (!force && status === this.lastStatus) return;
    this.lastStatus = status;
    for (const ws of this.sockets) send(ws, { type: "status", status });
  }
  setAway(away) {
    this.manualAway = Boolean(away);
    setSetting("manualAway", this.manualAway);
    this.broadcastAdmins({ type: "away", away: this.manualAway });
    this.broadcastStatus();
  }
  broadcastAdmins(msg, except) {
    for (const ws of this.admins) if (ws !== except) send(ws, msg);
  }

  // ---- sockets ----------------------------------------------------------
  addSocket(ws, { isAdmin }) {
    ws.isAdmin = isAdmin;
    this.sockets.add(ws);
    if (isAdmin) {
      this.admins.add(ws);
      send(ws, { type: "away", away: this.manualAway });
      const c = this.call;
      if (c && c.phase === "ringing") send(ws, this.incomingMessage());
      if (c && c.phase !== "ringing" && !this.isOpen(c.adminWs)) send(ws, { type: "call-in-progress", callId: c.id });
    }
    send(ws, { type: "status", status: this.status() });
    this.broadcastStatus();
  }
  removeSocket(ws) {
    this.sockets.delete(ws);
    if (ws.isAdmin && this.admins.delete(ws) && this.admins.size === 0) {
      this.lastAdminSeenAt = Date.now();
      setTimeout(() => this.broadcastStatus(), config.adminAwayGraceSeconds * config.tickMs + 50).unref?.();
    }
    const c = this.call;
    if (c && c.phase === "ringing" && ws === c.visitorWs) this.endCall("cancelled");
    this.broadcastStatus();
  }
  isOpen(ws) { return Boolean(ws) && ws.readyState === OPEN; }

  // ---- visitor ----------------------------------------------------------
  startCall(ws, codeInput) {
    if (this.call) return { error: "busy" };
    if (this.status() !== "available") return { error: "not-available" };
    const result = checkCode(codeInput);
    if (!result.ok) return { error: result.reason, codeFailure: true };
    const row = result.row;
    this.call = {
      id: crypto.randomUUID(),
      codeId: row.id,
      code: row.code,
      note: row.note,
      mode: row.mode,
      token: crypto.randomBytes(16).toString("hex"),
      phase: "ringing",
      visitorWs: ws,
      adminWs: null,
      media: { visitor: false, admin: false },
      ringLeft: config.ringTimeoutSeconds,
      connectLeft: config.connectTimeoutSeconds,
      startedAt: null,
      secondsUsed: 0,
      warned: false,
      wrapupLeft: null,
      paused: false,
      graceLeft: null,
    };
    ws.callId = this.call.id;
    ws.role = "visitor";
    this.broadcastAdmins(this.incomingMessage());
    this.notify({ type: "call", callId: this.call.id, title: "Incoming call", body: this.call.note ? `Code note: ${this.call.note}` : "Someone is calling you now." });
    this.broadcastStatus();
    return { callId: this.call.id, token: this.call.token, ...publicCodeInfo(row) };
  }
  incomingMessage() {
    const c = this.call;
    return { type: "incoming", callId: c.id, mode: c.mode, note: c.note, code: c.code, secondsRemaining: secondsRemaining(c.codeId), ringLeft: c.ringLeft };
  }
  rejoinVisitor(ws, callId, token) {
    const c = this.call;
    if (!c || c.id !== callId || !token || token.length !== c.token.length || !crypto.timingSafeEqual(Buffer.from(token), Buffer.from(c.token))) return false;
    if (c.visitorWs && c.visitorWs !== ws) c.visitorWs.callId = null;
    c.visitorWs = ws;
    c.media.visitor = false;
    ws.callId = c.id;
    ws.role = "visitor";
    send(ws, { type: "rejoined", callId: c.id, phase: c.phase, mode: c.mode, iceServers: config.iceServers, secondsRemaining: secondsRemaining(c.codeId) });
    if (c.phase !== "ringing") {
      send(c.adminWs, { type: "peer-rejoined" });
      send(ws, { type: "renegotiate" });
    }
    return true;
  }

  // ---- admin ------------------------------------------------------------
  accept(ws, callId) {
    const c = this.call;
    if (!c || c.id !== callId || c.phase !== "ringing") return send(ws, { type: "ring-cancel", callId, reason: "gone" });
    c.phase = "live";
    c.adminWs = ws;
    ws.callId = c.id;
    ws.role = "admin";
    const info = { callId: c.id, mode: c.mode, iceServers: config.iceServers, secondsRemaining: secondsRemaining(c.codeId) };
    send(ws, { type: "accepted", ...info, note: c.note, code: c.code });
    send(c.visitorWs, { type: "accepted", ...info });
    this.broadcastAdmins({ type: "ring-cancel", callId: c.id, reason: "taken" }, ws);
    this.notify({ type: "cancel", callId: c.id, reason: "taken" });
    this.broadcastStatus();
  }
  decline(ws, callId) {
    const c = this.call;
    if (c && c.id === callId && c.phase === "ringing") this.endCall("declined");
  }
  rejoinAdmin(ws, callId) {
    const c = this.call;
    if (!c || c.id !== callId || c.phase === "ringing") return false;
    if (c.adminWs && c.adminWs !== ws) {
      send(c.adminWs, { type: "ended", reason: "moved", secondsRemaining: secondsRemaining(c.codeId) });
      c.adminWs.callId = null;
    }
    c.adminWs = ws;
    c.media.admin = false;
    ws.callId = c.id;
    ws.role = "admin";
    send(ws, { type: "rejoined", callId: c.id, phase: c.phase, mode: c.mode, note: c.note, code: c.code, iceServers: config.iceServers, secondsRemaining: secondsRemaining(c.codeId) });
    send(c.visitorWs, { type: "renegotiate" });
    return true;
  }

  // ---- both sides -------------------------------------------------------
  relaySignal(ws, data) {
    const c = this.call;
    if (!c || ws.callId !== c.id || c.phase === "ringing") return;
    send(ws === c.visitorWs ? c.adminWs : c.visitorWs, { type: "signal", data });
  }
  mediaState(ws, state) {
    const c = this.call;
    if (!c || ws.callId !== c.id) return;
    const side = ws === c.visitorWs ? "visitor" : ws === c.adminWs ? "admin" : null;
    if (side) c.media[side] = state === "connected";
  }
  hangup(ws) {
    const c = this.call;
    if (!c || ws.callId !== c.id) return;
    this.endCall(c.phase === "ringing" ? "cancelled" : ws === c.visitorWs ? "visitor-ended" : "benjamin-ended");
  }

  // ---- the clock ---------------------------------------------------------
  tick() {
    const c = this.call;
    if (!c) return;
    if (c.phase === "ringing") {
      c.ringLeft -= 1;
      if (c.ringLeft <= 0) this.endCall("no-answer");
      return;
    }
    const ready = this.isOpen(c.visitorWs) && this.isOpen(c.adminWs) && c.media.visitor && c.media.admin;
    if (!c.startedAt) {
      // Waiting for the two browsers to connect for the first time.
      if (ready) {
        c.startedAt = nowIso();
      } else {
        c.connectLeft -= 1;
        if (c.connectLeft <= 0) this.endCall("could-not-connect");
        return;
      }
    }
    if (!ready) {
      if (!c.paused) {
        c.paused = true;
        c.graceLeft = config.reconnectGraceSeconds;
      }
      c.graceLeft -= 1;
      if (c.graceLeft <= 0) return this.endCall("dropped");
      return this.sendTimer();
    }
    c.paused = false;
    c.graceLeft = null;
    if (c.phase === "live") {
      const left = deductSecond(c.codeId);
      c.secondsUsed += 1;
      if (left <= config.warningSeconds && !c.warned) c.warned = true;
      if (left <= 0) {
        c.phase = "wrapup";
        c.wrapupLeft = config.wrapupSeconds;
      }
    } else if (c.phase === "wrapup") {
      // The wrap-up minute is never taken from the code.
      c.wrapupLeft -= 1;
      if (c.wrapupLeft <= 0) return this.endCall("time");
    }
    this.sendTimer();
  }
  sendTimer() {
    const c = this.call;
    const msg = {
      type: "timer",
      secondsRemaining: secondsRemaining(c.codeId),
      phase: c.phase,
      warning: c.warned && c.phase === "live",
      wrapupLeft: c.wrapupLeft,
      paused: c.paused,
      graceLeft: c.graceLeft,
    };
    send(c.visitorWs, msg);
    send(c.adminWs, msg);
  }

  endCall(reason) {
    const c = this.call;
    if (!c) return;
    this.call = null;
    if (c.startedAt) {
      db.prepare("INSERT INTO calls (code_id, started_at, ended_at, seconds_used, end_reason) VALUES (?, ?, ?, ?, ?)").run(c.codeId, c.startedAt, nowIso(), c.secondsUsed, reason);
    }
    const msg = { type: "ended", callId: c.id, reason, secondsRemaining: secondsRemaining(c.codeId) };
    send(c.visitorWs, msg);
    if (c.phase === "ringing") {
      this.broadcastAdmins({ type: "ring-cancel", callId: c.id, reason });
      this.notify({ type: "cancel", callId: c.id, reason });
    } else {
      send(c.adminWs, msg);
    }
    for (const ws of [c.visitorWs, c.adminWs]) if (ws) ws.callId = null;
    this.broadcastAdmins({ type: "calls-changed" });
    this.broadcastStatus();
  }
}

export function recentCalls(limit = 50) {
  return db
    .prepare(`SELECT calls.*, codes.code, codes.note FROM calls JOIN codes ON codes.id = calls.code_id ORDER BY calls.id DESC LIMIT ?`)
    .all(limit)
    .map((r) => ({ id: r.id, code: r.code, note: r.note, startedAt: r.started_at, endedAt: r.ended_at, secondsUsed: r.seconds_used, endReason: r.end_reason }));
}
