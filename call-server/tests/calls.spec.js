import { test, expect, openAdmin, rawSocket, fillCaller, ring, startCall, clockSeconds, ticks, TICK_MS, CALL_LIMIT, CALL_MAX_PRESSES } from "./helpers.js";

const NOT_AVAILABLE = "Not available right now. You can write to me on the Consultation page.";
const BUSY = "Busy right now. Please try again in a few minutes, or write to me on the Consultation page.";

test("ringing shows the caller's name and email; decline frees the line at once", async ({ open }) => {
  const admin = await openAdmin(open);
  const visitor = await open("/call");
  await ring(visitor, admin, "Sam Rivera", "sam@example.com");
  await expect(admin.getByTestId("caller-name")).toHaveText("Sam Rivera");
  await expect(admin.getByTestId("caller-email")).toHaveText("sam@example.com");

  await admin.getByTestId("decline").click();
  const msg = visitor.getByTestId("call-message");
  await expect(msg).toHaveText(NOT_AVAILABLE);
  await expect(msg.getByRole("link", { name: "Consultation page" })).toHaveAttribute("href", "/consultation");

  // The line is free again straight away: another visitor can ring.
  const next = await open("/call");
  await ring(next, admin, "Alex", "alex@example.com");
  await next.getByRole("button", { name: "Cancel" }).click();
  await expect(next.getByTestId("call-message")).toHaveText("Call cancelled.");
  await expect(admin.getByTestId("incoming")).toHaveCount(0);
});

test("no answer within 45 seconds: a kind message, and the line is free again", async ({ open }) => {
  const admin = await openAdmin(open);
  const visitor = await open("/call");
  await ring(visitor, admin);
  const msg = visitor.getByTestId("call-message");
  await expect(msg).toHaveAttribute("data-reason", "no-answer", { timeout: ticks(45) + 10_000 });
  await expect(msg).toHaveText("Sorry, I couldn't answer just now. You can write to me on the Consultation page.");
  await expect(msg.getByRole("link")).toHaveAttribute("href", "/consultation");
  await expect(admin.getByTestId("incoming")).toHaveCount(0);
  await expect(admin.getByTestId("admin-notice")).toContainText("Missed call");
  await expect(visitor.getByTestId("call-button")).toBeEnabled();
});

test("a second caller hears Busy while a call rings, and while a call is in progress", async ({ open }) => {
  const admin = await openAdmin(open);
  const first = await open("/call");
  const second = await open("/call");
  await ring(first, admin);

  // Ringing: the second visitor can still press Call, and hears Busy.
  await fillCaller(second, "Jo", "jo@example.com");
  await second.getByTestId("call-button").click();
  await expect(second.getByTestId("call-message")).toHaveText(BUSY);

  // In progress: the status says On a call and the button is disabled.
  await admin.getByTestId("accept").click();
  await expect(first.getByTestId("call-screen")).toHaveAttribute("data-call-state", "in-call");
  await expect(second.getByTestId("status-badge")).toHaveAttribute("data-status", "on_call");
  await second.reload();
  await expect(second.getByTestId("status-message")).toHaveText(BUSY);
  await expect(second.getByTestId("call-button")).toBeDisabled();

  await first.getByRole("button", { name: "End call" }).click();
  // After the call, back to Available (toggle on, admin connected).
  await expect(second.getByTestId("status-badge")).toHaveAttribute("data-status", "available");
  await expect(second.getByTestId("call-button")).toBeEnabled();
});

test("accept: the audio call connects and the timer counts down on both sides", async ({ open }) => {
  const admin = await openAdmin(open);
  const visitor = await open("/call");
  await startCall(visitor, admin, "Sam Rivera");
  await expect(admin.getByTestId("call-screen")).toContainText("In a call with Sam Rivera");

  // Both sides hear each other: the remote audio element has a live track.
  for (const page of [visitor, admin]) {
    await expect.poll(() => page.evaluate(() => {
      const el = document.querySelector('[data-testid="call-screen"] audio');
      return el && el.srcObject ? el.srcObject.getAudioTracks().filter((t) => t.readyState === "live").length : 0;
    })).toBeGreaterThan(0);
  }
  // Audio only: no video is sent or received.
  expect(await visitor.evaluate(() => document.querySelectorAll("video").length)).toBe(0);

  const start = await clockSeconds(visitor);
  expect(start).toBeLessThanOrEqual(CALL_LIMIT);
  expect(start).toBeGreaterThan(CALL_LIMIT - 10);
  await expect.poll(() => clockSeconds(visitor)).toBeLessThan(start - 3);
  await expect.poll(() => clockSeconds(admin)).toBeLessThan(start - 3);

  await admin.getByRole("button", { name: "End call" }).click();
  await expect(visitor.getByTestId("call-message")).toHaveText("The call has ended. Thank you for talking.");
  await expect(admin.getByTestId("admin-notice")).toHaveText("Call ended.");
});

