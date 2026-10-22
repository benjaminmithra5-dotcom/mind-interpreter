import { test, expect, ADMIN_KEY } from "./helpers.js";

const dayIn = (iso, timeZone) => new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date(iso));

async function unlock(host, key = ADMIN_KEY) {
  await host.getByTestId("admin-key").fill(key);
  await host.getByTestId("admin-unlock").click();
}
async function openUnlocked(open, gas, opts) {
  await gas.property("ADMIN_KEY", ADMIN_KEY);
  const host = await open("/host", opts);
  await unlock(host);
  await expect(host.getByTestId("weekly-hours")).toBeVisible();
  return host;
}

test("the admin key: not set up, wrong, right (and kept for this tab only)", async ({ open, gas }) => {
  const host = await open("/host");
  await expect(host.getByTestId("availability").getByRole("heading")).toHaveText("Availability");
  await unlock(host, "anything-at-all");
  await expect(host.getByTestId("avail-error")).toHaveText(/The admin key isn't set up yet/);

  await gas.property("ADMIN_KEY", ADMIN_KEY);
  await unlock(host, "not-the-right-key");
  await expect(host.getByTestId("avail-error")).toHaveText("That key isn't right.");
  await unlock(host);
  await expect(host.getByTestId("weekly-hours")).toBeVisible();
  expect(await host.evaluate(() => sessionStorage.getItem("talk-now-admin-key"))).toBe(ADMIN_KEY);
  expect(await host.evaluate(() => localStorage.length)).toBe(0);

  await host.reload();
  await expect(host.getByTestId("weekly-hours")).toBeVisible();
  await host.getByTestId("admin-lock").click();
  await expect(host.getByTestId("admin-key-form")).toBeVisible();
  expect(await host.evaluate(() => sessionStorage.getItem("talk-now-admin-key"))).toBeNull();
});

test("5 wrong keys lock admin changes for 15 minutes", async ({ open, gas }) => {
  await gas.property("ADMIN_KEY", ADMIN_KEY);
  const host = await open("/host");
  for (let i = 0; i < 4; i++) {
    await unlock(host, `wrong-${i}`);
    await expect(host.getByTestId("avail-error")).toHaveText("That key isn't right.");
  }
  await unlock(host, "wrong-5");
  await expect(host.getByTestId("avail-error")).toHaveText(/^Too many wrong tries\. Please wait about \d+ minutes/);
  await unlock(host);
  await expect(host.getByTestId("avail-error")).toHaveText(/^Too many wrong tries/);
  await expect(host.getByTestId("weekly-hours")).toHaveCount(0);
});

test("the two switches change what /call shows", async ({ open, gas }) => {
  const host = await openUnlocked(open, gas);
  const immediate = host.getByTestId("switch-immediate");
  await expect(immediate).toHaveAttribute("aria-checked", "false");
  await immediate.click();
  await expect(immediate).toHaveAttribute("aria-checked", "true");
  await expect(host.getByTestId("avail-msg-switches")).toHaveText("Taking immediate calls: on.");
  expect(await gas.status()).toEqual({ immediate: true, paused: false });
  const client = await open("/call");
  await expect(client.getByTestId("immediate-form")).toBeVisible();

  await host.getByTestId("switch-paused").click();
  await expect(host.getByTestId("switch-paused")).toHaveAttribute("aria-checked", "true");
  await expect(host.getByTestId("preview")).toContainText("Booking is paused: clients see no times.");
  await client.reload();
  await expect(client.getByTestId("booking-paused")).toBeVisible();
  expect(await gas.slots()).toEqual([]);
});

test("weekly hours: change, check, save; the slots follow", async ({ open, gas }) => {
  const host = await openUnlocked(open, gas);
  for (const day of ["monday", "tuesday", "wednesday", "thursday", "friday", "saturday"]) {
    await host.locator(`[data-day-row="${day}"]`).getByLabel("Closed").check();
  }
  const sunday = host.locator('[data-day-row="sunday"]');
  await sunday.getByLabel("Closed").uncheck();
  await sunday.getByLabel("Sunday from").fill("10:00");
  await sunday.getByLabel("Sunday to").fill("09:00");
  await host.getByTestId("save-hours").click();
  await expect(host.getByTestId("avail-error")).toHaveText("Sunday: each start must be before its end.");

  await sunday.getByLabel("Sunday to").fill("12:00");
  await sunday.getByRole("button", { name: "Add a time range" }).click();
  await sunday.getByLabel("Sunday from").nth(1).fill("11:30");
  await sunday.getByLabel("Sunday to").nth(1).fill("14:00");
  await host.getByTestId("save-hours").click();
  await expect(host.getByTestId("avail-error")).toHaveText("Sunday: the times overlap.");
  await sunday.getByRole("button", { name: /^Remove Sunday 11:30/ }).click();

  await host.getByTestId("save-hours").click();
  await expect(host.getByTestId("avail-msg-hours")).toHaveText("Saved. Clients now see the new hours.");
  const slots = await gas.slots();
  expect(slots.length).toBeGreaterThan(0);
  for (const s of slots) {
    const parts = new Intl.DateTimeFormat("en-US", { timeZone: "Asia/Kolkata", weekday: "long", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).format(new Date(s));
    expect(parts).toMatch(/^Sunday (10:00|11:00)$/);
  }
  // The preview shows the same, in India time.
  const sundayRow = host.locator(`[data-preview-day="${dayIn(slots[0], "Asia/Kolkata")}"]`);
  await expect(sundayRow).toContainText(/10:00\sAM, 11:00\sAM/);
  // Reloading shows the saved hours.
  await host.reload();
  await expect(host.locator('[data-day-row="monday"]').getByLabel("Closed")).toBeChecked();
  await expect(host.locator('[data-day-row="sunday"]').getByLabel("Sunday from")).toHaveValue("10:00");
});

test("blocked times: block a day, see it in the list and the preview, remove it", async ({ open, gas }) => {
  const [first] = await gas.slots();
  const day = dayIn(first, "Asia/Kolkata");
  const host = await openUnlocked(open, gas);
  const row = host.locator(`[data-preview-day="${day}"]`);
  await expect(row).not.toContainText("No times");

  await host.getByTestId("block-date").fill(day);
  await host.getByTestId("block-note").fill("Family visit");
  await host.getByTestId("add-block").click();
  await expect(host.getByTestId("avail-msg-blocks")).toHaveText("Blocked.");
  await expect(host.locator(`[data-block-date="${day}"]`)).toContainText("whole day · Family visit");
  await expect(row).toContainText("No times");
  expect((await gas.slots()).some((s) => dayIn(s, "Asia/Kolkata") === day)).toBe(false);

  // Only a start time is refused kindly.
  await host.getByTestId("block-date").fill(day);
  await host.getByTestId("block-from").fill("19:00");
  await host.getByTestId("add-block").click();
  await expect(host.getByTestId("avail-error")).toHaveText("Please give both a start and an end time, or neither for the whole day.");

  await host.locator(`[data-block-date="${day}"]`).getByRole("button", { name: "Remove" }).click();
  await expect(host.getByTestId("avail-msg-blocks")).toHaveText("Removed.");
  await expect(row).not.toContainText("No times");
});

test("the availability section fits at 390px", async ({ open, gas }) => {
  const host = await openUnlocked(open, gas, { viewport: { width: 390, height: 844 } });
  await host.locator('[data-day-row="monday"]').getByRole("button", { name: "Add a time range" }).click();
  expect(await host.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});
