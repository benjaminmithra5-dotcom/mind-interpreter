import { useEffect, useMemo, useRef, useState } from "react";
import { api, canConnect, connectSocket, getMedia, CallConnection, playChime, SERVER_URL } from "./callClient.js";
import { callStyles } from "./callStyles.js";
import { CallScreen } from "./CallScreen.jsx";
import { StatusBadge } from "./CallPage.jsx";
import { useAdminApp } from "./pwa.jsx";

const ENDED = {
  time: "Call ended: time is up.", "visitor-ended": "The caller ended the call.", "benjamin-ended": "Call ended.",
  dropped: "Call ended: the connection was lost.", "could-not-connect": "The call couldn't connect.", moved: "The call moved to another device.",
};
const RING_CANCEL = { taken: "Answered on another device.", "no-answer": "Missed call: no answer within 45 seconds.", cancelled: "The caller hung up." };

export function AdminPage({ c, font, headingStyle }) {
  const ui = useMemo(() => callStyles(c, font), [c, font]);
  useAdminApp();
  const [session, setSession] = useState(canConnect() ? "checking" : "offline"); // checking | out | in | offline
  useEffect(() => {
    if (!canConnect()) return;
    api("/api/admin/session").then(({ data }) => setSession(data.loggedIn ? "in" : "out")).catch(() => setSession("out"));
  }, []);

  return (
    <div style={ui.wrap} className="fade-in" data-testid="admin-page">
      <h1 style={headingStyle}>Talk now · Admin</h1>
      {session === "offline" && <p style={ui.small}>{SERVER_URL ? "Loading…" : "The call server address isn't set yet (VITE_CALL_SERVER_URL)."}</p>}
      {session === "checking" && <p style={ui.small}>Loading…</p>}
      {session === "out" && <Login ui={ui} onIn={() => setSession("in")} />}
      {session === "in" && <Console ui={ui} c={c} onOut={() => setSession("out")} />}
    </div>
  );
}

function Login({ ui, onIn }) {
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  async function submit(e) {
    e.preventDefault();
    setBusy(true); setError("");
    unlockSound(); // the click lets the ring sound play later
    const { ok, data } = await api("/api/admin/login", { method: "POST", body: { password } }).catch(() => ({ ok: false, data: {} }));
    setBusy(false);
    if (ok) onIn(); else setError(data.message || "We couldn't sign you in. Please try again.");
  }
  return (
    <form style={ui.panel} onSubmit={submit} data-testid="login-form">
      <p style={ui.panelTitle}>Sign in</p>
      <label style={ui.label}>Password<input style={ui.input} type="password" value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="current-password" required /></label>
      <div style={ui.row}><button type="submit" style={ui.btn} disabled={busy}>{busy ? "Signing in…" : "Sign in"}</button></div>
      {error && <p style={ui.error} role="alert" data-testid="login-error">{error}</p>}
    </form>
  );
}

// One AudioContext for the ring, created on a click so browsers allow sound.
let soundCtx = null;
function unlockSound() {
  try { soundCtx = soundCtx || new AudioContext(); soundCtx.resume(); } catch { /* no audio */ }
}

// Keeps the screen on while Benjamin is Available, where the browser
// supports it, so the phone doesn't sleep and drop the connection.
function useWakeLock(active) {
  useEffect(() => {
    if (!active || !("wakeLock" in navigator)) return;
    let lock = null;
    let stopped = false;
    const request = async () => {
      if (stopped || document.visibilityState !== "visible") return;
      try { lock = await navigator.wakeLock.request("screen"); } catch { /* not allowed right now */ }
    };
    const onVisible = () => { if (!lock || lock.released) request(); };
    request();
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      stopped = true;
      document.removeEventListener("visibilitychange", onVisible);
      lock?.release().catch(() => {});
    };
  }, [active]);
}

