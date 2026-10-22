// Service worker for Benjamin's admin page (/admin): shows notifications for
// incoming calls and time requests, and opens the admin page when tapped.
// It caches nothing, so the page is always the latest version.

self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", (event) => event.waitUntil(self.clients.claim()));

self.addEventListener("push", (event) => {
  let data = {};
  try { data = event.data ? event.data.json() : {}; } catch { data = {}; }
  const icon = "/favicon-192.png";
  let title = data.title || "Talk now";
  let options = { body: data.body || "", icon, badge: icon, data: { url: "/admin" } };

  if (data.type === "call") {
    options = { ...options, tag: `call-${data.callId}`, renotify: true, requireInteraction: true, vibrate: [400, 200, 400, 200, 400], data: { url: "/admin?ring=1" } };
  } else if (data.type === "cancel") {
    // The call was answered on another device, missed or cancelled: replace
    // the ringing notification with a quiet note so this device stops ringing.
    title = data.reason === "taken" ? "Answered on another device" : data.reason === "no-answer" ? "Missed call" : "Call ended";
    options = { ...options, body: data.reason === "no-answer" ? "No one answered within 45 seconds." : "", tag: `call-${data.callId}`, renotify: false, silent: true };
  } else if (data.type === "request") {
    options = { ...options, tag: "time-request" };
  }
  event.waitUntil(self.registration.showNotification(title, options));
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const url = (event.notification.data && event.notification.data.url) || "/admin";
  event.waitUntil((async () => {
    const all = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
    for (const client of all) {
      if (new URL(client.url).pathname.startsWith("/admin")) {
        await client.focus();
        return;
      }
    }
    await self.clients.openWindow(url);
  })());
});
