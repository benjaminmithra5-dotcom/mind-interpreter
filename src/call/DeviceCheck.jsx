import { useEffect, useRef, useState } from "react";
import { AUDIO_CONSTRAINTS, playChime } from "./media.js";

// Microphone level meter and a speaker test sound, before a call.
export function DeviceCheck({ ui, framed = true }) {
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

  const body = (
    <>
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
    </>
  );
  return framed ? <div style={ui.panel} data-testid="device-check">{body}</div> : <div style={{ display: "flex", flexDirection: "column", gap: 12 }} data-testid="device-check">{body}</div>;
}
