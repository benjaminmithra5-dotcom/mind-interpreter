import { useEffect, useMemo, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { canConnect, connectSocket, getMedia, CallConnection, STATUS_LABEL, playChime, AUDIO_CONSTRAINTS, SERVER_URL } from "./callClient.js";
import { callStyles, STATUS_COLOR } from "./callStyles.js";
import { CallScreen } from "./CallScreen.jsx";

const ACTIVE_KEY = "talk-now-call"; // the current call, so a reload can rejoin it
const EMAIL = /^[^\s@<>]+@[^\s@<>]+\.[^\s@<>]{2,}$/;

// Messages for the visitor. "{link}" becomes a link to the Consultation page.
const MESSAGE = {
  away: "I'm away right now. Write to me on the {link}.",
  busy: "Busy right now. Please try again in a few minutes, or write to me on the {link}.",
  declined: "Not available right now. You can write to me on the {link}.",
  "no-answer": "Sorry, I couldn't answer just now. You can write to me on the {link}.",
  cancelled: "Call cancelled.",
  "visitor-ended": "The call has ended. Thank you for talking.",
  "benjamin-ended": "The call has ended. Thank you for talking.",
  time: "Our time is up. Thank you for talking.",
  dropped: "The connection was lost, so the call ended.",
  "could-not-connect": "The call couldn't connect. Please try again.",
  "rate-limited": "Too many calls from here in a short time. Please wait a few minutes and try again.",
  invalid: "Please enter your name and a valid email.",
  mic: "We couldn't use your microphone. Please allow microphone access and try again.",
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

function Message({ ui, id, consultationPath, style, testId = "call-message" }) {
  const [before, after = ""] = (MESSAGE[id] || MESSAGE.declined).split("{link}");
  return (
    <p style={style || ui.text} data-testid={testId} data-reason={id} role="status">
      {before}
      {MESSAGE[id]?.includes("{link}") && <Link to={consultationPath} style={ui.link}>Consultation page</Link>}
      {after}
    </p>
  );
}

export function CallPage({ c, font, headingStyle, consultationPath, Footer }) {
  const ui = useMemo(() => callStyles(c, font), [c, font]);
  const [status, setStatus] = useState("checking");
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [formError, setFormError] = useState("");
  const [phase, setPhase] = useState("idle"); // idle | ringing | connecting | in-call
  const [message, setMessage] = useState(null); // a MESSAGE id after a call or a refusal
  const [timer, setTimer] = useState(null);
  const [muted, setMuted] = useState(false);
  const [remoteStream, setRemoteStream] = useState(null);
  const sock = useRef(null);
  const conn = useRef(null);
  const media = useRef(null);
  const callRef = useRef(null); // { callId, token, iceServers }
  const phaseRef = useRef(phase);
  phaseRef.current = phase;
  const handlerRef = useRef(null);

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
    callRef.current = null;
  }
  function cleanup() {
    conn.current?.close();
    conn.current = null;
    media.current?.getTracks().forEach((t) => t.stop());
    media.current = null;
    setRemoteStream(null);
  }
  async function ensureConnection() {
    if (conn.current) return conn.current;
    const stream = media.current || (await getMedia());
    media.current = stream;
    conn.current = new CallConnection({
      iceServers: callRef.current?.iceServers || [],
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
        setMessage(m.reason);
        break;
      case "accepted":
        remember({ iceServers: m.iceServers });
        setPhase("connecting");
        await (await ensureConnection()).offer();
        break;
      case "rejoined":
        remember({ iceServers: m.iceServers });
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
        setTimer(null);
        setMuted(false);
        setMessage(m.reason === "away" ? "declined" : m.reason);
        setPhase("idle");
        break;
    }
  }
  handlerRef.current = handle;

  async function call(e) {
    e.preventDefault();
    setFormError(""); setMessage(null);
    if (!name.trim() || !EMAIL.test(email.trim())) { setFormError(MESSAGE.invalid); return; }
    try {
      media.current = await getMedia();
    } catch {
      setMessage("mic");
      return;
    }
    sock.current.send({ type: "call", name: name.trim(), email: email.trim() });
  }
  const hangup = () => sock.current.send({ type: "hangup" });
  const toggleMute = () => { const next = !muted; setMuted(next); conn.current?.setMuted(next); };

  const inCall = phase === "connecting" || phase === "in-call";
  const available = status === "available";
  return (
    <div style={ui.wrap} className="fade-in" data-testid="call-page">
      <h1 style={headingStyle}>Talk now</h1>
      <StatusBadge ui={ui} c={c} status={status} />
      <p style={ui.price}>$9.80 for 45 minutes. Audio call.</p>
      <p style={{ ...ui.small, textAlign: "center" }}>
        I accept calls from people who have booked with me. To book, write to me on the <Link to={consultationPath} style={ui.link}>Consultation page</Link>.
      </p>

      {inCall && (
        <CallScreen ui={ui} timer={timer} connecting={phase === "connecting"} muted={muted} onMute={toggleMute} onEnd={hangup} remoteStream={remoteStream} who="Benjamin" />
      )}

      {phase === "ringing" && (
        <div style={ui.panel} data-testid="ringing">
          <p style={ui.panelTitle}>Calling Benjamin…</p>
          <p style={ui.small}>Please wait a moment.</p>
          <div style={ui.row}><button type="button" style={ui.btnQuiet} onClick={hangup}>Cancel</button></div>
        </div>
      )}

      {phase === "idle" && (
        <>
          <form style={ui.panel} onSubmit={call} data-testid="call-form" noValidate>
            <p style={ui.panelTitle}>Call Benjamin</p>
            <label style={ui.label}>Your name
              <input style={ui.input} value={name} onChange={(e) => setName(e.target.value)} maxLength={80} autoComplete="name" required />
            </label>
            <label style={ui.label}>Your email
              <input style={ui.input} type="email" value={email} onChange={(e) => setEmail(e.target.value)} maxLength={200} autoComplete="email" required />
            </label>
            {formError && <p style={ui.error} role="alert" data-testid="form-error">{formError}</p>}
            {message && <Message ui={ui} id={message} consultationPath={consultationPath} />}
            {!message && status === "away" && <Message ui={ui} id="away" consultationPath={consultationPath} testId="status-message" />}
            {!message && status === "on_call" && <Message ui={ui} id="busy" consultationPath={consultationPath} testId="status-message" />}
            <div style={ui.row}>
              <button type="submit" style={{ ...ui.btn, ...(available ? null : { opacity: 0.5, cursor: "not-allowed" }) }} disabled={!available} data-testid="call-button">Call</button>
            </div>
          </form>
          <DeviceCheck ui={ui} />
        </>
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
      <p style={ui.small}>Use headphones or over-ear headphones.</p>
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
