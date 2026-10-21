import { useEffect, useMemo, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { api, canConnect, connectSocket, getMedia, CallConnection, formatClock, formatExpiry, STATUS_LABEL, MODE_LABEL, playChime, AUDIO_CONSTRAINTS, SERVER_URL } from "./callClient.js";
import { callStyles, STATUS_COLOR } from "./callStyles.js";
import { CallScreen } from "./CallScreen.jsx";

const ACTIVE_KEY = "talk-now-call"; // the current call, so a reload can rejoin it

const ENDED_TEXT = {
  declined: "Benjamin can't take the call just now. Your minutes are still on your code.",
  "no-answer": "Benjamin couldn't answer just now. Your minutes are still on your code.",
  cancelled: "Call cancelled. Your minutes are still on your code.",
  time: "Your time is up. Thank you for talking.",
  "visitor-ended": "The call has ended.",
  "benjamin-ended": "The call has ended.",
  dropped: "The connection was lost, so the call ended. Your remaining minutes are still on your code.",
  "could-not-connect": "The call couldn't connect. Your minutes are still on your code. Please try again.",
  gone: "This call has already ended.",
};

export function StatusBadge({ ui, c, status }) {
  return (
    <span style={ui.badge} data-testid="status-badge" data-status={status} aria-live="polite">
      <span style={{ ...ui.dot, background: STATUS_COLOR(c)[status] }} aria-hidden="true" />
      {STATUS_LABEL[status]}
    </span>
  );
}

export function CallPage({ c, font, headingStyle, consultationPath, Footer }) {
  const ui = useMemo(() => callStyles(c, font), [c, font]);
  const [status, setStatus] = useState("checking");
  const [codeInput, setCodeInput] = useState("");
  const [code, setCode] = useState(null); // validated code info
  const [codeError, setCodeError] = useState("");
  const [checking, setChecking] = useState(false);
  const [phase, setPhase] = useState("idle"); // idle | ringing | connecting | in-call | ended
  const [callError, setCallError] = useState("");
  const [timer, setTimer] = useState(null);
  const [ended, setEnded] = useState(null);
  const [muted, setMuted] = useState(false);
  const [cameraOn, setCameraOn] = useState(true);
  const [wantVideo, setWantVideo] = useState(true);
  const [remoteStream, setRemoteStream] = useState(null);
  const [localStream, setLocalStream] = useState(null);
  const sock = useRef(null);
  const conn = useRef(null);
  const media = useRef(null);
  const callRef = useRef(null); // { callId, token, mode, iceServers }
  const phaseRef = useRef(phase);
  phaseRef.current = phase;
  const handlerRef = useRef(null);

  const video = Boolean(callRef.current && callRef.current.mode === "audio+video" && callRef.current.video);

  // Live status and call messages.
  useEffect(() => {
    if (!canConnect()) { setStatus("away"); return; }
    const s = connectSocket({
      onOpen: () => {
        let saved = null;
        try { saved = JSON.parse(sessionStorage.getItem(ACTIVE_KEY) || "null"); } catch { /* ignore */ }
        if (saved) { callRef.current = saved; s.send({ type: "rejoin", callId: saved.callId, token: saved.token }); }
      },
      onMessage: (m) => handlerRef.current(m),
    });
    sock.current = s;
    return () => { s.close(); cleanup(); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function remember(info) {
    callRef.current = { ...callRef.current, ...info };
    try { sessionStorage.setItem(ACTIVE_KEY, JSON.stringify(callRef.current)); } catch { /* ignore */ }
  }
  function forget() {
    try { sessionStorage.removeItem(ACTIVE_KEY); } catch { /* ignore */ }
  }
  function cleanup() {
    conn.current?.close();
    conn.current = null;
    media.current = null;
    setRemoteStream(null);
    setLocalStream(null);
  }
  async function ensureConnection() {
    if (conn.current) return conn.current;
    const info = callRef.current;
    const stream = media.current || (await getMedia({ video: info.mode === "audio+video" && info.video }));
    media.current = stream;
    setLocalStream(stream);
    conn.current = new CallConnection({
      iceServers: info.iceServers || [],
      localStream: stream,
      send: (data) => sock.current.send({ type: "signal", data }),
      onRemoteStream: setRemoteStream,
      onState: (state) => sock.current.send({ type: "media", state: state === "connected" ? "connected" : "disconnected" }),
    });
    return conn.current;
  }

  async function handle(m) {
    switch (m.type) {
      case "status": setStatus(m.status); break;
      case "ringing":
        remember({ callId: m.callId, token: m.token });
        setPhase("ringing");
        break;
      case "call-error":
        cleanup();
        setPhase("idle");
        setCallError(m.message);
        break;
      case "accepted":
        remember({ iceServers: m.iceServers, mode: m.mode });
        setPhase("connecting");
        await (await ensureConnection()).offer();
        break;
      case "rejoined":
        remember({ iceServers: m.iceServers, mode: m.mode });
        setPhase(m.phase === "ringing" ? "ringing" : "connecting");
        break;
      case "renegotiate":
        await (await ensureConnection()).offer();
        break;
      case "signal":
        await conn.current?.handle(m.data);
        break;
      case "timer":
        setTimer(m);
        if (phaseRef.current === "connecting") setPhase("in-call");
        break;
      case "ended":
        forget();
        cleanup();
        callRef.current = null;
        setTimer(null);
        setEnded({ reason: m.reason, secondsRemaining: m.secondsRemaining });
        setPhase("ended");
        if (code) setCode({ ...code, secondsRemaining: m.secondsRemaining });
        break;
    }
  }

  handlerRef.current = handle;

  async function checkCode(e) {
    e?.preventDefault();
    setCodeError(""); setCode(null); setChecking(true);
    try {
      const { data } = await api("/api/codes/check", { method: "POST", body: { code: codeInput } });
      if (data.valid) setCode(data); else setCodeError(data.message || "That code isn't recognised.");
    } catch {
      setCodeError("We couldn't check the code. Please try again in a moment.");
    }
    setChecking(false);
  }

  async function call() {
    setCallError(""); setEnded(null);
    const withVideo = code.mode === "audio+video" && wantVideo;
    try {
      media.current = await getMedia({ video: withVideo });
      setLocalStream(media.current);
    } catch {
      setCallError("We couldn't use your microphone. Please allow microphone access and try again.");
      return;
    }
    callRef.current = { mode: code.mode, video: withVideo };
    sock.current.send({ type: "call", code: code.code });
  }
  const hangup = () => sock.current.send({ type: "hangup" });
  const toggleMute = () => { const next = !muted; setMuted(next); conn.current?.setMuted(next); };
  const toggleCamera = () => { const next = !cameraOn; setCameraOn(next); conn.current?.setCamera(next); };

  const inCall = phase === "connecting" || phase === "in-call";
  return (
    <div style={ui.wrap} className="fade-in" data-testid="call-page">
      <h1 style={headingStyle}>Talk now</h1>
      <StatusBadge ui={ui} c={c} status={status} />
      <p style={ui.price}>$9.80 for 45 minutes. Audio call; video only on prior request.</p>
      <p style={{ ...ui.small, textAlign: "center" }}>Need a code? <Link to={consultationPath} style={ui.link}>Ask on the Consultation page</Link>.</p>

      {!inCall && phase !== "ringing" && (
        <form style={ui.panel} onSubmit={checkCode} data-testid="code-form">
          <p style={ui.panelTitle}>Your minute code</p>
          <label style={ui.label}>
            Code
            <input style={{ ...ui.input, ...ui.codeInput }} value={codeInput} onChange={(e) => setCodeInput(e.target.value)} autoComplete="off" autoCapitalize="characters" spellCheck="false" placeholder="ABCDE-FGHJK" maxLength={14} name="code" />
          </label>
          <div style={ui.row}>
            <button type="submit" style={ui.btnQuiet} disabled={checking || !codeInput.trim()}>{checking ? "Checking…" : "Check code"}</button>
          </div>
          {codeError && <p style={ui.error} role="alert" data-testid="code-error">{codeError}</p>}
          {code && (
            <p style={ui.text} data-testid="code-info">
              <strong>{formatClock(code.secondsRemaining)}</strong> left · {MODE_LABEL[code.mode]} · {formatExpiry(code.expiresAt)}
            </p>
          )}
        </form>
      )}

      {!inCall && phase !== "ringing" && <DeviceCheck ui={ui} />}

      {phase === "ended" && ended && (
        <div style={ui.panel} data-testid="call-ended" data-reason={ended.reason}>
          <p style={ui.text}>{ENDED_TEXT[ended.reason] || "The call has ended."}</p>
          <p style={ui.small}>Time left on your code: {formatClock(ended.secondsRemaining)}</p>
        </div>
      )}

      {phase === "ringing" && (
        <div style={ui.panel} data-testid="ringing">
          <p style={ui.panelTitle}>Calling Benjamin…</p>
          <p style={ui.small}>If he can't answer within 45 seconds, your minutes stay on your code.</p>
          <div style={ui.row}><button type="button" style={ui.btnQuiet} onClick={hangup}>Cancel</button></div>
        </div>
      )}

      {inCall && (
        <CallScreen ui={ui} timer={timer} connecting={phase === "connecting"} muted={muted} onMute={toggleMute} onEnd={hangup}
          remoteStream={remoteStream} localStream={localStream} video={video} cameraOn={cameraOn} onCamera={toggleCamera} who="Benjamin" />
      )}

      {(phase === "idle" || phase === "ended") && (
        status === "available" ? (
          <div style={ui.panel} data-testid="call-panel">
            {code ? (
              <>
                {code.mode === "audio+video" && (
                  <label style={{ ...ui.small, display: "flex", gap: 8, alignItems: "center" }}>
                    <input type="checkbox" checked={wantVideo} onChange={(e) => setWantVideo(e.target.checked)} /> Turn on my camera for this call
                  </label>
                )}
                <button type="button" style={ui.btn} onClick={call} data-testid="call-button">Call Benjamin</button>
              </>
            ) : (
              <p style={ui.small}>Enter your code above to call.</p>
            )}
            {callError && <p style={ui.error} role="alert">{callError}</p>}
          </div>
        ) : (
          <RequestTime ui={ui} codeInput={codeInput} status={status} />
        )
      )}

      <p style={ui.notice} data-testid="crisis-notice">This is not an emergency service. If you are in crisis, contact your local emergency services or a crisis line right away (for example, 988 in the US).</p>
      {!SERVER_URL && <span hidden data-testid="no-server" />}
      <Footer />
    </div>
  );
}

// Microphone level meter and a speaker test sound, before calling.
function DeviceCheck({ ui }) {
  const [level, setLevel] = useState(0);
  const [micOn, setMicOn] = useState(false);
  const [error, setError] = useState("");
  const stop = useRef(() => {});
  useEffect(() => () => stop.current(), []);

  async function testMic() {
    if (micOn) { stop.current(); return; }
    setError("");
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: AUDIO_CONSTRAINTS });
      const ctx = new AudioContext();
      const analyser = ctx.createAnalyser();
      analyser.fftSize = 512;
      ctx.createMediaStreamSource(stream).connect(analyser);
      const data = new Uint8Array(analyser.fftSize);
      let raf = 0;
      const loop = () => {
        analyser.getByteTimeDomainData(data);
        let peak = 0;
        for (const v of data) peak = Math.max(peak, Math.abs(v - 128));
        setLevel(Math.min(1, peak / 64));
        raf = requestAnimationFrame(loop);
      };
      loop();
      setMicOn(true);
      stop.current = () => { cancelAnimationFrame(raf); stream.getTracks().forEach((t) => t.stop()); ctx.close(); setMicOn(false); setLevel(0); stop.current = () => {}; };
    } catch {
      setError("We couldn't use your microphone. Please allow microphone access in your browser.");
    }
  }
  function testSpeaker() {
    const ctx = new AudioContext();
    playChime(ctx);
    setTimeout(() => ctx.close(), 1200);
  }

  return (
    <div style={ui.panel} data-testid="device-check">
      <p style={ui.panelTitle}>Check your sound</p>
      <p style={ui.small}>Please wear earphones or over-ear headphones, so there's no echo.</p>
      <div style={ui.meterTrack} aria-label="Microphone level" role="meter" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(level * 100)}>
        <div style={{ ...ui.meterFill, width: `${Math.round(level * 100)}%` }} data-testid="mic-level" />
      </div>
      <div style={ui.row}>
        <button type="button" style={ui.btnQuiet} onClick={testMic}>{micOn ? "Stop microphone test" : "Test microphone"}</button>
        <button type="button" style={ui.btnQuiet} onClick={testSpeaker}>Play test sound</button>
      </div>
      {error && <p style={ui.error} role="alert">{error}</p>}
    </div>
  );
}

