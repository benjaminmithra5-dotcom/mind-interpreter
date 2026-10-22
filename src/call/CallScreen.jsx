import { useEffect, useRef } from "react";
import { formatClock } from "./callClient.js";

// The in-call view, shared by the visitor's /call page and Benjamin's /admin.
export function CallScreen({ ui, timer, connecting, muted, onMute, onEnd, remoteStream, who }) {
  const remoteRef = useRef(null);
  useEffect(() => {
    if (remoteRef.current && remoteStream && remoteRef.current.srcObject !== remoteStream) {
      remoteRef.current.srcObject = remoteStream;
      remoteRef.current.play?.().catch(() => {});
    }
  }, [remoteStream]);

  const t = timer || {};
  return (
    <div style={ui.panel} data-testid="call-screen" data-call-state={connecting ? "connecting" : "in-call"}>
      <p style={ui.panelTitle}>{connecting ? "Connecting…" : `In a call with ${who}`}</p>
      <audio ref={remoteRef} autoPlay />
      <p style={ui.clock} data-testid="time-left" aria-live="off">{timer ? formatClock(t.secondsRemaining) : "–:––"}</p>
      <p style={{ ...ui.small, textAlign: "center" }}>left in this call</p>
      {t.paused && (
        <p style={ui.banner} role="status" data-testid="paused-banner">The connection dropped. The timer is paused while we wait to reconnect ({t.graceLeft}s).</p>
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
