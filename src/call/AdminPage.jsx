import { useEffect, useMemo, useRef, useState } from "react";
import { api, canConnect, connectSocket, getMedia, CallConnection, formatClock, formatExpiry, MODE_LABEL, playChime, SERVER_URL } from "./callClient.js";
import { callStyles } from "./callStyles.js";
import { CallScreen } from "./CallScreen.jsx";
import { StatusBadge } from "./CallPage.jsx";
import { PushControls } from "./push.jsx";

const REASON = {
  time: "time used up", "visitor-ended": "caller ended", "benjamin-ended": "you ended", dropped: "connection lost",
  "could-not-connect": "couldn't connect", declined: "declined", "no-answer": "no answer", cancelled: "caller cancelled", moved: "moved to another device",
};
const when = (iso) => new Date(iso).toLocaleString("en-GB", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });

export function AdminPage({ c, font, headingStyle }) {
  const ui = useMemo(() => callStyles(c, font), [c, font]);
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

function Console({ ui, c, onOut }) {
  const [status, setStatus] = useState("checking");
  const [away, setAway] = useState(false);
  const [data, setData] = useState({ codes: [], requests: [], calls: [], vapidPublicKey: null });
  const [incoming, setIncoming] = useState(null);
  const [notice, setNotice] = useState("");
  const [phase, setPhase] = useState("idle"); // idle | connecting | in-call
  const [callInfo, setCallInfo] = useState(null);
  const [inProgress, setInProgress] = useState(null); // a call this page can rejoin
  const [timer, setTimer] = useState(null);
  const [muted, setMuted] = useState(false);
  const [cameraOn, setCameraOn] = useState(true);
  const [remoteStream, setRemoteStream] = useState(null);
  const [localStream, setLocalStream] = useState(null);
  const [soundBlocked, setSoundBlocked] = useState(false);
  const sock = useRef(null);
  const conn = useRef(null);
  const handlerRef = useRef(null);

  const refresh = async () => {
    const res = await api("/api/admin/overview").catch(() => null);
    if (!res) return;
    if (res.status === 401) return onOut();
    setData(res.data);
    setAway(res.data.away);
  };

  useEffect(() => {
    refresh();
    const s = connectSocket({ admin: true, onMessage: (m) => handlerRef.current(m), onClose: (e) => e.code === 4401 && onOut() });
    sock.current = s;
    const poll = setInterval(refresh, 30000);
    return () => { clearInterval(poll); s.close(); cleanup(); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // The ring: a soft two-note chime every 2.5 seconds while a call waits.
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
    setLocalStream(null);
  }
  async function prepareConnection(info) {
    const stream = await getMedia({ video: info.mode === "audio+video" });
    setLocalStream(stream);
    conn.current = new CallConnection({
      iceServers: info.iceServers || [],
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
        setNotice(m.reason === "taken" ? "Answered on another device." : m.reason === "no-answer" ? "Missed call: no answer within 45 seconds." : m.reason === "cancelled" ? "The caller hung up." : "");
        break;
      case "accepted":
        if (conn.current) conn.current.iceServers = m.iceServers || [];
        setIncoming(null);
        setCallInfo(m);
        setPhase("connecting");
        break;
      case "call-in-progress": setInProgress(m.callId); break;
      case "rejoined":
        setInProgress(null);
        setCallInfo(m);
        setPhase("connecting");
        if (!conn.current) await prepareConnection(m);
        break;
      case "signal":
        if (!conn.current && callInfo) await prepareConnection(callInfo);
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
        setCallInfo(null);
        setNotice(`Call ended (${REASON[m.reason] || m.reason}). ${formatClock(m.secondsRemaining)} left on the code.`);
        refresh();
        break;
      case "calls-changed": case "requests-changed": refresh(); break;
    }
  };

  async function accept() {
    unlockSound();
    const info = incoming;
    try {
      await prepareConnection({ mode: info.mode, iceServers: [] });
    } catch {
      setNotice("Your microphone isn't available, so the call wasn't answered.");
      return;
    }
    sock.current.send({ type: "accept", callId: info.callId });
  }
  const decline = () => { sock.current.send({ type: "decline", callId: incoming.callId }); setIncoming(null); };
  const setAwayMode = (value) => { unlockSound(); sock.current.send({ type: "set-away", away: value }); };
  const logout = async () => { await api("/api/admin/logout", { method: "POST" }); onOut(); };
  const toggleMute = () => { const next = !muted; setMuted(next); conn.current?.setMuted(next); };
  const toggleCamera = () => { const next = !cameraOn; setCameraOn(next); conn.current?.setCamera(next); };

  const inCall = phase !== "idle";
  return (
    <>
      <div style={ui.panel} data-testid="status-control">
        <div style={{ ...ui.row, justifyContent: "space-between" }}>
          <StatusBadge ui={ui} c={c} status={status} />
          <button type="button" style={{ ...ui.btnQuiet, padding: "8px 14px" }} onClick={logout}>Sign out</button>
        </div>
        <div style={ui.row}>
          <button type="button" style={away ? ui.btnQuiet : ui.btn} aria-pressed={!away} onClick={() => setAwayMode(false)} data-testid="set-available">Available</button>
          <button type="button" style={away ? ui.btn : ui.btnQuiet} aria-pressed={away} onClick={() => setAwayMode(true)} data-testid="set-away">Away</button>
        </div>
        <p style={ui.small}>Visitors see "Away" whenever this page is closed on all your devices.</p>
        {soundBlocked && <button type="button" style={ui.btnQuiet} onClick={unlockSound}>Turn on the ring sound</button>}
        <PushControls ui={ui} vapidPublicKey={data.vapidPublicKey} />
      </div>

      {notice && <p style={ui.banner} role="status" data-testid="admin-notice">{notice}</p>}

      {incoming && !inCall && (
        <div style={{ ...ui.panel, borderColor: c.accent, borderWidth: 2 }} data-testid="incoming" role="alertdialog" aria-label="Incoming call">
          <p style={ui.panelTitle}>Incoming call</p>
          <p style={ui.text}>{incoming.note ? incoming.note : "No note on this code"} · <span style={ui.mono}>{incoming.code}</span></p>
          <p style={ui.small}>{formatClock(incoming.secondsRemaining)} left · {MODE_LABEL[incoming.mode]}</p>
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
          remoteStream={remoteStream} localStream={localStream} video={callInfo?.mode === "audio+video"} cameraOn={cameraOn} onCamera={toggleCamera} who={callInfo?.note || "a caller"} />
      )}

      <NewCode ui={ui} onCreated={refresh} />
      <Codes ui={ui} codes={data.codes} onChange={refresh} />
      <Requests ui={ui} requests={data.requests} onChange={refresh} />
      <RecentCalls ui={ui} calls={data.calls} />
    </>
  );
}

function NewCode({ ui, onCreated }) {
  const [form, setForm] = useState({ minutes: 45, mode: "audio", expiresOn: "", note: "" });
  const [created, setCreated] = useState(null);
  const [error, setError] = useState("");
  async function submit(e) {
    e.preventDefault();
    setError("");
    const { ok, data } = await api("/api/admin/codes", { method: "POST", body: { ...form, minutes: Number(form.minutes), expiresOn: form.expiresOn || null } });
    if (!ok) return setError(data.message || "Couldn't create the code.");
    setCreated(data);
    setForm({ ...form, note: "" });
    onCreated();
  }
  return (
    <form style={ui.panel} onSubmit={submit} data-testid="new-code">
      <p style={ui.panelTitle}>Create a code</p>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(140px, 1fr))", gap: 12 }}>
        <label style={ui.label}>Minutes<input style={ui.input} type="number" min={1} max={600} value={form.minutes} onChange={(e) => setForm({ ...form, minutes: e.target.value })} required /></label>
        <label style={ui.label}>Mode
          <select style={ui.input} value={form.mode} onChange={(e) => setForm({ ...form, mode: e.target.value })}>
            <option value="audio">Audio only</option>
            <option value="audio+video">Audio and video</option>
          </select>
        </label>
        <label style={ui.label}>Expiry (optional)<input style={ui.input} type="date" value={form.expiresOn} onChange={(e) => setForm({ ...form, expiresOn: e.target.value })} /></label>
      </div>
      <label style={ui.label}>Note, just for you<input style={ui.input} value={form.note} onChange={(e) => setForm({ ...form, note: e.target.value })} maxLength={200} placeholder="Who it's for" /></label>
      <div style={ui.row}><button type="submit" style={ui.btn}>Create code</button></div>
      {error && <p style={ui.error} role="alert">{error}</p>}
      {created && (
        <p style={ui.success} data-testid="created-code">New code: <span style={ui.mono}>{created.code}</span> · {formatClock(created.secondsRemaining)} · {MODE_LABEL[created.mode]}</p>
      )}
    </form>
  );
}

function Codes({ ui, codes, onChange }) {
  return (
    <div style={ui.panel} data-testid="codes">
      <p style={ui.panelTitle}>Codes</p>
      {codes.length === 0 && <p style={ui.small}>No codes yet.</p>}
      {codes.map((k) => <CodeRow key={k.id} ui={ui} k={k} onChange={onChange} />)}
    </div>
  );
}
function CodeRow({ ui, k, onChange }) {
  const [add, setAdd] = useState(45);
  const state = k.disabled ? "Disabled" : k.expired ? "Expired" : k.secondsRemaining <= 0 ? "Used up" : "Active";
  const addMinutes = async () => { await api(`/api/admin/codes/${k.id}/minutes`, { method: "POST", body: { minutes: Number(add) } }); onChange(); };
  const toggle = async () => { await api(`/api/admin/codes/${k.id}/disabled`, { method: "POST", body: { disabled: !k.disabled } }); onChange(); };
  return (
    <div style={ui.listItem} data-testid="code-row" data-code={k.code}>
      <span style={ui.mono}>{k.code}</span>
      <span style={ui.text}>{k.note || "No note"}</span>
      <span style={ui.small}>{formatClock(k.secondsRemaining)} left · {MODE_LABEL[k.mode]} · {formatExpiry(k.expiresAt)} · {state}</span>
      <div style={ui.row}>
        <input style={{ ...ui.input, width: 90 }} type="number" min={1} max={600} value={add} onChange={(e) => setAdd(e.target.value)} aria-label={`Minutes to add to ${k.code}`} />
        <button type="button" style={{ ...ui.btnQuiet, padding: "9px 14px" }} onClick={addMinutes}>Add minutes</button>
        <button type="button" style={{ ...ui.btnQuiet, padding: "9px 14px" }} onClick={toggle}>{k.disabled ? "Enable" : "Disable"}</button>
      </div>
    </div>
  );
}

function Requests({ ui, requests, onChange }) {
  const mark = async (r) => { await api(`/api/admin/requests/${r.id}/done`, { method: "POST", body: { done: !r.done } }); onChange(); };
  return (
    <div style={ui.panel} data-testid="requests">
      <p style={ui.panelTitle}>Requested times</p>
      {requests.length === 0 && <p style={ui.small}>No requests yet.</p>}
      {requests.map((r) => (
        <div key={r.id} style={{ ...ui.listItem, opacity: r.done ? 0.6 : 1 }}>
          <span style={ui.text}>{r.name || "No name"} · <span style={ui.mono}>{r.code}</span>{r.note ? ` (${r.note})` : ""}</span>
          <span style={ui.small}>Prefers {r.preferredTime.replace("T", " ")} ({r.timezone}) · asked {when(r.createdAt)}</span>
          <div style={ui.row}><button type="button" style={{ ...ui.btnQuiet, padding: "8px 14px" }} onClick={() => mark(r)}>{r.done ? "Mark as open" : "Mark as done"}</button></div>
        </div>
      ))}
    </div>
  );
}

function RecentCalls({ ui, calls }) {
  return (
    <div style={ui.panel} data-testid="recent-calls">
      <p style={ui.panelTitle}>Recent calls</p>
      {calls.length === 0 && <p style={ui.small}>No calls yet.</p>}
      {calls.slice(0, 30).map((k) => (
        <div key={k.id} style={ui.listItem}>
          <span style={ui.text}>{when(k.startedAt)} · {k.note || <span style={ui.mono}>{k.code}</span>}</span>
          <span style={ui.small}>{formatClock(k.secondsUsed)} used · {REASON[k.endReason] || k.endReason}</span>
        </div>
      ))}
    </div>
  );
}