// When Benjamin is away or on a call: ask for a time instead.
function RequestTime({ ui, codeInput, status }) {
  const tz = useMemo(() => { try { return Intl.DateTimeFormat().resolvedOptions().timeZone || ""; } catch { return ""; } }, []);
  const [form, setForm] = useState({ name: "", code: codeInput, preferredTime: "", timezone: tz });
  const [state, setState] = useState({ sending: false, done: false, error: "" });
  useEffect(() => { setForm((f) => (f.code ? f : { ...f, code: codeInput })); }, [codeInput]);
  const set = (k) => (e) => setForm({ ...form, [k]: e.target.value });

  async function submit(e) {
    e.preventDefault();
    setState({ sending: true, done: false, error: "" });
    try {
      const { data } = await api("/api/requests", { method: "POST", body: form });
      setState(data.ok ? { sending: false, done: true, error: "" } : { sending: false, done: false, error: data.message || "Please check the form and try again." });
    } catch {
      setState({ sending: false, done: false, error: "We couldn't send that just now. Please try again in a moment." });
    }
  }

  if (state.done) {
    return (
      <div style={ui.panel} data-testid="request-done">
        <p style={ui.text}>Thank you. Benjamin will see your request and get back to you.</p>
      </div>
    );
  }
  return (
    <form style={ui.panel} onSubmit={submit} data-testid="request-form">
      <p style={ui.panelTitle}>Request a time</p>
      <p style={ui.small}>{status === "on_call" ? "Benjamin is on a call right now." : status === "checking" ? "Checking whether Benjamin is available…" : "Benjamin is away right now."} Tell him when suits you.</p>
      <label style={ui.label}>Name (optional)<input style={ui.input} value={form.name} onChange={set("name")} maxLength={80} autoComplete="given-name" /></label>
      <label style={ui.label}>Code<input style={{ ...ui.input, ...ui.codeInput }} value={form.code} onChange={set("code")} required maxLength={14} autoCapitalize="characters" spellCheck="false" /></label>
      <label style={ui.label}>Preferred day and time<input style={ui.input} type="datetime-local" value={form.preferredTime} onChange={set("preferredTime")} required /></label>
      <label style={ui.label}>Your timezone<input style={ui.input} value={form.timezone} onChange={set("timezone")} required maxLength={64} /></label>
      <div style={ui.row}><button type="submit" style={ui.btn} disabled={state.sending}>{state.sending ? "Sending…" : "Request a time"}</button></div>
      {state.error && <p style={ui.error} role="alert">{state.error}</p>}
    </form>
  );
}
