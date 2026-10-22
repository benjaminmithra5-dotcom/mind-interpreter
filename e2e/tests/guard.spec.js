import { test, expect, openHost, joinAsGuest, startCall, clockSeconds, CALL_LIMIT } from "./helpers.js";

// Press the browser's Back button (Android Back and iOS swipe-back do the same).
const pressBack = (page) => page.evaluate(() => history.back());
const dialog = (page) => page.getByTestId("leave-dialog");

test("Back while waiting asks first, and the guest stays in the waiting room", async ({ open, gas }) => {
  const { code } = await gas.booking();
  const host = await openHost(open, code);
  const guest = await open(`/call?room=${code}`);
  await joinAsGuest(guest, code, "Asha");
  await expect(guest.getByTestId("waiting")).toBeVisible();
  await expect(host.getByTestId("guest-waiting")).toBeVisible();

  await pressBack(guest);
  await expect(dialog(guest)).toBeVisible();
  await expect(dialog(guest).getByRole("heading")).toHaveText("Leave the call?");
  await expect(guest.getByTestId("stay-in-call")).toBeFocused();
  await expect(guest).toHaveURL(new RegExp(`/call\\?room=${code}$`));
  await expect(guest.getByTestId("waiting")).toBeVisible();
  await guest.getByTestId("stay-in-call").click();
  await expect(dialog(guest)).toHaveCount(0);
  await expect(guest.getByTestId("waiting")).toBeVisible();
  await expect(host.getByTestId("guest-waiting")).toBeVisible();

  // The host's Back is guarded too while the room is open.
  await pressBack(host);
  await expect(dialog(host)).toBeVisible();
  await host.keyboard.press("Escape");
  await expect(dialog(host)).toHaveCount(0);
  await expect(host.getByTestId("room-status")).toHaveAttribute("data-state", "open");
  // Pressing Back again (twice) still asks, and still stays.
  await pressBack(guest);
  await pressBack(guest);
  await expect(dialog(guest)).toBeVisible();
  await expect(guest.getByTestId("waiting")).toBeVisible();
});

test("Back during a live call asks on both pages; Stay keeps the call and the timer running", async ({ open, gas }) => {
  const { host, guest } = await startCall(open, gas);
  for (const [page, other] of [[guest, host], [host, guest]]) {
    await pressBack(page);
    await expect(dialog(page)).toBeVisible();
    // The call stays up behind the dialog, and the timer keeps going.
    const before = await clockSeconds(other);
    await expect.poll(() => clockSeconds(other)).toBeLessThan(before - 2);
    await expect(page.getByTestId("call-screen")).toHaveAttribute("data-call-state", "in-call");
    await expect(other.getByTestId("call-screen")).toHaveAttribute("data-call-state", "in-call");
    await page.getByTestId("stay-in-call").click();
    await expect(dialog(page)).toHaveCount(0);
    const now = await clockSeconds(page);
    await expect.poll(() => clockSeconds(page)).toBeLessThan(now);
  }
  await expect(guest).toHaveURL(/\/call\?room=/);
  await expect(host).toHaveURL(/\/host$/);
});

test("Leave ends the call and goes back", async ({ open, gas }) => {
  const { host, guest } = await startCall(open, gas);
  await pressBack(guest);
  await guest.getByTestId("leave-call").click();
  await expect(host.getByTestId("host-notice")).toHaveText("Your guest ended the call.");
  await expect(guest).not.toHaveURL(/\/call/);

  // The host leaving closes the room.
  await pressBack(host);
  await host.getByTestId("leave-call").click();
  await expect(host).not.toHaveURL(/\/host$/);
});

