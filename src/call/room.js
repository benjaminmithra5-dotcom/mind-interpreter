// The Talk now call: browser to browser, audio only, over WebRTC. PeerJS's
// broker only introduces the two browsers; the audio and the small control
// messages then go directly between them (or, if a TURN relay is set,
// through it, still encrypted end to end). Nothing is recorded.
//
// The host (Benjamin, on /host) registers on the broker as "mi-" + code.
// The guest (on /call) connects to that name with their first name. The
// host admits or declines; once admitted, the guest calls with audio.
//
// The host's page owns the timer: it counts down while both sides are
// connected, pauses while the connection is lost (up to 30 seconds), and
// sends the time left to the guest every tick.
//
// Messages on the data channel (JSON):
//   guest → host: { t: "hb" } heartbeat, { t: "end" }
//   host → guest: { t: "busy" }, { t: "declined" }, { t: "admitted", token },
//                 { t: "tick", remaining, warning, paused, grace }, { t: "end", reason }
import { peerOptions, roomId, CALL_LIMIT_SECONDS, TICK_MS, WARNING_SECONDS, RECONNECT_SECONDS, CONNECT_SECONDS } from "./talkConfig.js";

// A side counts as gone when nothing has been heard from it for this long.
const STALE_MS = Math.max(4 * TICK_MS, 3000);
const HEARTBEAT_MS = Math.min(TICK_MS, 1000);

async function newPeer(id) {
  const { Peer } = await import("peerjs");
  return id ? new Peer(id, peerOptions()) : new Peer(peerOptions());
}
const randomToken = () => Array.from(crypto.getRandomValues(new Uint8Array(16)), (b) => b.toString(16).padStart(2, "0")).join("");
const iceUp = (pc) => Boolean(pc) && ["connected", "completed"].includes(pc.iceConnectionState);
const safeName = (s) => String(s || "").replace(/\s+/g, " ").trim().slice(0, 60) || "Your guest";

// =====================================================================
// Host
// =====================================================================
export class HostRoom {
  /**
   * on: { state(s), waiting(guestName|null), remote(stream), tick(t), ended(reason), notice(text), error(text) }
   * States: opening | open | in-call | closed
   */
  constructor({ code, stream, on }) {
    Object.assign(this, { code, stream, on });
    this.peer = null;
    this.pending = null; // { conn, name }
    this.call = null; // { conn, media, name, token, started, paused, grace, connectLeft, lastHeard }
    this.remaining = CALL_LIMIT_SECONDS;
    this.closed = false;
    this.timer = null;
  }

  async open() {
    this.on.state("opening");
    this.peer = await newPeer(roomId(this.code));
    this.peer.on("open", () => { if (!this.closed) this.on.state("open"); });
    this.peer.on("connection", (conn) => this.onConnection(conn));
    this.peer.on("call", (media) => this.onMedia(media));
    this.peer.on("disconnected", () => {
      // Lost the broker (not the call): keep trying, so new guests can find the room.
      if (!this.closed) setTimeout(() => !this.closed && this.peer && this.peer.disconnected && this.peer.reconnect(), 2000);
    });
    this.peer.on("error", (err) => {
      if (this.closed) return;
      if (err.type === "unavailable-id") this.fail("This room is already open on another page or device.");
      else if (["network", "server-error", "socket-error", "socket-closed", "browser-incompatible", "ssl-unavailable"].includes(err.type) && this.peer.open === false && !this.everOpen) {
        this.fail("Couldn't reach the connection service. Please check your internet and try again.");
      }
    });
    this.peer.on("open", () => { this.everOpen = true; });
    this.timer = setInterval(() => this.tick(), TICK_MS);
  }

  fail(text) {
    this.on.error(text);
    this.close("failed");
  }

  onConnection(conn) {
    conn.on("open", () => {
      const meta = conn.metadata || {};
      const c = this.call;
      // The admitted guest coming back after a drop.
      if (c && meta.rejoin && meta.rejoin === c.token) {
        if (c.conn && c.conn !== conn) c.conn.close();
        c.conn = conn;
        c.lastHeard = Date.now();
        this.listen(conn);
        conn.send({ t: "admitted", token: c.token });
        return;
      }
      // One guest at a time: anyone else hears "busy".
      if (c || this.pending || this.remaining <= 0) {
        conn.send({ t: this.remaining <= 0 ? "end" : "busy", reason: "time" });
        setTimeout(() => conn.close(), 500);
        return;
      }
      this.pending = { conn, name: safeName(meta.name) };
      conn.on("close", () => {
        if (this.pending && this.pending.conn === conn) {
          this.pending = null;
          this.on.waiting(null);
          this.on.notice("The guest left the waiting room.");
        }
      });
      this.on.notice("");
      this.on.waiting(this.pending.name);
    });
  }

