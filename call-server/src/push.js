// Web push to Benjamin's devices (computer and phone) for incoming calls and
// new time requests. Uses the VAPID keys from the environment; without them,
// notifications are simply off.
import webpush from "web-push";
import { config } from "./config.js";
import { db, nowIso } from "./db.js";

export const pushEnabled = Boolean(config.vapid.publicKey && config.vapid.privateKey && config.vapid.subject);
if (pushEnabled) webpush.setVapidDetails(config.vapid.subject, config.vapid.publicKey, config.vapid.privateKey);

export function saveSubscription(sub) {
  if (!sub || typeof sub.endpoint !== "string" || !/^https:\/\//.test(sub.endpoint) || !sub.keys?.p256dh || !sub.keys?.auth) return false;
  db.prepare("INSERT INTO push_subscriptions (endpoint, subscription, created_at) VALUES (?, ?, ?) ON CONFLICT(endpoint) DO UPDATE SET subscription = excluded.subscription")
    .run(sub.endpoint, JSON.stringify({ endpoint: sub.endpoint, keys: { p256dh: sub.keys.p256dh, auth: sub.keys.auth } }), nowIso());
  return true;
}
export function removeSubscription(endpoint) {
  db.prepare("DELETE FROM push_subscriptions WHERE endpoint = ?").run(String(endpoint || ""));
}

// event: { type: "call" | "cancel" | "request" | "test", callId?, title?, body?, reason? }
export async function notifyDevices(event) {
  if (!pushEnabled) return;
  const payload = JSON.stringify(event);
  const rows = db.prepare("SELECT endpoint, subscription FROM push_subscriptions").all();
  await Promise.all(rows.map(async (row) => {
    try {
      await webpush.sendNotification(JSON.parse(row.subscription), payload, { TTL: event.type === "call" ? 45 : 3600, urgency: event.type === "call" ? "high" : "normal" });
    } catch (err) {
      if (err.statusCode === 404 || err.statusCode === 410) removeSubscription(row.endpoint); // the device unsubscribed
      else console.warn("Push failed:", err.statusCode || err.message);
    }
  }));
}
