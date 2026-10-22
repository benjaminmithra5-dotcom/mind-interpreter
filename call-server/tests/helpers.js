import { test as base, expect, request } from "@playwright/test";
import WebSocket from "ws";
import { SERVER, SITE, ADMIN_PASSWORD, TICK_MS, CALL_LIMIT, HEARTBEAT_SECONDS, CALL_MAX_PRESSES } from "./env.js";

export { expect, SERVER, SITE, ADMIN_PASSWORD, TICK_MS, CALL_LIMIT, HEARTBEAT_SECONDS, CALL_MAX_PRESSES };

// Wall-clock milliseconds for a number of call "seconds".
export const ticks = (n) => n * TICK_MS;

const publicStatus = async () => {
  const ctx = await request.newContext({ baseURL: SERVER });
  const status = (await (await ctx.get("/api/status")).json()).status;
  await ctx.dispose();
  return status;
};
export const waitForStatus = (status, timeout = 20_000) => expect.poll(publicStatus, { timeout }).toBe(status);

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
    // Let any call from this test finish, and every admin page go, before
    // the next test starts.
    await waitForStatus("away", 30_000);
  },
});

// A signed-in admin, straight to the server's API.
export async function adminApi(ip) {
  const ctx = await request.newContext({ baseURL: SERVER, extraHTTPHeaders: { Origin: SITE, ...(ip ? { "X-Forwarded-For": ip } : {}) } });
  const res = await ctx.post("/api/admin/login", { data: { password: ADMIN_PASSWORD } });
  expect(res.ok()).toBeTruthy();
  return ctx;
}

// A raw WebSocket to the server, for things a browser page can't do (stop
// answering heartbeats like a sleeping phone, or use another IP address).
export async function rawSocket({ admin = false, ip, autoPong = true } = {}) {
  const headers = { Origin: SITE };
  if (ip) headers["X-Forwarded-For"] = ip;
  if (admin) {
    const ctx = await adminApi();
    const state = await ctx.storageState();
    headers.Cookie = state.cookies.map((c) => `${c.name}=${c.value}`).join("; ");
    await ctx.dispose();
  }
  const ws = new WebSocket(`${SERVER.replace("http", "ws")}/ws${admin ? "?role=admin" : ""}`, { headers, autoPong });
  const messages = [];
  ws.on("message", (raw) => messages.push(JSON.parse(raw)));
  await new Promise((resolve, reject) => { ws.once("open", resolve); ws.once("error", reject); });
  return {
    ws,
    send: (m) => ws.send(JSON.stringify(m)),
    // The next message of one of these types (removed from the queue).
    next: async (types, timeout = 10_000) => {
      const wanted = [].concat(types);
      await expect.poll(() => messages.some((m) => wanted.includes(m.type)), { timeout }).toBe(true);
      return messages.splice(messages.findIndex((m) => wanted.includes(m.type)), 1)[0];
    },
    close: () => ws.terminate(),
  };
}

// The admin page, signed in and switched to Available.
export async function openAdmin(open, { available = true } = {}) {
  const page = await open("/admin");
  await page.getByLabel("Password").fill(ADMIN_PASSWORD);
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page.getByTestId("status-control")).toBeVisible();
  if (available) {
    await page.getByTestId("set-available").click();
    await expect(page.getByTestId("status-control").getByTestId("status-badge")).toHaveAttribute("data-status", "available");
  }
  return page;
}

export async function fillCaller(page, name = "Sam Rivera", email = "sam@example.com") {
  await page.getByLabel("Your name").fill(name);
  await page.getByLabel("Your email").fill(email);
}

// Visitor rings; the admin page shows the call.
export async function ring(visitor, admin, name = "Sam Rivera", email = "sam@example.com") {
  await fillCaller(visitor, name, email);
  await expect(visitor.getByTestId("call-button")).toBeEnabled();
  await visitor.getByTestId("call-button").click();
  await expect(visitor.getByTestId("ringing")).toBeVisible();
  await expect(admin.getByTestId("incoming")).toBeVisible();
}

// Visitor calls, admin accepts, and both sides see the timer running.
export async function startCall(visitor, admin, name) {
  await ring(visitor, admin, name);
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
