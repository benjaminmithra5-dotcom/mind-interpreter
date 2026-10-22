import { test, expect, startCall, remoteAudioTracks } from "./helpers.js";

// Records which microphone track each page sends into the call, and every
// AudioContext it makes, so tests can check what really goes out.
const RECORD = `
  window.__sent = [];
  const add = RTCPeerConnection.prototype.addTrack;
  RTCPeerConnection.prototype.addTrack = function (track, ...rest) {
    window.__sent.push(track);
    return add.call(this, track, ...rest);
  };
  window.__contexts = [];
  const Real = window.AudioContext;
  window.AudioContext = class extends Real {
    constructor(...args) { super(...args); window.__contexts.push(this); }
  };
`;
const BLOCK_WORKLET = "delete window.AudioWorkletNode;";
const NOISE_OFF = "try { localStorage.setItem('talk-now-strong-noise-reduction', 'off'); } catch {}";
const sentAudio = (page) => page.evaluate(() => window.__sent.filter((t) => t.kind === "audio").map((t) => ({ label: t.label, enabled: t.enabled })));

async function rawMicLabel(page) {
  return page.evaluate(async () => {
    const s = await navigator.mediaDevices.getUserMedia({ audio: true });
    const label = s.getAudioTracks()[0].label;
    s.getTracks().forEach((t) => t.stop());
    return label;
  });
}

test("the switch: on by default, remembered on this device, and the meter follows it", async ({ open }) => {
  const page = await open("/call");
  const sw = page.getByTestId("noise-switch");
  await expect(sw).toHaveText("Strong noise reduction");
  await expect(sw).toHaveAttribute("aria-checked", "true");
  await expect(page.getByText("Use headphones or over-ear headphones.").first()).toBeVisible();

  await page.getByRole("button", { name: "Test microphone" }).click();
  await expect(page.getByTestId("mic-level")).toHaveAttribute("data-processed", "true");
  await expect(page.getByTestId("hear-yourself")).toBeVisible();

  await sw.click();
  await expect(sw).toHaveAttribute("aria-checked", "false");
  await expect(page.getByTestId("mic-level")).toHaveAttribute("data-processed", "false");
  // The raw microphone moves the meter.
  await page.waitForFunction(() => Number(document.querySelector('[role="meter"]').getAttribute("aria-valuenow")) > 0, null, { polling: "raf", timeout: 20_000 });
  expect(await page.evaluate(() => localStorage.getItem("talk-now-strong-noise-reduction"))).toBe("off");

  await page.reload();
  await expect(page.getByTestId("noise-switch")).toHaveAttribute("aria-checked", "false");
  await page.getByTestId("noise-switch").click();
  await expect(page.getByTestId("noise-switch")).toHaveAttribute("aria-checked", "true");
});

test("both sides send the noise-reduced track, and the call connects; mute and cleanup still work", async ({ open, gas }) => {
  const { host, guest } = await startCall(open, gas, "Asha", { initScript: { content: RECORD } });
  for (const page of [guest, host]) {
    const raw = await rawMicLabel(page);
    const sent = await sentAudio(page);
    expect(sent.length).toBeGreaterThan(0);
    for (const t of sent) expect(t.label).not.toBe(raw); // not the raw microphone
    await expect.poll(() => remoteAudioTracks(page)).toBeGreaterThan(0);
  }
  // Mute silences the track that is actually sent, on both sides.
  for (const page of [guest, host]) {
    await page.getByRole("button", { name: "Mute" }).click();
    expect((await sentAudio(page)).every((t) => !t.enabled)).toBe(true);
    await page.getByRole("button", { name: "Unmute" }).click();
    expect((await sentAudio(page)).every((t) => t.enabled)).toBe(true);
  }
  // Ending the call closes the 48 kHz AudioContext it used for noise
  // reduction. (The site's other audio library keeps its own context.)
  const callContexts = (page) => page.evaluate(() => window.__contexts.filter((c) => c.sampleRate === 48000).map((c) => c.state));
  expect(await callContexts(guest)).toContain("running");
  await guest.getByRole("button", { name: "End call" }).click();
  await expect(guest.getByTestId("join-message")).toBeVisible();
  await expect.poll(async () => (await callContexts(guest)).every((s) => s === "closed")).toBe(true);
  await expect.poll(async () => (await callContexts(host)).length).toBeGreaterThan(0);
});

test("if AudioWorklet isn't available, the raw microphone is used and the call still connects", async ({ open, gas }) => {
  const page = await open("/call", { initScript: { content: BLOCK_WORKLET } });
  await page.getByRole("button", { name: "Test microphone" }).click();
  await expect(page.getByTestId("mic-level")).toHaveAttribute("data-processed", "false");
  await expect(page.getByTestId("noise-unavailable")).toBeVisible();

  const { host, guest } = await startCall(open, gas, "Asha", { initScript: { content: RECORD + BLOCK_WORKLET } });
  const raw = await rawMicLabel(guest);
  const sent = await sentAudio(guest);
  for (const t of sent) expect(t.label).toBe(raw); // the raw microphone
  await expect.poll(() => remoteAudioTracks(host)).toBeGreaterThan(0);
});

test("with the switch off, the raw microphone is sent", async ({ open, gas }) => {
  const { guest } = await startCall(open, gas, "Asha", { initScript: { content: RECORD + NOISE_OFF } });
  const raw = await rawMicLabel(guest);
  const sent = await sentAudio(guest);
  for (const t of sent) expect(t.label).toBe(raw);
});

test("the noise code and WASM load only when the microphone starts on /call or /host, never on other pages", async ({ open }) => {
  const isNoise = (url) => /noiseWorklet|workletProcessor|rnnoise/.test(url);
  for (const path of ["/", "/articles", "/privacy"]) {
    const page = await open(path);
    const seen = [];
    page.on("request", (r) => { if (isNoise(r.url())) seen.push(r.url()); });
    await page.waitForLoadState("networkidle");
    expect(seen, path).toEqual([]);
    expect(await page.evaluate(() => performance.getEntriesByType("resource").some((e) => /noiseWorklet|workletProcessor|rnnoise/.test(e.name))), path).toBe(false);
  }
  const page = await open("/call");
  await page.waitForLoadState("networkidle");
  const before = await page.evaluate(() => performance.getEntriesByType("resource").filter((e) => /noiseWorklet|workletProcessor|rnnoise/.test(e.name)).length);
  expect(before).toBe(0);
  await page.getByRole("button", { name: "Test microphone" }).click();
  await expect(page.getByTestId("mic-level")).toHaveAttribute("data-processed", "true");
  const loaded = await page.evaluate(() => performance.getEntriesByType("resource").map((e) => e.name).filter((n) => /noiseWorklet|workletProcessor|rnnoise/.test(n)));
  expect(loaded.some((n) => n.endsWith(".wasm"))).toBe(true);
});
