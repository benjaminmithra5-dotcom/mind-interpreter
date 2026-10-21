import { useEffect, useRef } from "react";
import { formatClock } from "./callClient.js";

// The in-call view, shared by the visitor's /call page and Benjamin's /admin.
export function CallScreen({ ui, timer, connecting, muted, onMute, onEnd, remoteStream, localStream, video, cameraOn, onCamera, who }) {
  const remoteRef = useRef(null);
  const localRef = useRef(null);
  useEffect(() => {
    if (remoteRef.current && remoteStream && remoteRef.current.srcObject !== remoteStream) {
      remoteRef.current.srcObject = remoteStream;
      remoteRef.current.play?.().catch(() => {});
    }
  }, [remoteStream]);
  useEffect(() => {
    if (localRef.current && localStream && localRef.current.srcObject !== localStream) localRef.current.srcObject = localStream;
  }, [localStream]);

  const t = timer || {};
  return (
    <div style={ui.panel} data-testid="call-screen" data-call-state={connecting ? "connecting" : "in-call"}>
      <p style={ui.panelTitle}>{connecting ? "Connecting…" : `In a call with ${who}`}</p>
      {video ? (
        <>
          <video ref={remoteRef} style={ui.video} autoPlay playsInline />
          <video ref={localRef} style={ui.videoSelf} autoPlay playsInline muted />
        </>
      ) : (
        <audio ref={remoteRef} autoPlay />
      )}
      <p style={ui.clock} data-testid="time-left" aria-live="off">{t.phase === "wrapup" ? `0:00` : formatClock(t.secondsRemaining)}</p>
      <p style={{ ...ui.small, textAlign: "center" }}>{t.phase === "wrapup" ? "Time is up" : "left on the code"}</p>
      {t.paused && (
        <p style={ui.banner} role="status" data-testid="paused-banner">The connection dropped. The timer is paused while we wait to reconnect ({t.graceLeft}s).</p>
      )}
      {!t.paused && t.warning && (
        <p style={ui.banner} role="status" data-testid="warning-banner">About 2 minutes left.</p>
      )}
      {!t.paused && t.phase === "wrapup" && (
        <p style={ui.banner} role="status" data-testid="wrapup-banner">Wrapping up. The call will end in {t.wrapupLeft}s.</p>
      )}
      <div style={{ ...ui.row, justifyContent: "center" }}>
        <button type="button" style={ui.btnQuiet} onClick={onMute} aria-pressed={muted}>{muted ? "Unmute" : "Mute"}</button>
        {video && <button type="button" style={ui.btnQuiet} onClick={onCamera} aria-pressed={!cameraOn}>{cameraOn ? "Camera off" : "Camera on"}</button>}
        <button type="button" style={ui.btnDanger} onClick={onEnd}>End call</button>
      </div>
    </div>
  );
}
