import { test, expect, openAdmin, createCode, codeState, enterCode, startCall, clockSeconds, ticks, TICK_MS } from "./helpers.js";

test("ringing, then decline: the visitor is told kindly and keeps the minutes", async ({ open, api }) => {
  const { code } = await createCode(api, { note: "Decline tester" });
  const admin = await openAdmin(open);
  const visitor = await open("/call");
  const watcher = await open("/call");
  await enterCode(visitor, code);
  await visitor.getByTestId("call-button").click();

  await expect(visitor.getByTestId("ringing")).toBeVisible();
  const incoming = admin.getByTestId("incoming");
  await expect(incoming).toBeVisible();
  await expect(incoming).toContainText("Decline tester");
  // While it rings, everyone else sees "On a call".
  await expect(watcher.getByTestId("status-badge")).toHaveAttribute("data-status", "on_call");

  await admin.getByTestId("decline").click();
  const ended = visitor.getByTestId("call-ended");
  await expect(ended).toHaveAttribute("data-reason", "declined");
  await expect(ended).toContainText("Your minutes are still on your code.");
  await expect(ended).toContainText("45:00");
  await expect(watcher.getByTestId("status-badge")).toHaveAttribute("data-status", "available");
  expect((await codeState(api, code)).secondsRemaining).toBe(45 * 60);
});

test("no answer within the ring time: the call stops ringing and the minutes stay", async ({ open, api }) => {
  const { code } = await createCode(api);
  const admin = await openAdmin(open);
  const visitor = await open("/call");
  await enterCode(visitor, code);
  await visitor.getByTestId("call-button").click();
  await expect(admin.getByTestId("incoming")).toBeVisible();
  await expect(visitor.getByTestId("call-ended")).toHaveAttribute("data-reason", "no-answer", { timeout: ticks(45) + 10_000 });
  await expect(admin.getByTestId("incoming")).toHaveCount(0);
  await expect(admin.getByTestId("admin-notice")).toContainText("Missed call");
  expect((await codeState(api, code)).secondsRemaining).toBe(45 * 60);
});

test("only one call at a time", async ({ open, api }) => {
  const a = await createCode(api);
  const b = await createCode(api);
  const admin = await openAdmin(open);
  const first = await open("/call");
  const second = await open("/call");
  await enterCode(second, b.code);
  await expect(second.getByTestId("call-button")).toBeVisible();
  await enterCode(first, a.code);
  await first.getByTestId("call-button").click();
  await expect(admin.getByTestId("incoming")).toBeVisible();
  // The second visitor now sees "On a call" and the request form instead.
  await expect(second.getByTestId("status-badge")).toHaveAttribute("data-status", "on_call");
  await expect(second.getByTestId("call-button")).toHaveCount(0);
  await expect(second.getByTestId("request-form")).toBeVisible();
  await first.getByRole("button", { name: "Cancel" }).click();
  await expect(first.getByTestId("call-ended")).toHaveAttribute("data-reason", "cancelled");
});

test("accept: the audio call connects, the timer counts down, and the balance carries over", async ({ open, api }) => {
  const { code } = await createCode(api, { minutes: 45, note: "Call tester" });
  const admin = await openAdmin(open);
  const visitor = await open("/call");
  await startCall(visitor, admin, code);

  // Both sides hear each other: the remote audio element has a live track.
  for (const page of [visitor, admin]) {
    await expect.poll(() => page.evaluate(() => {
      const el = document.querySelector('[data-testid="call-screen"] audio');
      return el && el.srcObject ? el.srcObject.getAudioTracks().filter((t) => t.readyState === "live").length : 0;
    })).toBeGreaterThan(0);
  }
  await expect(visitor.getByTestId("call-screen")).toHaveAttribute("data-call-state", "in-call");

  // The server's timer counts down on both sides.
  const start = await clockSeconds(visitor);
  expect(start).toBeLessThanOrEqual(45 * 60);
  await expect.poll(() => clockSeconds(visitor)).toBeLessThan(start - 5);
  await expect.poll(() => clockSeconds(admin)).toBeLessThan(start - 5);
  // Minutes come off the code in real time, not at the end.
  await expect.poll(async () => (await codeState(api, code)).secondsRemaining).toBeLessThan(45 * 60 - 5);

  await visitor.getByRole("button", { name: "End call" }).click();
  await expect(visitor.getByTestId("call-ended")).toHaveAttribute("data-reason", "visitor-ended");
  await expect(admin.getByTestId("admin-notice")).toContainText("caller ended");
  const left = (await codeState(api, code)).secondsRemaining;
  expect(left).toBeLessThan(45 * 60);
  expect(left).toBeGreaterThan(40 * 60);

  // The rest stays on the code: a second call starts from the same balance.
  await visitor.reload();
  await enterCode(visitor, code);
  const m = Math.floor(left / 60), s = String(left % 60).padStart(2, "0");
  await expect(visitor.getByTestId("code-info")).toContainText(`${m}:${s}`);
  await visitor.getByTestId("call-button").click();
  await admin.getByTestId("accept").click();
  await expect(visitor.getByTestId("call-screen")).toHaveAttribute("data-call-state", "in-call");
  expect(await clockSeconds(visitor)).toBeLessThanOrEqual(left);
  expect(await clockSeconds(visitor)).toBeGreaterThan(left - 10);
  await admin.getByRole("button", { name: "End call" }).click();
  await expect(visitor.getByTestId("call-ended")).toHaveAttribute("data-reason", "benjamin-ended");

  // Only metadata is kept: two calls with their minutes used.
  const calls = (await (await api.get("/api/admin/overview")).json()).calls.filter((k) => k.code === code);
  expect(calls).toHaveLength(2);
  for (const k of calls) {
    expect(Object.keys(k).sort()).toEqual(expect.arrayContaining(["startedAt", "endedAt", "secondsUsed"]));
    expect(k.secondsUsed).toBeGreaterThan(0);
  }
  await expect(admin.getByTestId("recent-calls")).toContainText("Call tester");
});

