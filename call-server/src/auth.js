// Admin sign-in: the password is compared in constant time and the session
// is a signed, httpOnly cookie. Nothing secret is stored on disk.
import crypto from "node:crypto";
import { config } from "./config.js";

export const COOKIE_NAME = "mi_admin";
const SESSION_DAYS = 30;

const sha256 = (value) => crypto.createHash("sha256").update(String(value)).digest();
const sign = (data) => crypto.createHmac("sha256", config.sessionSecret).update(data).digest("base64url");

export function passwordMatches(input) {
  if (!config.adminPassword || typeof input !== "string") return false;
  return crypto.timingSafeEqual(sha256(input), sha256(config.adminPassword));
}

export function makeSessionToken() {
  const payload = Buffer.from(JSON.stringify({ exp: Date.now() + SESSION_DAYS * 864e5, n: crypto.randomBytes(8).toString("hex") })).toString("base64url");
  return `${payload}.${sign(payload)}`;
}

export function verifySessionToken(token) {
  if (typeof token !== "string" || !token.includes(".")) return false;
  const [payload, mac] = token.split(".");
  const expected = Buffer.from(sign(payload));
  const given = Buffer.from(mac || "");
  if (given.length !== expected.length || !crypto.timingSafeEqual(given, expected)) return false;
  try {
    return JSON.parse(Buffer.from(payload, "base64url").toString()).exp > Date.now();
  } catch {
    return false;
  }
}

export function parseCookies(header) {
  const out = {};
  for (const part of String(header || "").split(";")) {
    const i = part.indexOf("=");
    if (i > 0) out[part.slice(0, i).trim()] = decodeURIComponent(part.slice(i + 1).trim());
  }
  return out;
}

export const isAdminRequest = (req) => verifySessionToken(parseCookies(req.headers.cookie)[COOKIE_NAME]);

export function sessionCookie(token, { clear = false } = {}) {
  const sameSite = config.cookieSameSite === "none" ? "None" : config.cookieSameSite === "strict" ? "Strict" : "Lax";
  const parts = [`${COOKIE_NAME}=${clear ? "" : encodeURIComponent(token)}`, "Path=/", "HttpOnly", `SameSite=${sameSite}`, `Max-Age=${clear ? 0 : SESSION_DAYS * 86400}`];
  if (config.production || sameSite === "None") parts.push("Secure");
  return parts.join("; ");
}