function Console({ ui, c, onOut }) {
  const [status, setStatus] = useState("checking");
  const [away, setAway] = useState(true);
  const [connected, setConnected] = useState(false);
  const [incoming, setIncoming] = useState(null);
  const [notice, setNotice] = useState("");
  const [phase, setPhase] = useState("idle"); // idle | connecting | in-call
  const [caller, setCaller] = useState(null);
  const [inProgress, setInProgress] = useState(null); // a call this page can rejoin
  const [timer, setTimer] = useState(null);
  const [muted, setMuted] = useState(false);
  const [remoteStream, setRemoteStream] = useState(null);
  const [soundBlocked, setSoundBlocked] = useState(false);
  const sock = useRef(null);
  const conn = useRef(null);
  const handlerRef = useRef(null);

  useWakeLock(!away);

  useEffect(() => {
    // Reconnect quickly: while this page is disconnected, visitors see Away.
    const s = connectSocket({
      admin: true,
      maxDelay: 5000,
      onMessage: (m) => handlerRef.current(m),
      onOpen: () => setConnected(true),
      onClose: (e) => { setConnected(false); if (e.code === 4401) onOut(); },
    });
    sock.current = s;
    return () => { s.close(); cleanup(); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // The ring: a two-note chime every 2.5 seconds while a call waits.
  useEffect(() => {
    if (!incoming) return;
    const ring = () => {
      if (!soundCtx || soundCtx.state !== "running") { setSoundBlocked(true); return; }
      setSoundBlocked(false);
      playChime(soundCtx, { freqs: [784, 988, 784, 988], gap: 0.18, length: 0.3, volume: 0.25 });
    };
    ring();
    const id = setInterval(ring, 2500);
    return () => clearInterval(id);
  }, [incoming]);

  function cleanup() {
    conn.current?.close();
    conn.current = null;
    setRemoteStream(null);
  }
  async function prepareConnection(iceServers = []) {
    const stream = await getMedia();
    conn.current = new CallConnection({
      iceServers,
      localStream: stream,
      send: (d) => sock.current.send({ type: "signal", data: d }),
      onRemoteStream: setRemoteStream,
      onState: (state) => sock.current.send({ type: "media", state: state === "connected" ? "connected" : "disconnected" }),
    });
  }

  handlerRef.current = async (m) => {
    switch (m.type) {
      case "status": setStatus(m.status); break;
      case "away": setAway(m.away); break;
      case "incoming": setNotice(""); setIncoming(m); break;
      case "ring-cancel":
        setIncoming((cur) => (cur && cur.callId === m.callId ? null : cur));
        setNotice(RING_CANCEL[m.reason] || "");
        break;
      case "accepted":
        if (conn.current) conn.current.iceServers = m.iceServers || [];
        setIncoming(null);
        setCaller(m);
        setPhase("connecting");
        break;
      case "call-in-progress": setInProgress(m.callId); break;
      case "rejoined":
        setInProgress(null);
        setCaller(m);
        setPhase("connecting");
        if (!conn.current) await prepareConnection(m.iceServers);
        break;
      case "signal":
        await conn.current?.handle(m.data);
        break;
      case "timer":
        setTimer(m);
        setPhase((p) => (p === "connecting" ? "in-call" : p));
        break;
      case "ended":
        cleanup();
        setPhase("idle");
        setTimer(null);
        setCaller(null);
        setMuted(false);
        setNotice(ENDED[m.reason] || "Call ended.");
        break;
    }
  };

  async function accept() {
    unlockSound();
    const info = incoming;
    try {
      await prepareConnection();
    } catch {
      setNotice("Your microphone isn't available, so the call wasn't answered.");
      return;
    }
    sock.current.send({ type: "accept", callId: info.callId });
  }
  const decline = () => { sock.current.send({ type: "decline", callId: incoming.callId }); setIncoming(null); setNotice(""); };
  const setAwayMode = (value) => { unlockSound(); sock.current.send({ type: "set-away", away: value }); };
  const logout = async () => { await api("/api/admin/logout", { method: "POST" }); onOut(); };
  const toggleMute = () => { const next = !muted; setMuted(next); conn.current?.setMuted(next); };

  const inCall = phase !== "idle";
  return (
    <>
      <div style={ui.panel} data-testid="status-control">
        <div style={{ ...ui.row, justifyContent: "space-between" }}>
          <StatusBadge ui={ui} c={c} status={connected ? status : "away"} />
          <button type="button" style={{ ...ui.btnQuiet, padding: "8px 14px" }} onClick={logout}>Sign out</button>
        </div>
        <div style={ui.row}>
          <button type="button" style={away ? ui.btnQuiet : ui.btn} aria-pressed={!away} onClick={() => setAwayMode(false)} data-testid="set-available">Available</button>
          <button type="button" style={away ? ui.btn : ui.btnQuiet} aria-pressed={away} onClick={() => setAwayMode(true)} data-testid="set-away">Away</button>
        </div>
        <p style={ui.small}>Keep this page open to receive calls.</p>
        {!connected && <p style={ui.error} data-testid="admin-offline">Reconnecting… Visitors see "Away" until this page is back online.</p>}
        {soundBlocked && <button type="button" style={ui.btnQuiet} onClick={unlockSound}>Turn on the ring sound</button>}
      </div>

      {notice && <p style={ui.banner} role="status" data-testid="admin-notice">{notice}</p>}

      {incoming && !inCall && (
        <div style={{ ...ui.panel, borderColor: c.accent, borderWidth: 2 }} data-testid="incoming" role="alertdialog" aria-label="Incoming call">
          <p style={ui.panelTitle}>Incoming call</p>
          <p style={{ ...ui.text, overflowWrap: "anywhere" }} data-testid="caller-name">{incoming.name}</p>
          <p style={{ ...ui.small, overflowWrap: "anywhere" }} data-testid="caller-email">{incoming.email}</p>
          <div style={ui.row}>
            <button type="button" style={ui.btn} onClick={accept} data-testid="accept">Accept</button>
            <button type="button" style={ui.btnQuiet} onClick={decline} data-testid="decline">Decline</button>
          </div>
        </div>
      )}

      {inProgress && !inCall && (
        <div style={ui.panel}>
          <p style={ui.text}>A call is still going on.</p>
          <div style={ui.row}><button type="button" style={ui.btn} onClick={() => { unlockSound(); sock.current.send({ type: "rejoin-admin", callId: inProgress }); }}>Rejoin the call</button></div>
        </div>
      )}

      {inCall && (
        <CallScreen ui={ui} timer={timer} connecting={phase === "connecting"} muted={muted} onMute={toggleMute} onEnd={() => sock.current.send({ type: "hangup" })}
          remoteStream={remoteStream} who={caller?.name || "a caller"} />
      )}
    </>
  );
}
