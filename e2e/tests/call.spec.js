import { test, expect, openHost, joinAsGuest, startCall, clockSeconds, remoteAudioTracks, ticks, CALL_LIMIT, TICK_MS } from "./helpers.js";

// ---- the code check ------------------------------------------------------------
test("join: a code that isn't valid, not open yet, or expired gets a calm message", async ({ open, gas }) => {
  const page = await open("/call");
  await joinAsGuest(page, "ABCDEFGHJK");
  await expect(page.getByTestId("join-message")).toHaveText("That code isn't valid. Please check the code I sent you on WhatsApp.");

  const later = await gas.booking({ startsInMinutes: 30 });
  await joinAsGuest(page, later.code);
  await expect(page.getByTestId("join-message")).toHaveText(/^Your room opens 15 minutes before your call\. Your call is on .+ \(your time\)\.$/);

  const past = await gas.booking({ startsInMinutes: -61 });
  await joinAsGuest(page, past.code);
  await expect(page.getByTestId("join-message")).toHaveText("This code has expired. You're welcome to book another time below.");

  // A request that hasn't been approved has no working code.
  const pending = await gas.booking({ startsInMinutes: 5, status: "pending" });
  await joinAsGuest(page, pending.code);
  await expect(page.getByTestId("join-message")).toHaveAttribute("data-reason", "invalid");

  // Inside the window (15 minutes before to 60 after): the room is checked next.
  for (const startsInMinutes of [14, -59]) {
    const ok = await gas.booking({ startsInMinutes });
    await joinAsGuest(page, ok.code);
    await expect(page.getByTestId("not-open")).toHaveText("The room isn't open yet. Benjamin will open it shortly. Trying again…");
    await page.getByRole("button", { name: "Leave" }).click();
    await expect(page.getByTestId("join-message")).toHaveText("You left the waiting room.");
  }

  await page.getByTestId("code-input").fill("");
  await page.getByTestId("join-button").click();
  await expect(page.getByTestId("join-message")).toHaveText("Please enter your code and your name.");
});

test("the code from the join link fills the code field", async ({ open, gas }) => {
  const { code } = await gas.booking();
  const page = await open(`/call?room=${code.toLowerCase()}`);
  await expect(page.getByTestId("code-input")).toHaveValue(code);
});

test("a guest who arrives before the room is open gets in once Benjamin opens it", async ({ open, gas }) => {
  const { code } = await gas.booking();
  const guest = await open(`/call?room=${code}`);
  await joinAsGuest(guest, code, "Asha");
  await expect(guest.getByTestId("not-open")).toBeVisible();
  const host = await openHost(open, code);
  await expect(guest.getByTestId("waiting")).toBeVisible({ timeout: 20_000 });
  await expect(host.getByTestId("guest-name")).toHaveText("Asha is waiting.");
});

// ---- the waiting room -------------------------------------------------------------
test("host: an invalid or expired code can't open a room", async ({ open, gas }) => {
  const host = await open("/host");
  await expect(host.getByText("Keep this page open while you wait.")).toHaveCount(0);
  await host.getByTestId("host-code").fill("ABCDEFGHJK");
  await host.getByTestId("open-room").click();
  await expect(host.getByTestId("host-error")).toHaveText("That code isn't valid (or the booking hasn't been approved).");
  const past = await gas.booking({ startsInMinutes: -61 });
  await host.getByTestId("host-code").fill(past.code);
  await host.getByTestId("open-room").click();
  await expect(host.getByTestId("host-error")).toHaveText("This code has expired.");
  // Early is fine for the host.
  const later = await gas.booking({ startsInMinutes: 120 });
  await host.getByTestId("host-code").fill(later.code);
  await host.getByTestId("open-room").click();
  await expect(host.getByTestId("room-status")).toHaveAttribute("data-state", "open");
  await expect(host.getByText("Keep this page open while you wait.")).toBeVisible();
  await expect(host.locator('meta[name="robots"]')).toHaveAttribute("content", /noindex/);
});

