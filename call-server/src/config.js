// All settings come from environment variables, so no password, key or
// TURN credential ever lives in the repository. See README.md for each one.
import crypto from "node:crypto";

const env = process.env;
const num = (value, fallback) => (value === undefined || value === "" ? fallback : Number(value));
const production = env.NODE_ENV === "production";

function parseIceServers(raw) {
  if (!raw) return [];
  try {
    const list = JSON.parse(raw);
    if (!Array.isArray(list)) throw new Error("not a list");
    return list;
  } catch (err) {
    console.error(`ICE_SERVERS is not valid JSON (${err.message}). Calls will try without STUN/TURN.`);
    return [];
  }
}

export const config = {
  port: num(env.PORT, 8080),
  production,
  adminPassword: env.ADMIN_PASSWORD || "",
  sessionSecret: env.SESSION_SECRET || "",
  allowedOrigins: (env.ALLOWED_ORIGINS || "").split(",").map((s) => s.trim().replace(/\/+$/, "")).filter(Boolean),
  iceServers: parseIceServers(env.ICE_SERVERS),
  // Behind Render or Fly the real visitor IP arrives in X-Forwarded-For.
  trustProxy: env.TRUST_PROXY !== undefined ? env.TRUST_PROXY : production ? "1" : "false",
  cookieSameSite: (env.COOKIE_SAMESITE || "lax").toLowerCase(),

  // The longest a call can last, counted from when both sides connect.
  callLimitSeconds: num(env.CALL_LIMIT_SECONDS, 2700),
  // How often the server checks that each page is still there. A page that
  // misses one check is dropped, so a closed or sleeping admin page turns
  // the status to "Away" within about two of these.
  heartbeatSeconds: num(env.HEARTBEAT_SECONDS, 3),

  // Timings. One "second" lasts TICK_MS milliseconds: 1000 for real calls.
  // The automated tests shorten it so the 45-second ring and the 30-second
  // reconnect wait run quickly.
  tickMs: num(env.TICK_MS, 1000),
  ringTimeoutSeconds: 45,
  warningSeconds: 120,
  reconnectGraceSeconds: 30,
  connectTimeoutSeconds: 30,

  // Safety limits.
  callMaxPresses: num(env.CALL_MAX_PRESSES, 5),
  callWindowMinutes: num(env.CALL_WINDOW_MINUTES, 10),
  loginMaxFailures: num(env.LOGIN_MAX_FAILURES, 5),
  loginLockoutMinutes: num(env.LOGIN_LOCKOUT_MINUTES, 15),
};

export function checkConfig() {
  const problems = [];
  if (!config.adminPassword) problems.push("ADMIN_PASSWORD is not set.");
  else if (config.adminPassword.length < 12) problems.push("ADMIN_PASSWORD should be at least 12 characters.");
  if (!(config.callLimitSeconds > 0)) problems.push("CALL_LIMIT_SECONDS must be a positive number of seconds.");
  if (production) {
    if (config.sessionSecret.length < 32) problems.push("SESSION_SECRET must be at least 32 random characters.");
    if (config.allowedOrigins.length === 0) problems.push("ALLOWED_ORIGINS must list the site's address, e.g. https://benjaminmithra.com.");
  }
  if (!config.sessionSecret) {
    config.sessionSecret = crypto.randomBytes(32).toString("hex");
    console.warn("SESSION_SECRET is not set: using a temporary one (admin logins reset on restart).");
  }
  return problems;
}