  admit() {
    const p = this.pending;
    if (!p) return;
    this.pending = null;
    this.on.waiting(null);
    this.call = { conn: p.conn, media: null, name: p.name, token: randomToken(), started: false, paused: false, grace: null, connectLeft: CONNECT_SECONDS, lastHeard: Date.now() };
    this.listen(p.conn);
    p.conn.send({ t: "admitted", token: this.call.token });
    this.on.state("in-call");
  }

  decline() {
    const p = this.pending;
    if (!p) return;
    this.pending = null;
    this.on.waiting(null);
    p.conn.send({ t: "declined" });
    setTimeout(() => p.conn.close(), 500);
  }

  listen(conn) {
    conn.on("data", (msg) => {
      const c = this.call;
      if (!c || c.conn !== conn) return;
      c.lastHeard = Date.now();
      if (msg && msg.t === "end") this.endCall("guest-ended");
    });
  }

  onMedia(media) {
    const c = this.call;
    if (!c || !media.metadata || media.metadata.token !== c.token) {
      media.close();
      return;
    }
    if (c.media && c.media !== media) c.media.close();
    c.media = media;
    media.answer(this.stream);
    media.on("stream", (remote) => this.on.remote(remote));
  }

  connected() {
    const c = this.call;
    return Boolean(c && c.conn && c.conn.open && c.media && iceUp(c.media.peerConnection) && Date.now() - c.lastHeard < STALE_MS);
  }

  tick() {
    const c = this.call;
    if (!c) return;
    const up = this.connected();
    if (!c.started) {
      // The 45 minutes start when the two browsers are connected.
      if (!up) {
        c.connectLeft -= 1;
        if (c.connectLeft <= 0) this.endCall("could-not-connect");
        return;
      }
      c.started = true;
    } else if (!up) {
      if (!c.paused) { c.paused = true; c.grace = RECONNECT_SECONDS; }
      c.grace -= 1;
      if (c.grace <= 0) return this.endCall("lost");
      return this.sendTick();
    }
    c.paused = false;
    c.grace = null;
    this.remaining -= 1;
    if (this.remaining <= 0) return this.endCall("time");
    this.sendTick();
  }

  sendTick() {
    const c = this.call;
    const t = { t: "tick", remaining: this.remaining, warning: this.remaining <= WARNING_SECONDS, paused: c.paused, grace: c.grace };
    if (c.conn && c.conn.open) c.conn.send(t);
    this.on.tick(t);
  }

  endCall(reason) {
    const c = this.call;
    if (!c) return;
    this.call = null;
    try { if (c.conn && c.conn.open) c.conn.send({ t: "end", reason }); } catch { /* gone */ }
    setTimeout(() => { c.conn && c.conn.close(); c.media && c.media.close(); }, 400);
    this.on.remote(null);
    this.on.ended(reason);
    this.on.state(this.remaining <= 0 ? "time-up" : "open");
  }

  hangup() { this.endCall("host-ended"); }

  close() {
    if (this.closed) return;
    if (this.call) this.endCall("closed");
    if (this.pending) { try { this.pending.conn.send({ t: "end", reason: "closed" }); } catch { /* gone */ } }
    this.closed = true;
    clearInterval(this.timer);
    const peer = this.peer;
    setTimeout(() => peer && peer.destroy(), 500);
    this.on.state("closed");
  }
}

// =====================================================================
// Guest
// =====================================================================
export class GuestRoom {
  /**
   * on: { state(s), remote(stream), tick(t), ended(reason), token(token|null) }
   * States: connecting-room | not-open | waiting | connecting | in-call | reconnecting | ended
   */
  constructor({ code, name, stream, token = null, on }) {
    Object.assign(this, { code, name, stream, on, token });
    this.peer = null;
    this.conn = null;
    this.media = null;
    this.state = "idle";
    this.lastHeard = 0;
    this.grace = null;
    this.retry = null;
    this.done = false;
  }

  setState(s) { this.state = s; this.on.state(s); }