test("2-minute warning, 60-second wrap-up that isn't charged, then the call ends by itself", async ({ open, api }) => {
  const { code } = await createCode(api, { minutes: 3 });
  const admin = await openAdmin(open);
  const visitor = await open("/call");
  await startCall(visitor, admin, code);

  // More than 2 minutes left: no warning yet.
  await expect(visitor.getByTestId("warning-banner")).toHaveCount(0);
  await expect(visitor.getByTestId("warning-banner")).toHaveText("About 2 minutes left.", { timeout: ticks(70) + 10_000 });
  await expect(admin.getByTestId("warning-banner")).toBeVisible();
  expect(await clockSeconds(visitor)).toBeLessThanOrEqual(120);

  // At zero: the wrap-up banner on both sides.
  await expect(visitor.getByTestId("wrapup-banner")).toContainText("Wrapping up.", { timeout: ticks(130) + 10_000 });
  await expect(admin.getByTestId("wrapup-banner")).toBeVisible();
  await expect(visitor.getByTestId("warning-banner")).toHaveCount(0);
  expect((await codeState(api, code)).secondsRemaining).toBe(0);

  // After the grace, the server hangs up by itself.
  await expect(visitor.getByTestId("call-ended")).toHaveAttribute("data-reason", "time", { timeout: ticks(70) + 10_000 });
  await expect(visitor.getByTestId("call-ended")).toContainText("Your time is up.");
  const call = (await (await api.get("/api/admin/overview")).json()).calls.find((k) => k.code === code);
  // Wrap-up time is not deducted: exactly the 3 minutes were used.
  expect(call.secondsUsed).toBe(180);
  expect(call.endReason).toBe("time");

  // A used-up code can't call again.
  await visitor.reload();
  await enterCode(visitor, code);
  await expect(visitor.getByTestId("code-error")).toHaveText("That code has no minutes left.");
});

test("a dropped connection pauses the timer, and the call carries on after a reconnect", async ({ open, api }) => {
  const { code } = await createCode(api);
  const admin = await openAdmin(open);
  const visitor = await open("/call");
  await startCall(visitor, admin, code);
  await expect.poll(() => clockSeconds(visitor)).toBeLessThan(45 * 60 - 2);

  // The visitor's page goes away: its connections drop.
  await visitor.goto("about:blank");
  await expect(admin.getByTestId("paused-banner")).toBeVisible();
  const paused = (await codeState(api, code)).secondsRemaining;
  await admin.waitForTimeout(ticks(8));
  expect((await codeState(api, code)).secondsRemaining).toBe(paused);

  // Back within the grace: the page rejoins and the timer runs again.
  await visitor.goto("/call");
  await expect(admin.getByTestId("paused-banner")).toHaveCount(0, { timeout: ticks(30) + 10_000 });
  await expect(visitor.getByTestId("call-screen")).toBeVisible();
  await expect.poll(async () => (await codeState(api, code)).secondsRemaining).toBeLessThan(paused);
  await admin.getByRole("button", { name: "End call" }).click();
  await expect(visitor.getByTestId("call-ended")).toBeVisible();
});

test("a dropped connection that doesn't come back ends after 30 seconds and keeps the balance", async ({ open, api }) => {
  const { code } = await createCode(api);
  const admin = await openAdmin(open);
  const visitor = await open("/call");
  await startCall(visitor, admin, code);
  await expect.poll(() => clockSeconds(visitor)).toBeLessThan(45 * 60 - 2);

  await visitor.close();
  await expect(admin.getByTestId("paused-banner")).toBeVisible();
  const paused = (await codeState(api, code)).secondsRemaining;
  const t0 = Date.now();
  await expect(admin.getByTestId("admin-notice")).toContainText("connection lost", { timeout: ticks(30) + 10_000 });
  // It waited the full grace (30 call-seconds) before ending.
  expect(Date.now() - t0).toBeGreaterThan(ticks(30) - 4 * TICK_MS - 1000);
  expect((await codeState(api, code)).secondsRemaining).toBe(paused);
  const call = (await (await api.get("/api/admin/overview")).json()).calls.find((k) => k.code === code);
  expect(call.endReason).toBe("dropped");
});

test("computer and phone both ring; the first to accept takes the call, the other stops ringing", async ({ open, api }) => {
  const { code } = await createCode(api);
  const computer = await openAdmin(open);
  const phone = await openAdmin(open);
  const visitor = await open("/call");
  await enterCode(visitor, code);
  await visitor.getByTestId("call-button").click();
  await expect(computer.getByTestId("incoming")).toBeVisible();
  await expect(phone.getByTestId("incoming")).toBeVisible();

  await phone.getByTestId("accept").click();
  await expect(computer.getByTestId("incoming")).toHaveCount(0);
  await expect(computer.getByTestId("admin-notice")).toHaveText("Answered on another device.");
  await expect(phone.getByTestId("call-screen")).toHaveAttribute("data-call-state", "in-call");
  await expect(visitor.getByTestId("call-screen")).toHaveAttribute("data-call-state", "in-call");
  await expect(computer.getByTestId("call-screen")).toHaveCount(0);
  await visitor.getByRole("button", { name: "End call" }).click();
  await expect(visitor.getByTestId("call-ended")).toBeVisible();
});
