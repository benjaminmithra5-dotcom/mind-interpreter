// The call manager: status board, ringing, the server-owned timer, the
// 2-minute warning and reconnection.
//
// One call at a time. Nothing about a call is stored: the caller's name and
// email only travel to Benjamin's admin pages while the call rings, and are
// forgotten when it ends. Only simple counts are kept, in memory.
import crypto from "node:crypto";
import { config } from "./config.js";

const OPEN = 1; // WebSocket.OPEN
const send = (ws, msg) => { if (ws && ws.readyState === OPEN) ws.send(JSON.stringify(msg)); };

export class CallManager {
  constructor() {
    this.sockets = new Set(); // every connected page, for the live status
    this.admins = new Set(); // signed-in admin pages (computer, phone)
    this.call = null;
    // Benjamin's toggle. It starts on Away and only he can change it, so the
    // line never opens by itself (not even after a server restart).
    this.away = true;
    this.lastStatus = null;
    this.counts = { calls: 0, answered: 0, declined: 0, missed: 0 };
    this.timer = setInterval(() => this.tick(), config.tickMs);
    this.timer.unref?.();
  }

  // ---- status -----------------------------------------------------------
  // "On a call" once a call is accepted. While a call only rings the board
  // still says Available, and a second caller hears "Busy".
  status() {
    if (this.call && this.call.phase !== "ringing") return "on_call";
    if (this.away || this.admins.size === 0) return "away";
    return "available";
  }
  canRing() {
    return !this.away && this.admins.size > 0;
  }
  broadcastStatus() {
    const status = this.status();
    if (status === this.lastStatus) return;
    this.lastStatus = status;
    for (const ws of this.sockets) send(ws, { type: "status", status });
  }
  setAway(away) {
    this.away = Boolean(away);
    this.broadcastAdmins({ type: "away", away: this.away });
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
      send(ws, { type: "away", away: this.away });
      const c = this.call;
      if (c && c.phase === "ringing") send(ws, this.incomingMessage());
      if (c && c.phase !== "ringing" && !this.isOpen(c.adminWs)) send(ws, { type: "call-in-progress", callId: c.id });
    }
    send(ws, { type: "status", status: this.status() });
    this.broadcastStatus();
  }
  removeSocket(ws) {
    this.sockets.delete(ws);
    const c = this.call;
    if (ws.isAdmin && this.admins.delete(ws) && this.admins.size === 0 && c && c.phase === "ringing") {
      // Nobody is left to answer.
      this.endCall("away");
    } else if (c && c.phase === "ringing" && ws === c.visitorWs) {
      this.endCall("cancelled");
    }
    this.broadcastStatus();
  }
  isOpen(ws) { return Boolean(ws) && ws.readyState === OPEN; }

  // ---- visitor ----------------------------------------------------------
  startCall(ws, { name, email }) {
    if (this.call) return { error: "busy" };
    if (!this.canRing()) return { error: "away" };
    this.call = {
      id: crypto.randomUUID(),
      name,
      email,
      token: crypto.randomBytes(16).toString("hex"),
      phase: "ringing",
      visitorWs: ws,
      adminWs: null,
      media: { visitor: false, admin: false },
      ringLeft: config.ringTimeoutSeconds,
      connectLeft: config.connectTimeoutSeconds,
      started: false,
      secondsLeft: config.callLimitSeconds,
      warned: false,
      paused: false,
      graceLeft: null,
    };
    this.counts.calls += 1;
    ws.callId = this.call.id;
    this.broadcastAdmins(this.incomingMessage());
    return { callId: this.call.id, token: this.call.token };
  }
  incomingMessage() {
    const c = this.call;
    return { type: "incoming", callId: c.id, name: c.name, email: c.email, ringLeft: c.ringLeft };
  }
  rejoinVisitor(ws, callId, token) {
    const c = this.call;
    if (!c || c.id !== callId || typeof token !== "string" || token.length !== c.token.length || !crypto.timingSafeEqual(Buffer.from(token), Buffer.from(c.token))) return false;
    if (c.visitorWs && c.visitorWs !== ws) c.visitorWs.callId = null;
    c.visitorWs = ws;
    c.media.visitor = false;
    ws.callId = c.id;
    send(ws, { type: "rejoined", callId: c.id, phase: c.phase, iceServers: config.iceServers });
    if (c.phase !== "ringing") send(ws, { type: "renegotiate" });
    return true;
  }

  // ---- admin ------------------------------------------------------------
  accept(ws, callId) {
    const c = this.call;
    if (!c || c.id !== callId || c.phase !== "ringing") return send(ws, { type: "ring-cancel", callId, reason: "gone" });
    c.phase = "live";
    c.adminWs = ws;
    ws.callId = c.id;
    this.counts.answered += 1;
    send(ws, { type: "accepted", callId: c.id, iceServers: config.iceServers, name: c.name, email: c.email });
    send(c.visitorWs, { type: "accepted", callId: c.id, iceServers: config.iceServers });
    // Any other device stops ringing.
    this.broadcastAdmins({ type: "ring-cancel", callId: c.id, reason: "taken" }, ws);
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
      send(c.adminWs, { type: "ended", reason: "moved" });
      c.adminWs.callId = null;
    }
    c.adminWs = ws;
    c.media.admin = false;
    ws.callId = c.id;
    send(ws, { type: "rejoined", callId: c.id, phase: c.phase, name: c.name, email: c.email, iceServers: config.iceServers });
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
    if (!c.started) {
      // Waiting for the two browsers to connect for the first time. The
      // 45 minutes start only once they have.
      if (!ready) {
        c.connectLeft -= 1;
        if (c.connectLeft <= 0) this.endCall("could-not-connect");
        return;
      }
      c.started = true;
      return this.sendTimer();
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
    c.secondsLeft -= 1;
    if (c.secondsLeft <= config.warningSeconds) c.warned = true;
    if (c.secondsLeft <= 0) return this.endCall("time");
    this.sendTimer();
  }
  sendTimer() {
    const c = this.call;
    const msg = { type: "timer", secondsRemaining: c.secondsLeft, warning: c.warned, paused: c.paused, graceLeft: c.graceLeft };
    send(c.visitorWs, msg);
    send(c.adminWs, msg);
  }

  endCall(reason) {
    const c = this.call;
    if (!c) return;
    this.call = null;
    if (reason === "declined") this.counts.declined += 1;
    if (reason === "no-answer") this.counts.missed += 1;
    const msg = { type: "ended", callId: c.id, reason };
    send(c.visitorWs, msg);
    if (c.phase === "ringing") this.broadcastAdmins({ type: "ring-cancel", callId: c.id, reason });
    else send(c.adminWs, msg);
    for (const ws of [c.visitorWs, c.adminWs]) if (ws) ws.callId = null;
    this.broadcastStatus();
  }
}
