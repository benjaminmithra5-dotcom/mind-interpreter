import { useEffect, useState } from "react";
import { api } from "./callClient.js";

// Makes /admin an installable app (manifest + service worker) and lets
// Benjamin turn on notifications for incoming calls on each device.
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

const toKey = (base64) => {
  const pad = "=".repeat((4 - (base64.length % 4)) % 4);
  const raw = atob((base64 + pad).replace(/-/g, "+").replace(/_/g, "/"));
  return Uint8Array.from(raw, (ch) => ch.charCodeAt(0));
};

export function PushControls({ ui, vapidPublicKey }) {
  const supported = typeof window !== "undefined" && "serviceWorker" in navigator && "PushManager" in window && "Notification" in window;
  const [state, setState] = useState("unknown"); // unknown | off | on | blocked
  const [message, setMessage] = useState("");

  useEffect(() => {
    if (!supported || !vapidPublicKey) return;
    navigator.serviceWorker.getRegistration("/admin").then(async (reg) => {
      const sub = reg && (await reg.pushManager.getSubscription());
      setState(Notification.permission === "denied" ? "blocked" : sub ? "on" : "off");
    });
  }, [supported, vapidPublicKey]);

  if (!vapidPublicKey) return <p style={ui.small}>Phone notifications aren't set up on the server yet (VAPID keys).</p>;
  if (!supported) return <p style={ui.small}>This browser can't show call notifications. On iPhone, add this page to your Home Screen first, then open it from there.</p>;

  async function turnOn() {
    setMessage("");
    try {
      const permission = await Notification.requestPermission();
      if (permission !== "granted") { setState(permission === "denied" ? "blocked" : "off"); return; }
      const reg = (await navigator.serviceWorker.getRegistration("/admin")) || (await navigator.serviceWorker.register("/admin-sw.js", { scope: "/admin" }));
      await navigator.serviceWorker.ready;
      const sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: toKey(vapidPublicKey) });
      const { ok, data } = await api("/api/admin/push/subscribe", { method: "POST", body: { subscription: sub.toJSON() } });
      if (!ok) throw new Error(data.message);
      setState("on");
    } catch (err) {
      setMessage(err.message || "Couldn't turn on notifications.");
    }
  }
  async function turnOff() {
    const reg = await navigator.serviceWorker.getRegistration("/admin");
    const sub = reg && (await reg.pushManager.getSubscription());
    if (sub) {
      await api("/api/admin/push/unsubscribe", { method: "POST", body: { endpoint: sub.endpoint } });
      await sub.unsubscribe();
    }
    setState("off");
  }
  const test = async () => { const { ok, data } = await api("/api/admin/push/test", { method: "POST" }); setMessage(ok ? "Test sent." : data.message || "Couldn't send a test."); };

  return (
    <div style={ui.row} data-testid="push-controls">
      {state === "on" ? (
        <>
          <span style={ui.small}>Call notifications are on for this device.</span>
          <button type="button" style={{ ...ui.btnQuiet, padding: "8px 14px" }} onClick={test}>Send a test</button>
          <button type="button" style={{ ...ui.btnQuiet, padding: "8px 14px" }} onClick={turnOff}>Turn off</button>
        </>
      ) : state === "blocked" ? (
        <span style={ui.small}>Notifications are blocked for this site. Allow them in the browser's settings to get call alerts.</span>
      ) : (
        <button type="button" style={{ ...ui.btnQuiet, padding: "8px 14px" }} onClick={turnOn}>Turn on call notifications on this device</button>
      )}
      {message && <span style={ui.small}>{message}</span>}
    </div>
  );
}