  async join() {
    this.setState(this.token ? "reconnecting" : "connecting-room");
    this.peer = await newPeer();
    this.peer.on("open", () => this.connect());
    this.peer.on("error", (err) => {
      if (this.done) return;
      if (err.type === "peer-unavailable") {
        // The host hasn't opened the room (or dropped): try again shortly.
        if (this.state === "connecting-room" || this.state === "not-open") this.setState("not-open");
        this.scheduleRetry(this.state === "reconnecting" ? 2000 : 5000);
      } else if (!this.peer.open) {
        this.scheduleRetry(4000);
      }
    });
    this.peer.on("disconnected", () => { if (!this.done) setTimeout(() => !this.done && this.peer.disconnected && this.peer.reconnect(), 2000); });
    this.beat = setInterval(() => this.heartbeat(), HEARTBEAT_MS);
  }

  scheduleRetry(ms) {
    clearTimeout(this.retry);
    this.retry = setTimeout(() => { if (!this.done && this.peer && this.peer.open) this.connect(); }, ms);
  }

  connect() {
    if (this.done) return;
    if (this.conn) { this.conn.removeAllListeners(); this.conn.close(); }
    const conn = this.peer.connect(roomId(this.code), { reliable: true, serialization: "json", metadata: { name: this.name, rejoin: this.token || undefined } });
    this.conn = conn;
    conn.on("open", () => {
      if (conn !== this.conn) return;
      this.lastHeard = Date.now();
      if (!this.token) this.setState("waiting");
    });
    conn.on("data", (msg) => conn === this.conn && this.onMessage(msg));
    conn.on("close", () => {
      if (conn !== this.conn || this.done) return;
      if (this.state === "waiting") this.finish("closed");
      // In a call: the heartbeat check below notices and starts reconnecting.
    });
  }

  onMessage(msg) {
    if (!msg || typeof msg !== "object") return;
    this.lastHeard = Date.now();
    switch (msg.t) {
      case "busy": return this.finish("busy");
      case "declined": return this.finish("declined");
      case "end": return this.finish(msg.reason || "host-ended");
      case "admitted":
        this.token = msg.token;
        this.on.token(this.token);
        if (this.state !== "reconnecting") this.setState("connecting");
        this.callHost();
        return;
      case "tick":
        this.grace = null;
        if (this.state !== "in-call" && !msg.paused) this.setState("in-call");
        this.on.tick(msg);
        if (msg.remaining <= 0) this.finish("time");
        return;
    }
  }

  callHost() {
    if (this.media) this.media.close();
    const media = this.peer.call(roomId(this.code), this.stream, { metadata: { token: this.token } });
    this.media = media;
    media.on("stream", (remote) => media === this.media && this.on.remote(remote));
  }

  heartbeat() {
    if (this.done) return;
    if (this.conn && this.conn.open) { try { this.conn.send({ t: "hb" }); } catch { /* closing */ } }
    if (!["in-call", "reconnecting"].includes(this.state) || !this.token) return;
    const silent = Date.now() - this.lastHeard > STALE_MS;
    if (this.state === "in-call" && silent) {
      // Lost the host: pause and try to get back in for up to 30 seconds.
      this.setState("reconnecting");
      this.grace = RECONNECT_SECONDS;
      this.graceStarted = Date.now();
      this.connect();
      this.on.tick({ paused: true, grace: this.grace, local: true });
    } else if (this.state === "reconnecting" && silent) {
      if (this.grace == null) { this.grace = RECONNECT_SECONDS; this.graceStarted = Date.now(); }
      const left = RECONNECT_SECONDS - Math.floor((Date.now() - this.graceStarted) / TICK_MS);
      this.on.tick({ paused: true, grace: Math.max(0, left), local: true });
      if (left <= 0) return this.finish("lost");
      if (!this.conn || !this.conn.open) {
        if (!this.lastTry || Date.now() - this.lastTry > 2500) { this.lastTry = Date.now(); this.connect(); }
      }
    }
  }

  setMuted(muted) { for (const t of this.stream.getAudioTracks()) t.enabled = !muted; }

  hangup() {
    if (this.conn && this.conn.open) { try { this.conn.send({ t: "end" }); } catch { /* gone */ } }
    this.finish("guest-ended");
  }

  leave() { this.finish("cancelled"); }

  finish(reason) {
    if (this.done) return;
    this.done = true;
    clearTimeout(this.retry);
    clearInterval(this.beat);
    this.setState("ended");
    this.on.remote(null);
    this.on.ended(reason);
    const { conn, media, peer } = this;
    setTimeout(() => { conn && conn.close(); media && media.close(); peer && peer.destroy(); }, 300);
  }
}
