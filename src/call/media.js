// Microphone, sounds and the clock for Talk now calls.

// Both sides ask the browser for its own echo cancellation, noise
// suppression and automatic gain.
export const AUDIO_CONSTRAINTS = { echoCancellation: true, noiseSuppression: true, autoGainControl: true };
export function getMic() {
  return navigator.mediaDevices.getUserMedia({ audio: AUDIO_CONSTRAINTS, video: false });
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
