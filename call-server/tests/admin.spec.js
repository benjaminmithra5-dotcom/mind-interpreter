import { test, expect, adminApi, SERVER, SITE, ADMIN_PASSWORD } from "./helpers.js";
import { request } from "@playwright/test";

test("admin login: a wrong password is refused, the right one opens the console", async ({ open }) => {
  const page = await open("/admin");
  await page.getByLabel("Password").fill("not-the-password");
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page.getByTestId("login-error")).toHaveText("That password isn't right.");

  await page.getByLabel("Password").fill(ADMIN_PASSWORD);
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page.getByTestId("status-control")).toBeVisible();

  // The signed cookie keeps the session after a reload.
  await page.reload();
  await expect(page.getByTestId("status-control")).toBeVisible();
});

test("admin API needs the session cookie", async () => {
  const ctx = await request.newContext({ baseURL: SERVER, extraHTTPHeaders: { Origin: SITE } });
  expect((await ctx.get("/api/admin/overview")).status()).toBe(401);
  expect((await ctx.post("/api/admin/codes", { data: {} })).status()).toBe(401);
  await ctx.dispose();
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

test("create a code, add minutes and disable it from the admin page", async ({ open }) => {
  const page = await open("/admin");
  await page.getByLabel("Password").fill(ADMIN_PASSWORD);
  await page.getByRole("button", { name: "Sign in" }).click();

  const form = page.getByTestId("new-code");
  await expect(form.getByLabel("Minutes")).toHaveValue("45");
  await form.getByLabel("Note, just for you").fill("Test person");
  await form.getByRole("button", { name: "Create code" }).click();
  const created = page.getByTestId("created-code");
  await expect(created).toContainText("45:00");
  await expect(created).toContainText("Audio only");
  const code = (await created.locator("span").textContent()).trim();
  expect(code).toMatch(/^[ABCDEFGHJKMNPQRSTUVWXYZ23456789]{10}$/);

  const row = page.locator(`[data-testid="code-row"][data-code="${code}"]`);
  await expect(row).toContainText("Test person");
  await row.getByLabel(`Minutes to add to ${code}`).fill("15");
  await row.getByRole("button", { name: "Add minutes" }).click();
  await expect(row).toContainText("60:00 left");
  await row.getByRole("button", { name: "Disable" }).click();
  await expect(row).toContainText("Disabled");
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
  await expect(call.getByTestId("crisis-notice")).toContainText("988");
  await expect(call.getByText("$9.80 for 45 minutes. Audio call; video only on prior request.")).toBeVisible();
});

test("the mic test shows a level from the microphone", async ({ open }) => {
  const page = await open("/call");
  await page.getByRole("button", { name: "Test microphone" }).click();
  await expect(page.getByRole("button", { name: "Stop microphone test" })).toBeVisible();
  await expect.poll(async () => Number(await page.getByRole("meter").getAttribute("aria-valuenow"))).toBeGreaterThan(0);
});