test("in-site links (nav menu, footer, the ← button) ask first while a call is live", async ({ open, gas }) => {
  const { host, guest } = await startCall(open, gas);
  await guest.getByRole("button", { name: "Menu" }).click();
  await guest.getByRole("link", { name: "Brain Games" }).click();
  await expect(dialog(guest)).toBeVisible();
  await guest.getByTestId("stay-in-call").click();
  await expect(guest).toHaveURL(/\/call\?room=/);
  await expect(guest.getByTestId("call-screen")).toHaveAttribute("data-call-state", "in-call");

  await guest.getByRole("link", { name: "Privacy" }).click();
  await expect(dialog(guest)).toBeVisible();
  await guest.getByTestId("stay-in-call").click();
  await expect(guest).toHaveURL(/\/call\?room=/);

  await guest.getByRole("button", { name: "Back", exact: true }).click();
  await expect(dialog(guest)).toBeVisible();
  await guest.getByTestId("leave-call").click();
  await expect(guest).toHaveURL(/\/$/);
  await expect(host.getByTestId("host-notice")).toHaveText("Your guest ended the call.");
});

test("refresh during a call shows the browser's leave warning", async ({ open, gas }) => {
  const { host, guest } = await startCall(open, gas);
  const seen = new Promise((resolve) => guest.once("dialog", async (d) => { resolve(d.type()); await d.dismiss(); }));
  guest.reload().catch(() => {});
  expect(await seen).toBe("beforeunload");
  await expect(guest.getByTestId("call-screen")).toHaveAttribute("data-call-state", "in-call");
  await expect(host.getByTestId("call-screen")).toHaveAttribute("data-call-state", "in-call");
});

test("a guest who leaves and rejoins is admitted again with the time that was left", async ({ open, gas }) => {
  const { host, guest, code } = await startCall(open, gas, "Asha");
  await expect.poll(() => clockSeconds(host)).toBeLessThan(CALL_LIMIT - 10);
  await pressBack(guest);
  await guest.getByTestId("leave-call").click();
  await expect(host.getByTestId("host-notice")).toHaveText("Your guest ended the call.");
  const left = await host.evaluate(() => JSON.parse(sessionStorage.getItem("talk-now-host")).remaining);
  expect(left).toBeLessThan(CALL_LIMIT - 10);

  await guest.goto(`/call?room=${code}`);
  await joinAsGuest(guest, code, "Asha");
  await expect(guest.getByTestId("waiting")).toBeVisible();
  await expect(host.getByTestId("guest-name")).toHaveText("Returning guest: Asha");
  await expect(host.getByTestId("guest-waiting")).toContainText(/continues with the time left/);
  await host.getByTestId("admit").click();
  await expect(guest.getByTestId("call-screen")).toHaveAttribute("data-call-state", "in-call");
  const resumed = await clockSeconds(guest);
  expect(resumed).toBeLessThanOrEqual(left);
  expect(resumed).toBeGreaterThan(left - 10);
});

test("after the host's page is reloaded, the same code reopens the room with the time left", async ({ open, gas }) => {
  const { host, guest, code } = await startCall(open, gas, "Asha");
  await expect.poll(() => clockSeconds(host)).toBeLessThan(CALL_LIMIT - 10);
  host.on("dialog", (d) => d.accept()); // confirm "Leave site?"
  await host.reload();
  await expect(guest.getByTestId("reconnecting-banner")).toContainText("Reconnecting…");
  const left = await host.evaluate(() => JSON.parse(sessionStorage.getItem("talk-now-host")).remaining);
  await expect(host.getByTestId("host-resume-hint")).toContainText("paste the same code again");

  await host.getByTestId("host-code").fill(code);
  await host.getByTestId("open-room").click();
  await expect(host.getByTestId("room-status")).toHaveAttribute("data-state", "open");
  // The guest's page finds the room again and waits to be let back in.
  await expect(host.getByTestId("guest-name")).toHaveText("Returning guest: Asha", { timeout: 20_000 });
  await expect(guest.getByTestId("waiting")).toBeVisible();
  await host.getByTestId("admit").click();
  await expect(guest.getByTestId("call-screen")).toHaveAttribute("data-call-state", "in-call");
  const resumed = await clockSeconds(guest);
  expect(resumed).toBeLessThanOrEqual(left);
  expect(resumed).toBeGreaterThan(left - 10);
});
