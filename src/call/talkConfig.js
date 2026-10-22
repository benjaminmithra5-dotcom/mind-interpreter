// Build-time settings for Talk now (set as GitHub Actions variables; see
// apps-script/README.md). Nothing here is secret: these values end up in the
// site's public code.

// The Google Apps Script web app that handles bookings and code checks.
export const BOOKING_URL = String(import.meta.env.VITE_BOOKING_URL || "").trim();

// STUN/TURN servers for the call, as JSON. Without it: Google's public STUN.
function parseIce(raw) {
  if (!raw) return [{ urls: "stun:stun.l.google.com:19302" }];
  try {
    const list = JSON.parse(raw);
    return Array.isArray(list) ? list : [{ urls: "stun:stun.l.google.com:19302" }];
  } catch {
    return [{ urls: "stun:stun.l.google.com:19302" }];
  }
}
export const ICE_SERVERS = parseIce(import.meta.env.VITE_ICE_SERVERS);

// The PeerJS broker that introduces the two browsers. Empty means PeerJS's
// free public cloud broker. The tests point these at a local broker.
export function peerOptions() {
  const env = import.meta.env;
  const opts = { debug: 0, config: { iceServers: ICE_SERVERS } };
  if (env.VITE_PEER_HOST) {
    opts.host = env.VITE_PEER_HOST;
    opts.port = Number(env.VITE_PEER_PORT || 443);
    opts.path = env.VITE_PEER_PATH || "/";
    opts.secure = env.VITE_PEER_SECURE !== "false";
  }
  return opts;
}

// Call timing. VITE_CALL_LIMIT_SECONDS and VITE_TICK_MS exist so the
// automated tests can run a whole call in seconds; leave them unset.
const num = (v, d) => (v === undefined || v === "" || isNaN(Number(v)) ? d : Number(v));
export const CALL_LIMIT_SECONDS = num(import.meta.env.VITE_CALL_LIMIT_SECONDS, 45 * 60);
export const TICK_MS = num(import.meta.env.VITE_TICK_MS, 1000); // one "second" of call time
export const WARNING_SECONDS = 120;
export const RECONNECT_SECONDS = 30;
export const CONNECT_SECONDS = 30;
export const JOIN_EARLY_MINUTES = 15;
export const JOIN_LATE_MINUTES = 60;

// The room's name on the broker: "mi-" + the booking code.
export const roomId = (code) => `mi-${code}`;
export const normalizeCode = (s) => String(s || "").toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 10);

// The prerender step runs in a headless browser: never connect from there.
export const isPrerender = () => typeof navigator !== "undefined" && navigator.webdriver;
