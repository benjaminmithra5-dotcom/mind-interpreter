// Microphone, sounds and the clock for Talk now calls.

// Both sides ask the browser for its own echo cancellation, noise
// suppression and automatic gain.
export const AUDIO_CONSTRAINTS = { echoCancellation: true, noiseSuppression: true, autoGainControl: true };
export function getMic() {
  return navigator.mediaDevices.getUserMedia({ audio: AUDIO_CONSTRAINTS, video: false });
}

// ---- Strong noise reduction --------------------------------------------
// On top of the browser's own noise suppression, each person's microphone
// can run through RNNoise before it's sent: mic, AudioContext at 48 kHz,
// RNNoise worklet, MediaStreamDestination, and that track goes to the call.
// If anything about it isn't supported or fails, the raw microphone is used,
// so the call always works.

const NOISE_KEY = "talk-now-strong-noise-reduction";
/** The "Strong noise reduction" switch: on unless turned off on this device. */
export function noiseReductionOn() {
  try { return localStorage.getItem(NOISE_KEY) !== "off"; } catch { return true; }
}
export function setNoiseReduction(on) {
  try { localStorage.setItem(NOISE_KEY, on ? "on" : "off"); } catch { /* private mode */ }
}

const supported = () =>
  typeof window !== "undefined" && typeof window.AudioContext === "function" && typeof window.AudioWorkletNode === "function" &&
  typeof WebAssembly === "object" && Boolean(window.AudioContext.prototype && "audioWorklet" in window.AudioContext.prototype);

/**
 * Runs a microphone stream through RNNoise when `on`. Returns
 * { stream, processed, node, ctx, stop() }: `stream` is what to send or
 * measure, `processed` says whether RNNoise is in the path, and stop()
 * releases the microphone and closes the AudioContext.
 */
export async function withNoiseReduction(raw, on = noiseReductionOn()) {
  const plain = { stream: raw, processed: false, node: null, ctx: null, stop: () => raw.getTracks().forEach((t) => t.stop()) };
  if (!on || !supported()) return plain;
  let ctx = null;
  try {
    ctx = new AudioContext({ sampleRate: 48000 });
    const { createRnnoiseNode } = await import("./noiseWorklet.js");
    const node = await createRnnoiseNode(ctx);
    const source = ctx.createMediaStreamSource(raw);
    const dest = ctx.createMediaStreamDestination();
    source.connect(node).connect(dest);
    // A context that can't start (no tap yet, for example after a reload)
    // would send silence: use the raw microphone instead.
    await Promise.race([ctx.resume(), new Promise((r) => setTimeout(r, 1000))]);
    if (ctx.state !== "running") throw new Error("audio context not running");
    const stream = dest.stream;
    return {
      stream,
      processed: true,
      node,
      ctx,
      stop: () => {
        stream.getTracks().forEach((t) => t.stop());
        raw.getTracks().forEach((t) => t.stop());
        try { node.destroy(); } catch { /* already gone */ }
        ctx.close().catch(() => {});
      },
    };
  } catch {
    if (ctx) ctx.close().catch(() => {});
    return plain;
  }
}

/** The microphone for a call, with strong noise reduction if switched on. */
export async function getCallMic() {
  return withNoiseReduction(await getMic());
}

export const formatClock = (seconds) => {
  const s = Math.max(0, Math.floor(seconds || 0));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
};

// Short sounds made in the browser (no audio files): a speaker test chime
// and the host's ring.
export function playChime(ctx, { freqs = [660, 880], gap = 0.22, length = 0.35, volume = 0.18 } = {}) {
  const t0 = ctx.currentTime + 0.02;
  freqs.forEach((f, i) => {
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = "sine";
    osc.frequency.value = f;
    gain.gain.setValueAtTime(0, t0 + i * gap);
    gain.gain.linearRampToValueAtTime(volume, t0 + i * gap + 0.03);
    gain.gain.exponentialRampToValueAtTime(0.001, t0 + i * gap + length);
    osc.connect(gain).connect(ctx.destination);
    osc.start(t0 + i * gap);
    osc.stop(t0 + i * gap + length + 0.05);
  });
}
