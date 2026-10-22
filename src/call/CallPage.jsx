import { useEffect, useMemo, useRef, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { BOOKING_URL, isPrerender, normalizeCode } from "./talkConfig.js";
import { checkCode, getStatus } from "./bookingApi.js";
import { getMic } from "./media.js";
import { GuestRoom } from "./room.js";
import { callStyles } from "./callStyles.js";
import { CallScreen } from "./CallScreen.jsx";
import { DeviceCheck } from "./DeviceCheck.jsx";
import { BookTime } from "./BookTime.jsx";
import { ImmediateTalk } from "./ImmediateTalk.jsx";
import { LeaveDialog, useLeaveGuard } from "./LeaveGuard.jsx";
import { detectZone, formatDateTime } from "./timezones.js";

const SAVED = "talk-now-room"; // this tab's call, so a reload can rejoin it

// Messages for the client. "{link}" becomes a link to the Consultation page.
const MESSAGE = {
  form: "Please enter your code and your name.",
  invalid: "That code isn't valid. Please check the code in the email I sent you.",
  "not-yet": "Your room opens 15 minutes before your call. Your call is on {when} (your time).",
  expired: "This code has expired. You're welcome to book another time below.",
  network: "We couldn't check your code just now. Please check your connection and try again.",
  mic: "We couldn't use your microphone. Please allow microphone access and try again.",
  busy: "Benjamin is in another call right now. Please try again in a few minutes.",
  declined: "Benjamin can't let you in right now. You're welcome to write to me on the {link}.",
  closed: "The room has closed. You're welcome to write to me on the {link}.",
  cancelled: "You left the waiting room.",
  time: "Our time is up. Thank you for talking.",
  "guest-ended": "The call has ended. Thank you for talking.",
  "host-ended": "The call has ended. Thank you for talking.",
  lost: "The connection was lost, so the call ended. While your code is still valid, you can join again.",
  "could-not-connect": "The call couldn't connect. Please try joining again.",
};
const IS_ERROR = new Set(["form", "invalid", "expired", "network", "mic", "busy", "declined", "closed", "lost", "could-not-connect"]);

function Message({ ui, msg, consultationPath }) {
  const template = (MESSAGE[msg.id] || MESSAGE.closed).replace("{when}", msg.when || "");
  const [before, after] = template.split("{link}");
  return (
    <p style={IS_ERROR.has(msg.id) ? ui.error : ui.text} role="status" data-testid="join-message" data-reason={msg.id}>
      {before}
      {after !== undefined && <><Link to={consultationPath} style={ui.link}>Consultation page</Link>{after}</>}
    </p>
  );
}

const readSaved = () => { try { return JSON.parse(sessionStorage.getItem(SAVED) || "null"); } catch { return null; } };
const writeSaved = (v) => { try { v ? sessionStorage.setItem(SAVED, JSON.stringify(v)) : sessionStorage.removeItem(SAVED); } catch { /* private mode */ } };

export function CallPage({ c, font, headingStyle, consultationPath, Footer }) {
  const ui = useMemo(() => callStyles(c, font), [c, font]);
  const [params] = useSearchParams();
  const [code, setCode] = useState(() => normalizeCode(params.get("room")));
  const [name, setName] = useState("");
  const [phase, setPhase] = useState("idle"); // idle | checking | connecting-room | not-open | waiting | connecting | in-call | reconnecting
  const [message, setMessage] = useState(null);
  const [tick, setTick] = useState(null);
  const [remote, setRemote] = useState(null);
  const [muted, setMuted] = useState(false);
  const [status, setStatus] = useState(null); // { immediate, paused } from the booking service
  const room = useRef(null);
  const stream = useRef(null);

  // Whether immediate calls are on, and whether booking is paused.
  useEffect(() => {
    if (!BOOKING_URL || isPrerender()) return;
    getStatus()
      .then((s) => setStatus({ immediate: s && s.immediate === true, paused: s && s.paused === true }))
      // Can't tell: show booking as usual (it has its own error messages).
      .catch(() => setStatus({ immediate: false, paused: false }));
  }, []);

  function stopMic() {
    stream.current?.getTracks().forEach((t) => t.stop());
    stream.current = null;
  }
  useEffect(() => () => { room.current?.finish("cancelled"); stopMic(); }, []);

  function startRoom({ code: roomCode, name: guestName, token = null }) {
    setMessage(null);
    setTick(null);
    setMuted(false);
    const r = new GuestRoom({
      code: roomCode,
      name: guestName,
      stream: stream.current,
      token,
      on: {
        state: (s) => { if (s !== "ended") setPhase(s); },
        remote: setRemote,
        tick: (t) => setTick((prev) => (t.local ? { ...prev, paused: true, grace: t.grace } : t)),
        token: (tk) => writeSaved({ code: roomCode, name: guestName, token: tk }),
        ended: (reason) => {
          if (room.current !== r) return;
          room.current = null;
          writeSaved(null);
          stopMic();
          setTick(null);
          setPhase("idle");
          setMessage({ id: reason });
        },
      },
    });
    room.current = r;
    r.join();
  }

  // After a reload during a call, go straight back in.
  useEffect(() => {
    const saved = readSaved();
    if (!saved || !saved.token || !BOOKING_URL || isPrerender()) return;
    setCode(saved.code);
    setName(saved.name);
    getMic()
      .then((s) => { stream.current = s; startRoom(saved); })
      .catch(() => { writeSaved(null); setMessage({ id: "mic" }); });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function join(e) {
    e.preventDefault();
    setMessage(null);
    const roomCode = normalizeCode(code);
    if (roomCode.length !== 10 || !name.trim()) { setMessage({ id: "form" }); return; }
    setPhase("checking");
    let res;
    try {
      res = await checkCode(roomCode);
    } catch {
      setPhase("idle");
      setMessage({ id: "network" });
      return;
    }
    if (!res || !res.startsAt) { setPhase("idle"); setMessage({ id: "invalid" }); return; }
    if (!res.valid) {
      setPhase("idle");
      const before = Date.now() < Date.parse(res.startsAt);
      setMessage(before ? { id: "not-yet", when: formatDateTime(new Date(res.startsAt), detectZone()) } : { id: "expired" });
      return;
    }
    try {
      stream.current = await getMic();
    } catch {
      setPhase("idle");
      setMessage({ id: "mic" });
      return;
    }
    startRoom({ code: roomCode, name: name.trim().slice(0, 60) });
  }

  const leave = () => room.current?.leave();
  const hangup = () => room.current?.hangup();
  const toggleMute = () => { const next = !muted; setMuted(next); room.current?.setMuted(next); };

  const inRoom = ["connecting-room", "not-open", "waiting"].includes(phase);
  const inCall = ["connecting", "in-call", "reconnecting"].includes(phase);
  // Back, the nav menu, refresh: ask first while waiting or in a call.
  const guard = useLeaveGuard({ active: inRoom || inCall, onLeave: () => (inCall ? hangup() : leave()) });
  const ready = Boolean(BOOKING_URL);
  return (
    <div style={ui.wrap} className="fade-in" data-testid="call-page">
      <h1 style={headingStyle}>Talk now</h1>

      {!ready && (
        <div style={ui.panel} data-testid="booking-soon">
          <p style={{ ...ui.text, textAlign: "center" }}>Booking opens soon.</p>
        </div>
      )}

      {ready && (
        <section style={ui.panelStrong} aria-labelledby="join-heading" data-testid="join">
          <h2 id="join-heading" style={ui.h2}>Join your call</h2>

          {inCall && (
            <CallScreen ui={ui} tick={tick} connecting={phase === "connecting"} muted={muted} onMute={toggleMute} onEnd={hangup} remoteStream={remote} who="Benjamin" />
          )}

          {inRoom && (
            <div style={{ display: "flex", flexDirection: "column", gap: 12 }} data-testid="room-wait" data-phase={phase}>
              {phase === "connecting-room" && <p style={ui.text}>Connecting…</p>}
              {phase === "not-open" && <p style={ui.text} role="status" data-testid="not-open">The room isn't open yet. Benjamin will open it shortly. Trying again…</p>}
              {phase === "waiting" && <p style={ui.text} role="status" data-testid="waiting">Waiting for Benjamin to let you in…</p>}
              <div style={ui.row}><button type="button" style={ui.btnQuiet} onClick={leave}>Leave</button></div>
            </div>
          )}

          {!inCall && !inRoom && (
            <form onSubmit={join} noValidate style={{ display: "flex", flexDirection: "column", gap: 14 }} data-testid="join-form">
              <p style={ui.small}>Enter the code from your email. The room opens 15 minutes before your call.</p>
              <label style={ui.label}>Your code
                <input style={{ ...ui.input, ...ui.codeInput }} value={code} onChange={(e) => setCode(e.target.value.toUpperCase())} maxLength={14}
                  autoComplete="off" autoCapitalize="characters" spellCheck="false" placeholder="10-character code" inputMode="text" data-testid="code-input" />
              </label>
              <label style={ui.label}>Your name
                <input style={ui.input} value={name} onChange={(e) => setName(e.target.value)} maxLength={60} autoComplete="given-name" data-testid="join-name" />
              </label>
              <DeviceCheck ui={ui} framed={false} />
              {message && <Message ui={ui} msg={message} consultationPath={consultationPath} />}
              <button type="submit" style={ui.btnLarge} disabled={phase === "checking"} data-testid="join-button">{phase === "checking" ? "Checking…" : "Join"}</button>
            </form>
          )}
        </section>
      )}

      {ready && !inCall && !inRoom && !status && (
        <p style={ui.small} data-testid="status-loading">Loading…</p>
      )}

      {ready && !inCall && !inRoom && status && status.paused && (
        <div style={ui.panel} data-testid="booking-paused">
          <p style={{ ...ui.text, textAlign: "center" }}>Booking is paused right now. Please check back soon.</p>
        </div>
      )}

      {ready && !inCall && !inRoom && status && !status.paused && (
        <section style={{ width: "100%", display: "flex", flexDirection: "column", gap: 14 }} aria-labelledby="now-heading" data-testid="immediate-section">
          <h2 id="now-heading" style={ui.h2}>Need to talk right now?</h2>
          {status.immediate ? (
            <>
              <p style={ui.price}>$9.80 for 45 minutes. Audio call. I will email you a code within a few minutes if I am free.</p>
              <p style={ui.small}>Check your spam folder, and add benjamin@benjaminmithra.com to your contacts so it reaches you.</p>
              <ImmediateTalk ui={ui} onStatus={(patch) => setStatus((s) => ({ ...s, ...patch }))} />
            </>
          ) : (
            <p style={ui.text} data-testid="immediate-off">I'm not taking immediate calls right now. You can book a time below.</p>
          )}
        </section>
      )}

      {ready && !inCall && !inRoom && status && !status.paused && (
        <section style={{ width: "100%", display: "flex", flexDirection: "column", gap: 14 }} aria-labelledby="book-heading" data-testid="book-section">
          <h2 id="book-heading" style={ui.h2}>Book a time</h2>
          <p style={ui.price}>$9.80 for 45 minutes. Audio call.</p>
          <p style={ui.text}>I will review your request and email you a code.</p>
          <BookTime ui={ui} c={c} />
        </section>
      )}

      <LeaveDialog ui={ui} c={c} open={guard.asking} onStay={guard.stay} onLeave={guard.leave}
        text={inCall ? "If you leave, the call ends." : "If you leave, you'll lose your place in the waiting room."} />

      <p style={ui.notice} data-testid="privacy-notice">Your call is private and goes directly between us. It is not recorded.</p>
      <p style={{ ...ui.notice, borderTop: "none", paddingTop: 0 }} data-testid="crisis-notice">This is not an emergency service. If you are in crisis, contact your local emergency services or a crisis line right away (for example, 988 in the US).</p>
      <Footer />
    </div>
  );
}
