// Service worker for Benjamin's admin page (/admin). It lets the page be
// installed on a phone's home screen. It caches nothing and sends no
// notifications: the admin page must be open to receive calls.

self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", (event) => event.waitUntil(self.clients.claim()));
