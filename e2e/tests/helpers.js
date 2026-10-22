import { test as base, expect, request } from "@playwright/test";
import { GAS, SITE, TICK_MS, CALL_LIMIT } from "./env.js";

export { expect, GAS, SITE, TICK_MS, CALL_LIMIT };
export const ticks = (n) => n * TICK_MS;
export const ADMIN_KEY = "e2e-admin-key-not-a-real-secret-123";

// Each page gets its own browser context (its own storage), like two
// different people. Pages connect even though Playwright marks the browser
// as automated (the site skips connecting during the prerender build).
export const test = base.extend({
  gas: async ({}, use) => {
    const ctx = await request.newContext({ baseURL: GAS });
    await ctx.post("/__test/reset");
    await use({
      booking: async (opts = {}) => (await ctx.post("/__test/booking", { data: opts })).json(),
      mails: async () => (await ctx.get("/__test/mails")).json(),
      bookings: async () => (await ctx.get("/__test/bookings")).json(),
      events: async () => (await ctx.get("/__test/events")).json(),
      slots: async () => (await (await ctx.get("/exec?action=slots")).json()).slots,
      property: async (key, value) => ctx.post("/__test/property", { data: { key, value } }),
      admin: async (action, key, payload = {}) => (await (await ctx.post("/exec", { data: JSON.stringify({ ...payload, action, key }), headers: { "Content-Type": "text/plain" } })).json()),
      immediate: async (body) => (await (await ctx.post("/exec", { data: JSON.stringify({ action: "immediate", ...body }), headers: { "Content-Type": "text/plain" } })).json()),
      status: async () => (await (await ctx.get("/exec?action=status")).json()),
      book: async (body) => (await (await ctx.post("/exec", { data: JSON.stringify({ action: "book", ...body }), headers: { "Content-Type": "text/plain" } })).json()),
    });
    await ctx.dispose();
  },
  open: async ({ browser }, use) => {
    const contexts = [];
    await use(async (path, opts = {}) => {
      const context = await browser.newContext({ baseURL: SITE, ...opts });
      await context.addInitScript(() => Object.defineProperty(Navigator.prototype, "webdriver", { get: () => false }));
      contexts.push(context);
      const page = await context.newPage();
      await page.goto(path);
      return page;
    });
    for (const c of contexts) await c.close().catch(() => {});
  },
});

export async function openHost(open, code) {
  const host = await open("/host");
  await host.getByTestId("host-code").fill(code);
  await host.getByTestId("open-room").click();
  await expect(host.getByTestId("room-status")).toHaveAttribute("data-state", "open");
  return host;
}

export async function joinAsGuest(page, code, name = "Asha") {
  await page.getByTestId("code-input").fill(code);
  await page.getByTestId("join-name").fill(name);
  await page.getByTestId("join-button").click();
}

// Host opens the room, guest joins and is admitted, and the call connects.
export async function startCall(open, gas, name = "Asha") {
  const { code } = await gas.booking({ startsInMinutes: 5 });
  const host = await openHost(open, code);
  const guest = await open(`/call?room=${code}`);
  await joinAsGuest(guest, code, name);
  await expect(guest.getByTestId("waiting")).toHaveText("Waiting for Benjamin to let you in…");
  await expect(host.getByTestId("guest-name")).toHaveText(`${name} is waiting.`);
  await host.getByTestId("admit").click();
  await expect(guest.getByTestId("call-screen")).toHaveAttribute("data-call-state", "in-call");
  await expect(host.getByTestId("call-screen")).toHaveAttribute("data-call-state", "in-call");
  return { host, guest, code };
}

export async function clockSeconds(page) {
  const text = (await page.getByTestId("time-left").textContent()).trim();
  const [m, s] = text.split(":").map(Number);
  return m * 60 + s;
}

// The live audio tracks reaching a page's call screen.
export const remoteAudioTracks = (page) => page.evaluate(() => {
  const el = document.querySelector('[data-testid="call-screen"] audio');
  return el && el.srcObject ? el.srcObject.getAudioTracks().filter((t) => t.readyState === "live").length : 0;
});
