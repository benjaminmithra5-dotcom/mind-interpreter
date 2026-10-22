// Talks to the Talk now call server (VITE_CALL_SERVER_URL): HTTP for codes
// and admin data, a WebSocket for the live status, ringing and signalling,
// and a direct browser-to-browser WebRTC connection for the call itself.

export const SERVER_URL = String(import.meta.env.VITE_CALL_SERVER_URL || "").replace(/\/+$/, "");
const WS_URL = SERVER_URL ? SERVER_URL.replace(/^http/, "ws") + "/ws" : "";

// The prerender step runs in a headless browser: never connect from there,
// so the static HTML never holds a live status.
export const canConnect = () => Boolean(SERVER_URL) && typeof window !== "undefined" && !navigator.webdriver;

export async function api(path, { method = "GET", body } = {}) {
  const res = await fetch(SERVER_URL + path, {
    method,
    credentials: "include",
    headers: body ? { "Content-Type": "application/json" } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  });
  let data = {};
  try { data = await res.json(); } catch { /* empty */ }
  return { ok: res.ok, status: res.status, data };
}

// A WebSocket that reconnects by itself (1s, 2s, 4s … up to 15s).
export function connectSocket({ admin = false, onMessage, onOpen, onClose }) {
  let ws = null;
  let stopped = false;
  let delay = 1000;
  let timer = null;
  const open = () => {
    ws = new WebSocket(WS_URL + (admin ? "?role=admin" : ""));
    ws.onopen = () => { delay = 1000; onOpen?.(); };
    ws.onmessage = (e) => { try { onMessage(JSON.parse(e.data)); } catch { /* ignore */ } };
    ws.onclose = (e) => {
      onClose?.(e);
      if (stopped || e.code === 4401) return;
      timer = setTimeout(open, delay);
      delay = Math.min(delay * 2, 15000);
    };
  };
  open();
  return {
    send: (msg) => ws && ws.readyState === 1 && ws.send(JSON.stringify(msg)),
    close: () => { stopped = true; clearTimeout(timer); ws && ws.close(); },
    isOpen: () => Boolean(ws) && ws.readyState === 1,
  };
}

// Microphone (and camera for video codes) with the browser's own echo
// cancellation, noise suppression and automatic gain switched on.
export const AUDIO_CONSTRAINTS = { echoCancellation: true, noiseSuppression: true, autoGainControl: true };
export function getMedia({ video = false } = {}) {
  return navigator.mediaDevices.getUserMedia({
    audio: AUDIO_CONSTRAINTS,
    video: video ? { width: { ideal: 640 }, height: { ideal: 480 }, facingMode: "user" } : false,
  });
}

// One side of the call. The visitor makes the offer; Benjamin answers. When
// either side reconnects, the visitor starts a fresh connection.
export class CallConnection {
  constructor({ iceServers = [], localStream, send, onRemoteStream, onState }) {
    Object.assign(this, { iceServers, localStream, send, onRemoteStream, onState });
    this.pc = null;
    this.pending = [];
  }
  newPeer() {
    if (this.pc) { this.pc.onconnectionstatechange = null; this.pc.close(); }
    const pc = new RTCPeerConnection({ iceServers: this.iceServers });
    this.pc = pc;
    this.pending = [];
    for (const track of this.localStream.getTracks()) pc.addTrack(track, this.localStream);
    pc.onicecandidate = (e) => e.candidate && this.send({ kind: "candidate", candidate: e.candidate.toJSON() });
    pc.ontrack = (e) => this.onRemoteStream(e.streams[0] || new MediaStream([e.track]));
    pc.onconnectionstatechange = () => {
      if (pc !== this.pc) return;
      const state = pc.connectionState;
      this.onState(state);
    };
    return pc;
  }
  async offer() {
    const pc = this.newPeer();
    const offer = await pc.createOffer({ offerToReceiveAudio: true, offerToReceiveVideo: true });
    await pc.setLocalDescription(offer);
    this.send({ kind: "offer", sdp: pc.localDescription.toJSON() });
  }
  async handle(data) {
    if (data.kind === "offer") {
      const pc = this.newPeer();
      await pc.setRemoteDescription(data.sdp);
      await this.flush();
      const answer = await pc.createAnswer();
      await pc.setLocalDescription(answer);
      this.send({ kind: "answer", sdp: pc.localDescription.toJSON() });
    } else if (data.kind === "answer" && this.pc) {
      await this.pc.setRemoteDescription(data.sdp);
      await this.flush();
    } else if (data.kind === "candidate") {
      if (this.pc && this.pc.remoteDescription) await this.pc.addIceCandidate(data.candidate).catch(() => {});
      else this.pending.push(data.candidate);
    }
  }
  async flush() {
    for (const c of this.pending.splice(0)) await this.pc.addIceCandidate(c).catch(() => {});
  }
  setMuted(muted) { for (const t of this.localStream.getAudioTracks()) t.enabled = !muted; }
  setCamera(on) { for (const t of this.localStream.getVideoTracks()) t.enabled = on; }
  close() {
    if (this.pc) { this.pc.onconnectionstatechange = null; this.pc.close(); this.pc = null; }
    for (const t of this.localStream.getTracks()) t.stop();
  }
}

export const formatClock = (seconds) => {
  const s = Math.max(0, Math.floor(seconds || 0));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
};
export const STATUS_LABEL = { available: "Available", on_call: "On a call", away: "Away", checking: "Checking…" };
export const MODE_LABEL = { audio: "Audio only", "audio+video": "Audio and video" };
export function formatExpiry(iso) {
  if (!iso) return "No expiry";
  return "Expires " + new Date(iso).toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric", timeZone: "UTC" });
}

// Short sounds made in the browser (no audio files): a speaker test chime
// and Benjamin's ring.
export function playChime(ctx, { freqs = [660, 880], gap = 0.22, length = 0.35, volume = 0.18 } = {}) {
  const t0 = ctx.currentTime + 0.02;
  freqs.forEach((f, i) => {
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = "sine";
    osc.frequency.value = f;
    gain.gain.setValueAtTime(0, t0 + i * gap);
    gain.gain.linearRampToValueAtTime(volume, t0 + i * gap + 0.03);
    gain.gain.exponentialRampToValueAtTime(0.001, t0 + i * gap + length);
    osc.connect(gain).connect(ctx.destination);
    osc.start(t0 + i * gap);
    osc.stop(t0 + i * gap + length + 0.05);
  });
}
