// Talks to the Google Apps Script web app (VITE_BOOKING_URL).
//
// Google answers with a redirect to script.googleusercontent.com, which
// fetch follows by itself (a POST becomes a GET of the result). Bodies are
// sent as text/plain so the browser makes a "simple" request with no CORS
// preflight, and no cookies are sent.
import { BOOKING_URL } from "./talkConfig.js";

async function request(init, params) {
  const url = params ? `${BOOKING_URL}${BOOKING_URL.includes("?") ? "&" : "?"}${new URLSearchParams(params)}` : BOOKING_URL;
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 25000);
  try {
    const res = await fetch(url, { ...init, redirect: "follow", credentials: "omit", cache: "no-store", signal: ctrl.signal });
    if (!res.ok) throw new Error("http");
    return await res.json();
  } finally {
    clearTimeout(timer);
  }
}

export const getSlots = () => request({ method: "GET" }, { action: "slots" });
export const checkCode = (code) => request({ method: "GET" }, { action: "check", code });
export const book = (details) =>
  request({ method: "POST", headers: { "Content-Type": "text/plain;charset=utf-8" }, body: JSON.stringify({ action: "book", ...details }) });

// Immediate Talk and booking status: { immediate, paused }.
export const getStatus = () => request({ method: "GET" }, { action: "status" });
export const requestImmediate = (details) =>
  request({ method: "POST", headers: { "Content-Type": "text/plain;charset=utf-8" }, body: JSON.stringify({ action: "immediate", ...details }) });

// Admin actions for /host (Availability). The key is sent in the body, never in the URL.
export const adminCall = (action, key, payload = {}) =>
  request({ method: "POST", headers: { "Content-Type": "text/plain;charset=utf-8" }, body: JSON.stringify({ ...payload, action, key }) });
