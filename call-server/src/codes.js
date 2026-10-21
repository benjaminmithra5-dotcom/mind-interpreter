// Minute codes: 10 characters from an alphabet without look-alikes
// (no 0/O, 1/I/L), so they are easy to read out and type.
import crypto from "node:crypto";
import { db, nowIso } from "./db.js";
import { config } from "./config.js";

export const CODE_ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";
export const CODE_LENGTH = 10;

export function generateCode() {
  for (;;) {
    let code = "";
    for (let i = 0; i < CODE_LENGTH; i++) code += CODE_ALPHABET[crypto.randomInt(CODE_ALPHABET.length)];
    if (!db.prepare("SELECT 1 FROM codes WHERE code = ?").get(code)) return code;
  }
}

// Accepts any case, spaces and dashes ("abcde-fghjk").
export function normalizeCode(input) {
  return String(input || "").toUpperCase().replace(/[^A-Z0-9]/g, "");
}

const isExpired = (row) => Boolean(row.expires_at) && Date.now() > Date.parse(row.expires_at);

export function codeInfo(row) {
  return {
    id: row.id,
    code: row.code,
    secondsRemaining: row.seconds_remaining,
    mode: row.mode,
    expiresAt: row.expires_at,
    createdAt: row.created_at,
    note: row.note,
    disabled: Boolean(row.disabled),
    expired: isExpired(row),
  };
}

// Looks a code up for a visitor. Returns { ok, row } or { ok: false, reason }.
export function checkCode(input) {
  const code = normalizeCode(input);
  if (code.length !== CODE_LENGTH) return { ok: false, reason: "invalid" };
  const row = db.prepare("SELECT * FROM codes WHERE code = ?").get(code);
  if (!row || row.disabled) return { ok: false, reason: "invalid" };
  if (isExpired(row)) return { ok: false, reason: "expired" };
  if (row.seconds_remaining <= 0) return { ok: false, reason: "used-up" };
  return { ok: true, row };
}

export function publicCodeInfo(row) {
  return { code: row.code, secondsRemaining: row.seconds_remaining, mode: row.mode, expiresAt: row.expires_at };
}

// expiresOn is "YYYY-MM-DD": the code works until the end of that day (UTC).
export function createCode({ minutes = config.defaultCodeMinutes, mode = "audio", expiresOn = null, note = "" } = {}) {
  const expiresAt = expiresOn ? new Date(`${expiresOn}T23:59:59.999Z`).toISOString() : null;
  const code = generateCode();
  const info = db
    .prepare("INSERT INTO codes (code, seconds_remaining, mode, expires_at, created_at, note) VALUES (?, ?, ?, ?, ?, ?)")
    .run(code, Math.round(minutes * 60), mode, expiresAt, nowIso(), note);
  return codeInfo(db.prepare("SELECT * FROM codes WHERE id = ?").get(info.lastInsertRowid));
}

export function listCodes() {
  return db.prepare("SELECT * FROM codes ORDER BY created_at DESC").all().map(codeInfo);
}

export function addMinutes(id, minutes) {
  db.prepare("UPDATE codes SET seconds_remaining = seconds_remaining + ? WHERE id = ?").run(Math.round(minutes * 60), id);
  const row = db.prepare("SELECT * FROM codes WHERE id = ?").get(id);
  return row ? codeInfo(row) : null;
}

export function setDisabled(id, disabled) {
  db.prepare("UPDATE codes SET disabled = ? WHERE id = ?").run(disabled ? 1 : 0, id);
  const row = db.prepare("SELECT * FROM codes WHERE id = ?").get(id);
  return row ? codeInfo(row) : null;
}

// Takes one second off a code, never below zero. Returns what is left.
export function deductSecond(id) {
  db.prepare("UPDATE codes SET seconds_remaining = MAX(seconds_remaining - 1, 0) WHERE id = ?").run(id);
  return db.prepare("SELECT seconds_remaining FROM codes WHERE id = ?").get(id).seconds_remaining;
}

export function secondsRemaining(id) {
  return db.prepare("SELECT seconds_remaining FROM codes WHERE id = ?").get(id)?.seconds_remaining ?? 0;
}
