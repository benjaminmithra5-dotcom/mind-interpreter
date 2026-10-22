// SQLite storage. Only codes, time requests, push subscriptions, one
// setting and call metadata (start, end, seconds used) are stored. Never any
// audio, video or call content.
import fs from "node:fs";
import path from "node:path";
import Database from "better-sqlite3";
import { config } from "./config.js";

fs.mkdirSync(config.dataDir, { recursive: true });
export const db = new Database(path.join(config.dataDir, "calls.db"));
db.pragma("journal_mode = WAL");
db.pragma("foreign_keys = ON");

db.exec(`
  CREATE TABLE IF NOT EXISTS codes (
    id INTEGER PRIMARY KEY,
    code TEXT NOT NULL UNIQUE,
    seconds_remaining INTEGER NOT NULL CHECK (seconds_remaining >= 0),
    mode TEXT NOT NULL CHECK (mode IN ('audio', 'audio+video')),
    expires_at TEXT,
    created_at TEXT NOT NULL,
    note TEXT NOT NULL DEFAULT '',
    disabled INTEGER NOT NULL DEFAULT 0
  );
  CREATE TABLE IF NOT EXISTS calls (
    id INTEGER PRIMARY KEY,
    code_id INTEGER NOT NULL REFERENCES codes(id),
    started_at TEXT NOT NULL,
    ended_at TEXT NOT NULL,
    seconds_used INTEGER NOT NULL,
    end_reason TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS requests (
    id INTEGER PRIMARY KEY,
    code_id INTEGER REFERENCES codes(id),
    name TEXT NOT NULL DEFAULT '',
    preferred_time TEXT NOT NULL,
    timezone TEXT NOT NULL,
    created_at TEXT NOT NULL,
    done INTEGER NOT NULL DEFAULT 0
  );
  CREATE TABLE IF NOT EXISTS push_subscriptions (
    endpoint TEXT PRIMARY KEY,
    subscription TEXT NOT NULL,
    created_at TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY, value TEXT NOT NULL);
`);

export const nowIso = () => new Date().toISOString();

export function getSetting(key, fallback) {
  const row = db.prepare("SELECT value FROM settings WHERE key = ?").get(key);
  return row ? JSON.parse(row.value) : fallback;
}
export function setSetting(key, value) {
  db.prepare("INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value").run(key, JSON.stringify(value));
}