test("2-minute banner, then the server ends the call at the limit", async ({ open }) => {
  const admin = await openAdmin(open);
  const visitor = await open("/call");
  await startCall(visitor, admin);

  // More than 2 minutes left at the start: no banner yet.
  expect(await clockSeconds(visitor)).toBeGreaterThan(120);
  await expect(visitor.getByTestId("warning-banner")).toHaveCount(0);
  await expect(visitor.getByTestId("warning-banner")).toHaveText("About 2 minutes left.", { timeout: ticks(CALL_LIMIT - 115) + 10_000 });
  await expect(admin.getByTestId("warning-banner")).toBeVisible();
  expect(await clockSeconds(visitor)).toBeLessThanOrEqual(120);

  await expect(visitor.getByTestId("call-message")).toHaveAttribute("data-reason", "time", { timeout: ticks(125) + 10_000 });
  await expect(visitor.getByTestId("call-message")).toHaveText("Our time is up. Thank you for talking.");
  await expect(admin.getByTestId("admin-notice")).toHaveText("Call ended: time is up.");
});

test("a dropped connection pauses the timer, and the call carries on after a reconnect", async ({ open }) => {
  const admin = await openAdmin(open);
  const visitor = await open("/call");
  await startCall(visitor, admin);
  await expect.poll(() => clockSeconds(admin)).toBeLessThan(CALL_LIMIT - 2);

  // The visitor's page goes away: its connections drop.
  await visitor.goto("about:blank");
  await expect(admin.getByTestId("paused-banner")).toBeVisible();
  const paused = await clockSeconds(admin);
  await admin.waitForTimeout(ticks(8));
  expect(await clockSeconds(admin)).toBe(paused);

  // Back within the grace: the page rejoins and the timer runs again.
  await visitor.goto("/call");
  await expect(admin.getByTestId("paused-banner")).toHaveCount(0, { timeout: ticks(30) + 10_000 });
  await expect(visitor.getByTestId("call-screen")).toBeVisible();
  await expect.poll(() => clockSeconds(admin)).toBeLessThan(paused);
  await admin.getByRole("button", { name: "End call" }).click();
  await expect(visitor.getByTestId("call-message")).toBeVisible();
});

test("a dropped connection that doesn't come back ends after 30 seconds", async ({ open }) => {
  const admin = await openAdmin(open);
  const visitor = await open("/call");
  await startCall(visitor, admin);

  await visitor.close();
  await expect(admin.getByTestId("paused-banner")).toBeVisible();
  const t0 = Date.now();
  await expect(admin.getByTestId("admin-notice")).toHaveText("Call ended: the connection was lost.", { timeout: ticks(30) + 10_000 });
  // It waited the full grace (30 call-seconds) before ending.
  expect(Date.now() - t0).toBeGreaterThan(ticks(30) - 4 * TICK_MS - 1000);
});

test("computer and phone both ring; the first to accept takes the call, the other stops ringing", async ({ open }) => {
  const computer = await openAdmin(open);
  const phone = await openAdmin(open, { available: false });
  const visitor = await open("/call");
  await ring(visitor, computer);
  await expect(phone.getByTestId("incoming")).toBeVisible();

  await phone.getByTestId("accept").click();
  await expect(computer.getByTestId("incoming")).toHaveCount(0);
  await expect(computer.getByTestId("admin-notice")).toHaveText("Answered on another device.");
  await expect(phone.getByTestId("call-screen")).toHaveAttribute("data-call-state", "in-call");
  await expect(visitor.getByTestId("call-screen")).toHaveAttribute("data-call-state", "in-call");
  await expect(computer.getByTestId("call-screen")).toHaveCount(0);
  await visitor.getByRole("button", { name: "End call" }).click();
  await expect(visitor.getByTestId("call-message")).toBeVisible();
});

test("name and email are required, on the page and on the server", async ({ open }) => {
  const admin = await openAdmin(open);
  const visitor = await open("/call");
  await visitor.getByTestId("call-button").click();
  await expect(visitor.getByTestId("form-error")).toHaveText("Please enter your name and a valid email.");
  await fillCaller(visitor, "Sam", "not-an-email");
  await visitor.getByTestId("call-button").click();
  await expect(visitor.getByTestId("form-error")).toBeVisible();
  await expect(admin.getByTestId("incoming")).toHaveCount(0);

  // The server checks too, whatever the page sends.
  const raw = await rawSocket({ ip: "192.0.2.50" });
  raw.send({ type: "call", name: "", email: "x@example.com" });
  expect((await raw.next("call-error")).reason).toBe("invalid");
  raw.send({ type: "call", name: "Sam", email: "nope" });
  expect((await raw.next("call-error")).reason).toBe("invalid");
  raw.close();
  await expect(admin.getByTestId("incoming")).toHaveCount(0);
});

test("Call presses are rate limited per address", async ({ open }) => {
  const admin = await openAdmin(open);
  const raw = await rawSocket({ ip: "203.0.113.7" });
  for (let i = 0; i < CALL_MAX_PRESSES; i++) {
    raw.send({ type: "call", name: "Sam", email: "sam@example.com" });
    const reply = await raw.next(["ringing", "call-error"]);
    expect(reply.reason).not.toBe("rate-limited");
    if (reply.type === "ringing") {
      raw.send({ type: "hangup" });
      await raw.next("ended");
    }
  }
  raw.send({ type: "call", name: "Sam", email: "sam@example.com" });
  expect((await raw.next("call-error")).reason).toBe("rate-limited");
  raw.close();

  // Another address can still call.
  const other = await rawSocket({ ip: "203.0.113.8" });
  other.send({ type: "call", name: "Sam", email: "sam@example.com" });
  await other.next("ringing");
  other.send({ type: "hangup" });
  await other.next("ended");
  other.close();
  await expect(admin.getByTestId("incoming")).toHaveCount(0);
});
