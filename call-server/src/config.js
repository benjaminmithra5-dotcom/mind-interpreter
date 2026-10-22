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
  dataDir: env.DATA_DIR || "./data",
  adminPassword: env.ADMIN_PASSWORD || "",
  sessionSecret: env.SESSION_SECRET || "",
  allowedOrigins: (env.ALLOWED_ORIGINS || "").split(",").map((s) => s.trim().replace(/\/+$/, "")).filter(Boolean),
  iceServers: parseIceServers(env.ICE_SERVERS),
  vapid: {
    publicKey: env.VAPID_PUBLIC_KEY || "",
    privateKey: env.VAPID_PRIVATE_KEY || "",
    subject: env.VAPID_SUBJECT || "",
  },
  // Behind Render or Fly the real visitor IP arrives in X-Forwarded-For.
  trustProxy: env.TRUST_PROXY !== undefined ? env.TRUST_PROXY : production ? "1" : "false",
  cookieSameSite: (env.COOKIE_SAMESITE || "lax").toLowerCase(),

  // Timings. One "second" lasts TICK_MS milliseconds: 1000 for real calls.
  // The automated tests shorten it so a whole call runs in a few seconds.
  tickMs: num(env.TICK_MS, 1000),
  ringTimeoutSeconds: num(env.RING_TIMEOUT_SECONDS, 45),
  warningSeconds: num(env.WARNING_SECONDS, 120),
  wrapupSeconds: num(env.WRAPUP_SECONDS, 60),
  reconnectGraceSeconds: num(env.RECONNECT_GRACE_SECONDS, 30),
  connectTimeoutSeconds: num(env.CONNECT_TIMEOUT_SECONDS, 30),
  adminAwayGraceSeconds: num(env.ADMIN_AWAY_GRACE_SECONDS, 60),

  // Safety limits.
  codeMaxFailures: num(env.CODE_MAX_FAILURES, 5),
  codeLockoutMinutes: num(env.CODE_LOCKOUT_MINUTES, 15),
  loginMaxFailures: num(env.LOGIN_MAX_FAILURES, 5),
  loginLockoutMinutes: num(env.LOGIN_LOCKOUT_MINUTES, 15),
  defaultCodeMinutes: 45,
};

export function checkConfig() {
  const problems = [];
  if (!config.adminPassword) problems.push("ADMIN_PASSWORD is not set.");
  else if (config.adminPassword.length < 12) problems.push("ADMIN_PASSWORD should be at least 12 characters.");
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
