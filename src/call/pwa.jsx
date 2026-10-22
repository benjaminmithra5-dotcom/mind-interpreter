import { useEffect } from "react";

// Makes /admin an installable app (manifest + service worker), so it can sit
// on the phone's home screen. There are no push notifications: the page has
// to be open to receive calls.
export function useAdminApp() {
  useEffect(() => {
    const link = document.createElement("link");
    link.rel = "manifest";
    link.href = "/admin.webmanifest";
    document.head.appendChild(link);
    const iosTitle = document.createElement("meta");
    iosTitle.name = "apple-mobile-web-app-title";
    iosTitle.content = "Talk now";
    document.head.appendChild(iosTitle);
    if ("serviceWorker" in navigator && !navigator.webdriver) navigator.serviceWorker.register("/admin-sw.js", { scope: "/admin" }).catch(() => {});
    return () => { link.remove(); iosTitle.remove(); };
  }, []);
}
