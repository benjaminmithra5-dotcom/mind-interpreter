import { useEffect, useMemo, useRef, useState } from "react";
import { BOOKING_URL, JOIN_LATE_MINUTES, normalizeCode } from "./talkConfig.js";
import { checkCode } from "./bookingApi.js";
import { getMic, playChime } from "./media.js";
import { HostRoom } from "./room.js";
import { callStyles } from "./callStyles.js";
import { CallScreen } from "./CallScreen.jsx";
import { DeviceCheck } from "./DeviceCheck.jsx";
import { detectZone, formatDateTime } from "./timezones.js";

const ENDED = {
  time: "Call ended: the 45 minutes are up.",
  "guest-ended": "Your guest ended the call.",
  "host-ended": "Call ended.",
  lost: "Call ended: the connection was lost.",
  "could-not-connect": "The call couldn't connect. Your guest can try joining again.",
  closed: "Room closed.",
};

// Keeps the screen on while the room is open, where the browser supports
// it, so the phone or laptop doesn't sleep and drop the connection.
function useWakeLock(active) {
  useEffect(() => {
    if (!active || typeof navigator === "undefined" || !("wakeLock" in navigator)) return;
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

// One AudioContext for the ring, created on a click so browsers allow sound.
let soundCtx = null;
function unlockSound() {
  try { soundCtx = soundCtx || new AudioContext(); soundCtx.resume(); } catch { /* no audio */ }
}

// Benjamin's page: open the room for a booking code, admit the guest, talk.
export function HostPage({ c, font, headingStyle, Footer }) {
  const ui = useMemo(() => callStyles(c, font), [c, font]);
  const [code, setCode] = useState("");
  const [state, setState] = useState("idle"); // idle | checking | opening | open | in-call | time-up
  const [error, setError] = useState("");
  const [info, setInfo] = useState("");
  const [notice, setNotice] = useState("");
  const [guest, setGuest] = useState(null); // name of the guest waiting
  const [guestName, setGuestName] = useState("");
  const [tick, setTick] = useState(null);
  const [remote, setRemote] = useState(null);
  const [muted, setMuted] = useState(false);
  const room = useRef(null);
  const stream = useRef(null);

  const roomOpen = ["opening", "open", "in-call", "time-up"].includes(state);
  useWakeLock(roomOpen);
  useEffect(() => () => { room.current?.close(); stream.current?.getTracks().forEach((t) => t.stop()); }, []);

  // A short ring while a guest waits.
  useEffect(() => {
    if (!guest) return;
    const ring = () => soundCtx && soundCtx.state === "running" && playChime(soundCtx, { freqs: [784, 988, 784, 988], gap: 0.18, length: 0.3, volume: 0.25 });
    ring();
    const id = setInterval(ring, 3000);
    const stop = setTimeout(() => clearInterval(id), 15000); // a short ring, not an endless one
    return () => { clearInterval(id); clearTimeout(stop); };
  }, [guest]);

  async function openRoom(e) {
    e.preventDefault();
    unlockSound();
    setError(""); setNotice("");
    const roomCode = normalizeCode(code);
    if (roomCode.length !== 10) { setError("Please paste the 10-character booking code."); return; }
    setState("checking");
    let res;
    try { res = await checkCode(roomCode); } catch { setState("idle"); setError("Couldn't check the code. Please check your internet and try again."); return; }
    if (!res || !res.startsAt) { setState("idle"); setError("That code isn't valid (or the booking hasn't been approved)."); return; }
    if (Date.now() > Date.parse(res.startsAt) + JOIN_LATE_MINUTES * 60000) { setState("idle"); setError("This code has expired."); return; }
    try {
      stream.current = await getMic();
    } catch {
      setState("idle");
      setError("Your microphone isn't available. Please allow microphone access and try again.");
      return;
    }
    setInfo(`Booked for ${formatDateTime(new Date(res.startsAt), detectZone())} (your time).`);
    const r = new HostRoom({
      code: roomCode,
      stream: stream.current,
      on: {
        state: (s) => {
          if (room.current !== r) return;
          if (s === "closed") {
            room.current = null;
            stream.current?.getTracks().forEach((t) => t.stop());
            stream.current = null;
            setState("idle");
            setGuest(null);
            return;
          }
          setState(s);
        },
        waiting: (n) => { setGuest(n); if (n) setGuestName(n); },
        remote: setRemote,
        tick: setTick,
        ended: (reason) => { setTick(null); setMuted(false); setNotice(ENDED[reason] || "Call ended."); },
        notice: setNotice,
        error: setError,
      },
    });
    room.current = r;
    r.open();
  }

  const admit = () => { unlockSound(); room.current?.admit(); setNotice(""); };
  const decline = () => room.current?.decline();
  const closeRoom = () => room.current?.close();
  const hangup = () => room.current?.hangup();
  const toggleMute = () => {
    const next = !muted;
    setMuted(next);
    for (const t of stream.current?.getAudioTracks() || []) t.enabled = !next;
  };

  return (
    <div style={ui.wrap} className="fade-in" data-testid="host-page">
      <h1 style={headingStyle}>Talk now · Host</h1>
      {!BOOKING_URL && <p style={ui.small}>The booking service isn't set up yet (VITE_BOOKING_URL).</p>}

      {!roomOpen && (
        <form onSubmit={openRoom} noValidate style={ui.panelStrong} data-testid="host-form">
          <label style={ui.label}>Booking code
            <input style={{ ...ui.input, ...ui.codeInput }} value={code} onChange={(e) => setCode(e.target.value.toUpperCase())} maxLength={14}
              autoComplete="off" autoCapitalize="characters" spellCheck="false" placeholder="Paste from the email" data-testid="host-code" />
          </label>
          <DeviceCheck ui={ui} framed={false} />
          {error && <p style={ui.error} role="alert" data-testid="host-error">{error}</p>}
          {notice && <p style={ui.text} role="status">{notice}</p>}
          <button type="submit" style={ui.btnLarge} disabled={state === "checking" || !BOOKING_URL} data-testid="open-room">{state === "checking" ? "Checking…" : "Open room"}</button>
        </form>
      )}

      {roomOpen && (
        <div style={ui.panel} data-testid="room-status" data-state={state}>
          <p style={ui.panelTitle}>{state === "opening" ? "Opening the room…" : state === "time-up" ? "Time is up" : "Room open"}</p>
          {info && <p style={ui.small}>{info}</p>}
          <p style={ui.text}>Keep this page open while you wait.</p>
          {error && <p style={ui.error} role="alert" data-testid="host-error">{error}</p>}
          {notice && <p style={ui.banner} role="status" data-testid="host-notice">{notice}</p>}
          {state !== "in-call" && <div style={ui.row}><button type="button" style={ui.btnQuiet} onClick={closeRoom} data-testid="close-room">Close room</button></div>}
        </div>
      )}

      {guest && state !== "in-call" && (
        <div style={ui.panelStrong} role="alertdialog" aria-label="A guest is waiting" data-testid="guest-waiting">
          <p style={ui.panelTitle}>Waiting room</p>
          <p style={{ ...ui.text, overflowWrap: "anywhere" }} data-testid="guest-name"><strong>{guest}</strong> is waiting.</p>
          <div style={ui.row}>
            <button type="button" style={ui.btn} onClick={admit} data-testid="admit">Admit</button>
            <button type="button" style={ui.btnQuiet} onClick={decline} data-testid="decline">Decline</button>
          </div>
        </div>
      )}

      {state === "in-call" && (
        <CallScreen ui={ui} tick={tick} connecting={!tick} muted={muted} onMute={toggleMute} onEnd={hangup} remoteStream={remote} who={guestName || "your guest"} />
      )}

      <Footer />
    </div>
  );
}
