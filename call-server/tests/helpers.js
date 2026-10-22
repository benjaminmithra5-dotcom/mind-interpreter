import { test as base, expect, request } from "@playwright/test";
import { SERVER, SITE, ADMIN_PASSWORD, TICK_MS } from "./env.js";

export { expect, SERVER, SITE, ADMIN_PASSWORD, TICK_MS };

// Wall-clock milliseconds for a number of call "seconds".
export const ticks = (n) => n * TICK_MS;

// Every page gets its own browser context (its own cookies and storage),
// like two different people. The pages connect to the call server even
// though Playwright marks the browser as automated.
export const test = base.extend({
  open: async ({ browser }, use) => {
    const contexts = [];
    await use(async (path) => {
      const context = await browser.newContext({ baseURL: SITE });
      await context.addInitScript(() => Object.defineProperty(Navigator.prototype, "webdriver", { get: () => false }));
      contexts.push(context);
      const page = await context.newPage();
      await page.goto(path);
      return page;
    });
    for (const c of contexts) await c.close().catch(() => {});
    // Let any call from this test finish before the next test starts.
    const ctx = await request.newContext({ baseURL: SERVER });
    await expect.poll(async () => (await (await ctx.get("/api/status")).json()).status, { timeout: 30_000 }).not.toBe("on_call");
    await ctx.dispose();
  },
  api: async ({}, use) => {
    const ctx = await adminApi();
    await use(ctx);
    await ctx.dispose();
  },
});

// A signed-in admin, straight to the server's API (for making codes).
export async function adminApi(ip) {
  const ctx = await request.newContext({ baseURL: SERVER, extraHTTPHeaders: { Origin: SITE, ...(ip ? { "X-Forwarded-For": ip } : {}) } });
  const res = await ctx.post("/api/admin/login", { data: { password: ADMIN_PASSWORD } });
  expect(res.ok()).toBeTruthy();
  return ctx;
}

export async function createCode(api, body = {}) {
  const res = await api.post("/api/admin/codes", { data: body });
  expect(res.ok()).toBeTruthy();
  return res.json();
}

export async function codeState(api, code) {
  const res = await api.get("/api/admin/overview");
  const data = await res.json();
  return data.codes.find((k) => k.code === code);
}

// The admin page, signed in and set to Available.
export async function openAdmin(open) {
  const page = await open("/admin");
  await page.getByLabel("Password").fill(ADMIN_PASSWORD);
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page.getByTestId("status-control")).toBeVisible();
  await page.getByTestId("set-available").click();
  await expect(page.getByTestId("status-control").getByTestId("status-badge")).toHaveAttribute("data-status", "available");
  return page;
}

export async function enterCode(page, code) {
  await page.getByLabel("Code", { exact: true }).first().fill(code);
  await page.getByRole("button", { name: "Check code" }).click();
}

// Visitor calls, admin accepts, and both sides see the timer running.
export async function startCall(visitor, admin, code) {
  await enterCode(visitor, code);
  await expect(visitor.getByTestId("code-info")).toBeVisible();
  await visitor.getByTestId("call-button").click();
  await expect(admin.getByTestId("incoming")).toBeVisible();
  await admin.getByTestId("accept").click();
  // "in-call" once the server's timer has started, which needs both
  // browsers connected to each other.
  await expect(visitor.getByTestId("call-screen")).toHaveAttribute("data-call-state", "in-call");
  await expect(admin.getByTestId("call-screen")).toHaveAttribute("data-call-state", "in-call");
}

// "m:ss" on the call screen, as seconds.
export async function clockSeconds(page) {
  const text = (await page.getByTestId("time-left").textContent()).trim();
  const [m, s] = text.split(":").map(Number);
  return m * 60 + s;
}

// Wait until no admin page is connected and the server shows Away.
export async function waitForAway(api) {
  await expect.poll(async () => (await (await api.get("/api/status")).json()).status, { timeout: 20_000 }).toBe("away");
}
