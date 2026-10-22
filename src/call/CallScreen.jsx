import { useEffect, useRef } from "react";
import { formatClock } from "./media.js";

// The in-call view, shared by the client's /call page and the host's /host.
// tick: { remaining, warning, paused, grace } from the host's timer.
export function CallScreen({ ui, tick, connecting, muted, onMute, onEnd, remoteStream, who }) {
  const remoteRef = useRef(null);
  useEffect(() => {
    if (remoteRef.current && remoteRef.current.srcObject !== remoteStream) {
      remoteRef.current.srcObject = remoteStream || null;
      if (remoteStream) remoteRef.current.play?.().catch(() => {});
    }
  }, [remoteStream]);

  const t = tick || {};
  const hasTime = typeof t.remaining === "number";
  return (
    <div style={ui.panelStrong} data-testid="call-screen" data-call-state={connecting ? "connecting" : t.paused ? "reconnecting" : "in-call"}>
      <p style={ui.panelTitle}>{connecting ? "Connecting…" : `In a call with ${who}`}</p>
      <audio ref={remoteRef} autoPlay />
      <p style={ui.clock} data-testid="time-left" aria-live="off">{hasTime ? formatClock(t.remaining) : "–:––"}</p>
      <p style={{ ...ui.small, textAlign: "center" }}>left in this call</p>
      {t.paused && (
        <p style={ui.banner} role="status" data-testid="reconnecting-banner">Reconnecting… The timer is paused{typeof t.grace === "number" ? ` (${t.grace}s)` : ""}.</p>
      )}
      {!t.paused && t.warning && (
        <p style={ui.banner} role="status" data-testid="warning-banner">About 2 minutes left.</p>
      )}
      <div style={{ ...ui.row, justifyContent: "center" }}>
        <button type="button" style={ui.btnQuiet} onClick={onMute} aria-pressed={muted}>{muted ? "Unmute" : "Mute"}</button>
        <button type="button" style={ui.btnDanger} onClick={onEnd}>End call</button>
      </div>
    </div>
  );
}
