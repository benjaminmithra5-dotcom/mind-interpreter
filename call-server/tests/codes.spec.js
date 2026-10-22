import { test, expect, createCode, enterCode, SERVER, SITE } from "./helpers.js";
import { request } from "@playwright/test";

test("an invalid code is refused kindly", async ({ open }) => {
  const page = await open("/call");
  await enterCode(page, "ABCDEFGHJK");
  await expect(page.getByTestId("code-error")).toHaveText("That code isn't recognised. Please check it and try again.");
  await expect(page.getByTestId("code-info")).toHaveCount(0);
});

test("a valid code shows its minutes, mode and expiry", async ({ open, api }) => {
  const { code } = await createCode(api, { minutes: 45, mode: "audio+video", expiresOn: "2099-12-31" });
  const page = await open("/call");
  // Spaces, dashes and lower case are fine.
  await enterCode(page, `${code.slice(0, 5).toLowerCase()}-${code.slice(5)}`);
  const info = page.getByTestId("code-info");
  await expect(info).toContainText("45:00");
  await expect(info).toContainText("Audio and video");
  await expect(info).toContainText("2099");
});

test("an expired code is refused", async ({ open, api }) => {
  const yesterday = new Date(Date.now() - 86400000).toISOString().slice(0, 10);
  const { code } = await createCode(api, { expiresOn: yesterday });
  const page = await open("/call");
  await enterCode(page, code);
  await expect(page.getByTestId("code-error")).toHaveText("That code has expired.");
});

test("a disabled code is refused", async ({ open, api }) => {
  const { id, code } = await createCode(api);
  await api.post(`/api/admin/codes/${id}/disabled`, { data: { disabled: true } });
  const page = await open("/call");
  await enterCode(page, code);
  await expect(page.getByTestId("code-error")).toBeVisible();
});

test("code attempts are rate limited per address, with a lockout", async ({ api }) => {
  const { code } = await createCode(api);
  const ctx = await request.newContext({ baseURL: SERVER, extraHTTPHeaders: { Origin: SITE, "X-Forwarded-For": "203.0.113.7" } });
  for (let i = 0; i < 4; i++) {
    const res = await ctx.post("/api/codes/check", { data: { code: `WRONGCODE${i}` } });
    expect(res.status()).toBe(200);
    expect((await res.json()).valid).toBe(false);
  }
  const fifth = await ctx.post("/api/codes/check", { data: { code: "WRONGCODE9" } });
  expect(fifth.status()).toBe(429);
  // While locked, even a real code is not checked.
  const locked = await ctx.post("/api/codes/check", { data: { code } });
  expect(locked.status()).toBe(429);
  expect((await locked.json()).reason).toBe("locked");
  await ctx.dispose();

  // A different address can still check codes.
  const other = await request.newContext({ baseURL: SERVER, extraHTTPHeaders: { Origin: SITE, "X-Forwarded-For": "203.0.113.8" } });
  expect((await (await other.post("/api/codes/check", { data: { code } })).json()).valid).toBe(true);
  await other.dispose();
});

test("other sites can't use the API (CORS)", async () => {
  const ctx = await request.newContext({ baseURL: SERVER, extraHTTPHeaders: { Origin: "https://evil.example" } });
  expect((await ctx.post("/api/codes/check", { data: { code: "ABCDEFGHJK" } })).status()).toBe(403);
  const res = await ctx.get("/api/status");
  expect(res.headers()["access-control-allow-origin"]).toBeUndefined();
  await ctx.dispose();
});
