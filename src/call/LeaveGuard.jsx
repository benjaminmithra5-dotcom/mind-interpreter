import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useNavigate } from "react-router-dom";

// Keeps a call from ending by accident while it's waiting, ringing or live.
//
// - Back (the browser button, Android's Back button, iOS swipe-back): when
//   the guard starts it adds one extra history entry for the same page.
//   Back then only steps off that entry, so the page stays; the guard puts
//   the entry back and asks "Leave the call?".
// - Links and buttons inside the site (the nav menu, the header's ← button,
//   the footer): React Router changes pages through history.pushState. While
//   the guard is on, a change to another page is held and the same question
//   is asked.
// - Refresh or closing the tab: the browser's own "Leave site?" warning.
//
// Only "Leave" ends the call (onLeave) and then goes where the person meant
// to go. Nothing is logged.
const MARK = "talkNowGuard";

export function useLeaveGuard({ active, onLeave }) {
  const navigate = useNavigate();
  const [request, setRequest] = useState(null); // { kind: "back" } | { kind: "link", url }
  const onLeaveRef = useRef(onLeave);
  onLeaveRef.current = onLeave;
  const leaving = useRef(false);

  useEffect(() => {
    if (!active || typeof window === "undefined") return undefined;
    leaving.current = false;
    const h = window.history;
    const realPush = History.prototype.pushState.bind(h);
    const realReplace = History.prototype.replaceState.bind(h);
    const pushGuard = () => realPush({ ...(h.state || {}), [MARK]: true }, "", window.location.href);
    if (!(h.state && h.state[MARK])) pushGuard();

    const elsewhere = (url) => {
      if (url == null) return false;
      const u = new URL(String(url), window.location.href);
      return u.origin !== window.location.origin || u.pathname !== window.location.pathname || u.search !== window.location.search;
    };
    h.pushState = function pushState(state, title, url) {
      if (elsewhere(url)) { setRequest({ kind: "link", url: String(url) }); return undefined; }
      return realPush(state, title, url);
    };
    h.replaceState = function replaceState(state, title, url) {
      if (elsewhere(url)) { setRequest({ kind: "link", url: String(url) }); return undefined; }
      return realReplace(state, title, url);
    };
    const onPop = () => {
      if (leaving.current) return;
      pushGuard();
      setRequest((r) => r || { kind: "back" });
    };
    const onBeforeUnload = (e) => {
      if (leaving.current) return;
      e.preventDefault();
      e.returnValue = "";
    };
    window.addEventListener("popstate", onPop);
    window.addEventListener("beforeunload", onBeforeUnload);
    return () => {
      window.removeEventListener("popstate", onPop);
      window.removeEventListener("beforeunload", onBeforeUnload);
      delete h.pushState;
      delete h.replaceState;
      setRequest(null);
      // The call ended by itself: take the extra entry back out of history.
      if (!leaving.current && h.state && h.state[MARK]) h.back();
    };
  }, [active]);

  const stay = () => setRequest(null);

  const leave = () => {
    const req = request;
    leaving.current = true;
    setRequest(null);
    delete window.history.pushState;
    delete window.history.replaceState;
    onLeaveRef.current();
    if (req && req.kind === "link") {
      const u = new URL(req.url, window.location.href);
      navigate(u.pathname + u.search + u.hash, { replace: true });
      return;
    }
    // Back: step past the extra entry and this page, to wherever they came from.
    const here = window.location.pathname;
    let gone = false;
    window.addEventListener("pagehide", () => { gone = true; }, { once: true });
    window.history.go(-2);
    // Opened straight from a link with nothing to go back to: go home instead.
    setTimeout(() => { if (!gone && window.location.pathname === here) navigate("/", { replace: true }); }, 800);
  };

  return { asking: Boolean(request), stay, leave };
}

// "Leave the call?" with "Stay in the call" (focused) and "Leave".
export function LeaveDialog({ ui, c, open, text, onStay, onLeave }) {
  const stayRef = useRef(null);
  const leaveRef = useRef(null);
  useEffect(() => {
    if (open) stayRef.current?.focus();
  }, [open]);
  if (!open) return null;

  const onKeyDown = (e) => {
    if (e.key === "Escape") { e.preventDefault(); onStay(); }
    if (e.key === "Tab") {
      // Keep focus on the two buttons.
      e.preventDefault();
      (document.activeElement === stayRef.current ? leaveRef : stayRef).current?.focus();
    }
  };
  // Rendered at the end of <body>, so the backdrop covers the whole screen
  // (the page's fade-in animation would otherwise confine it).
  return createPortal(
    <div
      style={{ position: "fixed", inset: 0, zIndex: 1000, background: "rgba(30, 43, 44, 0.45)", display: "flex", alignItems: "center", justifyContent: "center", padding: 16 }}
      onKeyDown={onKeyDown}
      data-testid="leave-dialog-backdrop"
    >
      <div
        role="alertdialog"
        aria-modal="true"
        aria-labelledby="leave-title"
        aria-describedby="leave-text"
        style={{ ...ui.panelStrong, maxWidth: 420, boxShadow: `0 12px 40px ${c.shadow}` }}
        data-testid="leave-dialog"
      >
        <h2 id="leave-title" style={ui.h2}>Leave the call?</h2>
        <p id="leave-text" style={ui.text}>{text}</p>
        <div style={ui.row}>
          <button ref={stayRef} type="button" style={ui.btn} onClick={onStay} data-testid="stay-in-call">Stay in the call</button>
          <button ref={leaveRef} type="button" style={ui.btnQuiet} onClick={onLeave} data-testid="leave-call">Leave</button>
        </div>
      </div>
    </div>,
    document.body,
  );
}