test("waiting room: decline sends the guest a kind message", async ({ open, gas }) => {
  const { code } = await gas.booking();
  const host = await openHost(open, code);
  const guest = await open(`/call?room=${code}`);
  await joinAsGuest(guest, code, "Asha");
  await expect(guest.getByTestId("waiting")).toHaveText("Waiting for Benjamin to let you in…");
  await expect(host.getByTestId("guest-waiting")).toBeVisible();
  await host.getByTestId("decline").click();
  const msg = guest.getByTestId("join-message");
  await expect(msg).toHaveText("Benjamin can't let you in right now. You're welcome to write to me on the Consultation page.");
  await expect(msg.getByRole("link")).toHaveAttribute("href", "/consultation");
  await expect(host.getByTestId("guest-waiting")).toHaveCount(0);
});

test("waiting room: a guest who leaves disappears from the host's page", async ({ open, gas }) => {
  const { code } = await gas.booking();
  const host = await openHost(open, code);
  const guest = await open(`/call?room=${code}`);
  await joinAsGuest(guest, code);
  await expect(host.getByTestId("guest-waiting")).toBeVisible();
  await guest.getByRole("button", { name: "Leave" }).click();
  await expect(host.getByTestId("guest-waiting")).toHaveCount(0);
  await expect(host.getByTestId("host-notice")).toHaveText("The guest left the waiting room.");
});

// ---- the call --------------------------------------------------------------------
test("admit: the audio call connects and the timer counts down on both sides", async ({ open, gas }) => {
  const { host, guest } = await startCall(open, gas, "Asha");
  await expect(host.getByTestId("call-screen")).toContainText("In a call with Asha");
  await expect(guest.getByTestId("call-screen")).toContainText("In a call with Benjamin");
  for (const page of [host, guest]) await expect.poll(() => remoteAudioTracks(page)).toBeGreaterThan(0);
  expect(await guest.evaluate(() => document.querySelectorAll("video").length)).toBe(0);

  const start = await clockSeconds(guest);
  expect(start).toBeLessThanOrEqual(CALL_LIMIT);
  expect(start).toBeGreaterThan(CALL_LIMIT - 10);
  await expect.poll(() => clockSeconds(guest)).toBeLessThan(start - 3);
  await expect.poll(() => clockSeconds(host)).toBeLessThan(start - 3);

  // Mute stops sending sound.
  await guest.getByRole("button", { name: "Mute" }).click();
  await expect(guest.getByRole("button", { name: "Unmute" })).toHaveAttribute("aria-pressed", "true");

  await guest.getByRole("button", { name: "End call" }).click();
  await expect(guest.getByTestId("join-message")).toHaveText("The call has ended. Thank you for talking.");
  await expect(host.getByTestId("host-notice")).toHaveText("Your guest ended the call.");
});

test("2-minute banner, then both sides end by themselves at the limit", async ({ open, gas }) => {
  const { host, guest } = await startCall(open, gas);
  expect(await clockSeconds(guest)).toBeGreaterThan(120);
  await expect(guest.getByTestId("warning-banner")).toHaveCount(0);
  await expect(guest.getByTestId("warning-banner")).toHaveText("About 2 minutes left.", { timeout: ticks(CALL_LIMIT - 115) + 10_000 });
  await expect(host.getByTestId("warning-banner")).toBeVisible();
  await expect(guest.getByTestId("join-message")).toHaveText("Our time is up. Thank you for talking.", { timeout: ticks(125) + 10_000 });
  await expect(host.getByTestId("host-notice")).toHaveText("Call ended: the 45 minutes are up.");
  await expect(host.getByTestId("room-status")).toHaveAttribute("data-state", "time-up");
});

