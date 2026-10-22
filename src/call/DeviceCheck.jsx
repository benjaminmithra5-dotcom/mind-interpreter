import { useEffect, useRef, useState } from "react";
import { AUDIO_CONSTRAINTS, noiseReductionOn, playChime, setNoiseReduction, withNoiseReduction } from "./media.js";

// Microphone level meter and a speaker test sound, before a call, with the
// "Strong noise reduction" switch. The meter (and "Hear yourself", for
// headphones) use the microphone after noise reduction, as it will be sent.
export function DeviceCheck({ ui, c, framed = true }) {
  const [level, setLevel] = useState(0);
  const [micOn, setMicOn] = useState(false);
  const [strong, setStrong] = useState(noiseReductionOn);
  const [processing, setProcessing] = useState(null); // true/false while testing
  const [listen, setListen] = useState(false);
  const [error, setError] = useState("");
  const stop = useRef(() => {});
  const monitor = useRef(null); // { source, ctx } for "Hear yourself"
  useEffect(() => () => stop.current(), []);

  async function startMic(useStrong) {
    setError("");
    try {
      const raw = await navigator.mediaDevices.getUserMedia({ audio: AUDIO_CONSTRAINTS });
      const mic = await withNoiseReduction(raw, useStrong);
      const ctx = new AudioContext();
      const analyser = ctx.createAnalyser();
      analyser.fftSize = 512;
      const source = ctx.createMediaStreamSource(mic.stream);
      source.connect(analyser);
      monitor.current = { source, ctx };
      if (listen) source.connect(ctx.destination);
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
      setProcessing(mic.processed);
      stop.current = () => {
        cancelAnimationFrame(raf);
        mic.stop();
        ctx.close();
        monitor.current = null;
        setMicOn(false);
        setLevel(0);
        setProcessing(null);
        stop.current = () => {};
      };
    } catch {
      setError("We couldn't use your microphone. Please allow microphone access in your browser.");
    }
  }
  function testMic() {
    if (micOn) { stop.current(); return; }
    startMic(strong);
  }
  function toggleStrong() {
    const next = !strong;
    setStrong(next);
    setNoiseReduction(next);
    if (micOn) { stop.current(); startMic(next); }
  }
  function toggleListen() {
    const next = !listen;
    setListen(next);
    const m = monitor.current;
    if (!m) return;
    try { next ? m.source.connect(m.ctx.destination) : m.source.disconnect(m.ctx.destination); } catch { /* not connected */ }
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
      <button type="button" role="switch" aria-checked={strong} onClick={toggleStrong} data-testid="noise-switch"
        style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, width: "100%", boxSizing: "border-box", padding: "10px 12px",
          background: "transparent", border: `1px solid ${strong ? c.accent : c.line}`, borderRadius: 10, cursor: "pointer", textAlign: "left" }}>
        <span style={{ ...ui.text, fontSize: 15 }}>Strong noise reduction</span>
        <span aria-hidden="true" style={{ flexShrink: 0, width: 46, height: 26, borderRadius: 13, position: "relative", background: strong ? c.accent : c.panelHover, border: `1px solid ${strong ? c.accent : c.strongLine}`, boxSizing: "border-box" }}>
          <span style={{ position: "absolute", top: 3, left: strong ? 23 : 3, width: 18, height: 18, borderRadius: "50%", background: strong ? c.onAccent : c.faint, transition: "left 150ms" }} />
        </span>
      </button>
      {strong && processing === false && (
        <p style={ui.small} data-testid="noise-unavailable">Strong noise reduction isn't available in this browser. Your browser's own noise suppression is still on.</p>
      )}
      <div style={ui.meterTrack} aria-label="Microphone level" role="meter" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(level * 100)}>
        <div style={{ ...ui.meterFill, width: `${Math.round(level * 100)}%` }} data-testid="mic-level" data-processed={processing === null ? "" : String(processing)} />
      </div>
      <div style={ui.row}>
        <button type="button" style={ui.btnQuiet} onClick={testMic}>{micOn ? "Stop microphone test" : "Test microphone"}</button>
        <button type="button" style={ui.btnQuiet} onClick={testSpeaker}>Play test sound</button>
        {micOn && (
          <button type="button" style={ui.btnQuiet} onClick={toggleListen} aria-pressed={listen} data-testid="hear-yourself">{listen ? "Stop hearing yourself" : "Hear yourself"}</button>
        )}
      </div>
      {error && <p style={ui.error} role="alert">{error}</p>}
    </>
  );
  return framed ? <div style={ui.panel} data-testid="device-check">{body}</div> : <div style={{ display: "flex", flexDirection: "column", gap: 12 }} data-testid="device-check">{body}</div>;
}
