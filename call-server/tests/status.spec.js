import { test, expect, openAdmin, rawSocket, waitForStatus, HEARTBEAT_SECONDS } from "./helpers.js";

const badge = (page) => page.getByTestId("status-badge").first();

test("toggle Available and Away; when Away the Call button is disabled", async ({ open }) => {
  const visitor = await open("/call");
  await expect(badge(visitor)).toHaveAttribute("data-status", "away");
  await expect(visitor.getByTestId("status-message")).toHaveText("I'm away right now. Write to me on the Consultation page.");
  await expect(visitor.getByTestId("status-message").getByRole("link")).toHaveAttribute("href", "/consultation");
  await expect(visitor.getByTestId("call-button")).toBeDisabled();

  const admin = await openAdmin(open);
  await expect(badge(visitor)).toHaveAttribute("data-status", "available");
  await expect(badge(visitor)).toHaveText("Available");
  await expect(visitor.getByTestId("call-button")).toBeEnabled();
  await expect(visitor.getByTestId("status-message")).toHaveCount(0);

  await admin.getByTestId("set-away").click();
  await expect(badge(visitor)).toHaveAttribute("data-status", "away");
  await expect(visitor.getByTestId("call-button")).toBeDisabled();
  await admin.getByTestId("set-available").click();
  await expect(badge(visitor)).toHaveAttribute("data-status", "available");
});

test("it never turns Available by itself: signing in leaves the toggle where it was", async ({ open }) => {
  const admin = await openAdmin(open);
  await admin.getByTestId("set-away").click();
  await admin.close();
  const visitor = await open("/call");
  const again = await openAdmin(open, { available: false });
  await expect(again.getByTestId("set-away")).toHaveAttribute("aria-pressed", "true");
  await again.waitForTimeout(1500);
  await expect(badge(visitor)).toHaveAttribute("data-status", "away");
});

test("closing the admin page turns the status to Away; reopening it with the toggle on Available restores it", async ({ open }) => {
  const visitor = await open("/call");
  const admin = await openAdmin(open);
  await expect(badge(visitor)).toHaveAttribute("data-status", "available");

  await admin.close();
  await expect(badge(visitor)).toHaveAttribute("data-status", "away", { timeout: 5_000 });

  // The toggle is still on Available, so the status comes back without a click.
  const back = await openAdmin(open, { available: false });
  await expect(badge(visitor)).toHaveAttribute("data-status", "available");
  await expect(back.getByTestId("set-available")).toHaveAttribute("aria-pressed", "true");
});

test("an admin page that goes silent (phone asleep, no internet) counts as Away within a few seconds", async ({ open }) => {
  const visitor = await open("/call");
  // A connection that stops answering the server's heartbeat, like a phone
  // that went to sleep without closing anything.
  const phone = await rawSocket({ admin: true, autoPong: false });
  phone.send({ type: "set-away", away: false });
  await expect(badge(visitor)).toHaveAttribute("data-status", "available");
  const t0 = Date.now();
  await expect(badge(visitor)).toHaveAttribute("data-status", "away", { timeout: HEARTBEAT_SECONDS * 3000 + 2000 });
  expect(Date.now() - t0).toBeLessThan(HEARTBEAT_SECONDS * 3000 + 2000);
  phone.close();
});

test("with the admin page open on two devices, either one is enough for Available", async ({ open }) => {
  const visitor = await open("/call");
  const computer = await openAdmin(open);
  const phone = await openAdmin(open, { available: false });
  await expect(badge(visitor)).toHaveAttribute("data-status", "available");
  await computer.close();
  await visitor.waitForTimeout(1500);
  await expect(badge(visitor)).toHaveAttribute("data-status", "available");
  await phone.close();
  await expect(badge(visitor)).toHaveAttribute("data-status", "away", { timeout: 5_000 });
  await waitForStatus("away");
});