test("a dropped connection pauses the timer, and the call carries on when the guest is back", async ({ open, gas }) => {
  const { host, guest, code } = await startCall(open, gas);
  await expect.poll(() => clockSeconds(host)).toBeLessThan(CALL_LIMIT - 2);

  // The guest's page goes away.
  await guest.goto("about:blank");
  await expect(host.getByTestId("reconnecting-banner")).toContainText("Reconnecting…");
  const paused = await clockSeconds(host);
  await host.waitForTimeout(ticks(8));
  expect(await clockSeconds(host)).toBe(paused);

  // Back within 30 seconds: the page rejoins by itself.
  await guest.goto(`/call?room=${code}`);
  await expect(guest.getByTestId("call-screen")).toHaveAttribute("data-call-state", "in-call", { timeout: 20_000 });
  await expect(host.getByTestId("reconnecting-banner")).toHaveCount(0);
  await expect.poll(() => clockSeconds(host)).toBeLessThan(paused);
  await expect.poll(() => remoteAudioTracks(host)).toBeGreaterThan(0);
  await host.getByRole("button", { name: "End call" }).click();
  await expect(guest.getByTestId("join-message")).toHaveText("The call has ended. Thank you for talking.");
});

test("a dropped connection that doesn't come back ends the call after the pause", async ({ open, gas }) => {
  const { host, guest } = await startCall(open, gas);
  await guest.close();
  await expect(host.getByTestId("reconnecting-banner")).toBeVisible();
  const t0 = Date.now();
  await expect(host.getByTestId("host-notice")).toHaveText("Call ended: the connection was lost.", { timeout: ticks(30) + 15_000 });
  expect(Date.now() - t0).toBeGreaterThan(ticks(30) - 3 * TICK_MS - 1000);
});

test("if the host's page drops, the guest sees Reconnecting… and then the call ends", async ({ open, gas }) => {
  const { host, guest } = await startCall(open, gas);
  await host.close();
  await expect(guest.getByTestId("reconnecting-banner")).toContainText("Reconnecting…");
  await expect(guest.getByTestId("join-message")).toHaveText(
    "The connection was lost, so the call ended. While your code is still valid, you can join again.",
    { timeout: ticks(30) + 15_000 },
  );
});

test("only one guest at a time: a second guest is refused while a call is live", async ({ open, gas }) => {
  const { host, code } = await startCall(open, gas);
  const second = await open(`/call?room=${code}`);
  await joinAsGuest(second, code, "Someone else");
  await expect(second.getByTestId("join-message")).toHaveText("Benjamin is in another call right now. Please try again in a few minutes.");
  await expect(host.getByTestId("guest-waiting")).toHaveCount(0);
  await expect(host.getByTestId("call-screen")).toHaveAttribute("data-call-state", "in-call");
});

test("the mic test shows a level from the microphone", async ({ open }) => {
  const page = await open("/call");
  await expect(page.getByText("Use headphones or over-ear headphones.").first()).toBeVisible();
  await page.getByRole("button", { name: "Test microphone" }).click();
  await page.waitForFunction(() => Number(document.querySelector('[role="meter"]').getAttribute("aria-valuenow")) > 0, null, { polling: "raf", timeout: 20_000 });
});

test("at 390px the join code placeholder fits in the field", async ({ open }) => {
  const page = await open("/call", { viewport: { width: 390, height: 844 } });
  const input = page.getByTestId("code-input");
  await expect(input).toHaveAttribute("placeholder", "Your code");
  // Width of the placeholder as drawn (same font, capitals, letter spacing)
  // against the space inside the field.
  const fit = await input.evaluate((el) => {
    const cs = getComputedStyle(el);
    const ctx = document.createElement("canvas").getContext("2d");
    ctx.font = `${cs.fontStyle} ${cs.fontWeight} ${cs.fontSize} ${cs.fontFamily}`;
    let text = el.placeholder;
    if (cs.textTransform === "uppercase") text = text.toUpperCase();
    const spacing = parseFloat(cs.letterSpacing) || 0;
    const textWidth = ctx.measureText(text).width + spacing * text.length;
    const room = el.clientWidth - parseFloat(cs.paddingLeft) - parseFloat(cs.paddingRight);
    return { textWidth, room };
  });
  expect(fit.textWidth).toBeLessThanOrEqual(fit.room);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});
