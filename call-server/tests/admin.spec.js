import { test, expect, adminApi, SERVER, SITE, ADMIN_PASSWORD } from "./helpers.js";
import { request } from "@playwright/test";
import WebSocket from "ws";

test("admin login: a wrong password is refused, the right one opens the admin page", async ({ open }) => {
  const page = await open("/admin");
  await page.getByLabel("Password").fill("not-the-password");
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page.getByTestId("login-error")).toHaveText("That password isn't right.");

  await page.getByLabel("Password").fill(ADMIN_PASSWORD);
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page.getByTestId("status-control")).toBeVisible();
  await expect(page.getByTestId("status-control")).toContainText("Keep this page open to receive calls.");

  // The signed cookie keeps the session after a reload.
  await page.reload();
  await expect(page.getByTestId("status-control")).toBeVisible();
});

test("the admin API and the admin socket need the session cookie", async () => {
  const ctx = await request.newContext({ baseURL: SERVER, extraHTTPHeaders: { Origin: SITE } });
  expect((await ctx.get("/api/admin/overview")).status()).toBe(401);
  expect((await ctx.post("/api/admin/status", { data: { away: false } })).status()).toBe(401);
  await ctx.dispose();
  const ws = new WebSocket(`${SERVER.replace("http", "ws")}/ws?role=admin`, { headers: { Origin: SITE } });
  const code = await new Promise((resolve) => ws.on("close", resolve));
  expect(code).toBe(4401);
});

test("admin login is rate limited after repeated failures", async () => {
  const ip = "198.51.100.20";
  const ctx = await request.newContext({ baseURL: SERVER, extraHTTPHeaders: { Origin: SITE, "X-Forwarded-For": ip } });
  for (let i = 0; i < 4; i++) expect((await ctx.post("/api/admin/login", { data: { password: "wrong" } })).status()).toBe(401);
  expect((await ctx.post("/api/admin/login", { data: { password: "wrong" } })).status()).toBe(429);
  // Locked out: even the right password waits.
  expect((await ctx.post("/api/admin/login", { data: { password: ADMIN_PASSWORD } })).status()).toBe(429);
  await ctx.dispose();
  // Other addresses are not affected.
  (await adminApi("198.51.100.21")).dispose();
});

test("other sites can't use the API (CORS)", async () => {
  const ctx = await request.newContext({ baseURL: SERVER, extraHTTPHeaders: { Origin: "https://evil.example" } });
  expect((await ctx.post("/api/admin/login", { data: { password: ADMIN_PASSWORD } })).status()).toBe(403);
  const res = await ctx.get("/api/status");
  expect(res.headers()["access-control-allow-origin"]).toBeUndefined();
  await ctx.dispose();
});

test("/admin is an installable app; /call is not, and both are noindex", async ({ open }) => {
  const admin = await open("/admin");
  await expect(admin.locator('link[rel="manifest"]')).toHaveAttribute("href", "/admin.webmanifest");
  await expect(admin.locator('meta[name="robots"]')).toHaveAttribute("content", /noindex/);
  const manifest = await (await admin.request.get("/admin.webmanifest")).json();
  expect(manifest.start_url).toBe("/admin");
  expect(manifest.theme_color.toLowerCase()).toBe("#0e5a5f");
  expect(manifest.background_color.toLowerCase()).toBe("#f6f0e4");
  expect((await admin.request.get("/admin-sw.js")).ok()).toBeTruthy();

  const call = await open("/call");
  await expect(call.locator('link[rel="manifest"]')).toHaveCount(0);
  await expect(call.locator('meta[name="robots"]')).toHaveAttribute("content", /noindex/);
  await expect(call.getByText("$9.80 for 45 minutes. Audio call.")).toBeVisible();
  await expect(call.getByText("I accept calls from people who have booked with me.")).toBeVisible();
  await expect(call.getByTestId("crisis-notice")).toHaveText("This is not an emergency service. If you are in crisis, contact your local emergency services or a crisis line right away (for example, 988 in the US).");
});

test("the mic test shows a level from the microphone", async ({ open }) => {
  const page = await open("/call");
  await expect(page.getByText("Use headphones or over-ear headphones.")).toBeVisible();
  await page.getByRole("button", { name: "Test microphone" }).click();
  await expect(page.getByRole("button", { name: "Stop microphone test" })).toBeVisible();
  // The fake microphone beeps once a second; catch the meter moving.
  await page.waitForFunction(() => Number(document.querySelector('[role="meter"]').getAttribute("aria-valuenow")) > 0, null, { polling: "raf", timeout: 20_000 });
});
