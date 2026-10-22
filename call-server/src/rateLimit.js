// Counts failures per key (an IP address) and locks the key out for a while
// after too many. Kept in memory: a restart clears it.
export class FailureLimiter {
  constructor({ maxFailures, windowMs, lockoutMs }) {
    Object.assign(this, { maxFailures, windowMs, lockoutMs });
    this.entries = new Map();
    setInterval(() => this.sweep(), 60_000).unref();
  }
  status(key) {
    const e = this.entries.get(key);
    if (e && e.lockedUntil > Date.now()) return { locked: true, retryAfterSeconds: Math.ceil((e.lockedUntil - Date.now()) / 1000) };
    return { locked: false };
  }
  fail(key) {
    const now = Date.now();
    const e = this.entries.get(key) || { fails: [], lockedUntil: 0 };
    e.fails = e.fails.filter((t) => now - t < this.windowMs);
    e.fails.push(now);
    if (e.fails.length >= this.maxFailures) {
      e.lockedUntil = now + this.lockoutMs;
      e.fails = [];
    }
    this.entries.set(key, e);
    return this.status(key);
  }
  succeed(key) {
    const e = this.entries.get(key);
    if (e && !(e.lockedUntil > Date.now())) this.entries.delete(key);
  }
  sweep() {
    const now = Date.now();
    for (const [k, e] of this.entries) if (e.lockedUntil < now && !e.fails.some((t) => now - t < this.windowMs)) this.entries.delete(k);
  }
}
