import { test, expect, openHost, joinAsGuest, ADMIN_KEY } from "./helpers.js";

const fill = async (page, { name = "Asha Rao", email = "asha@example.com", phone = "+91 98765 43210" } = {}) => {
  const form = page.getByTestId("immediate-form");
  await form.getByLabel("Your name").fill(name);
  await form.getByLabel("Your email").fill(email);
  await form.getByLabel("Phone number, with country code").fill(phone);
};
async function turnOn(gas) {
  await gas.property("ADMIN_KEY", ADMIN_KEY);
  expect((await gas.admin("setImmediate", ADMIN_KEY, { on: true })).ok).toBe(true);
}

test("the order is Join, then Need to talk right now?, then Book a time; immediate calls are off by default", async ({ open }) => {
  const page = await open("/call");
  await expect(page.getByTestId("immediate-section")).toBeVisible();
  expect(await page.getByRole("heading", { level: 2 }).allTextContents()).toEqual(["Join your call", "Need to talk right now?", "Book a time"]);
  await expect(page.getByTestId("immediate-off")).toHaveText("I'm not taking immediate calls right now. You can book a time below.");
  await expect(page.getByTestId("immediate-form")).toHaveCount(0);
  await expect(page.getByTestId("calendar")).toBeVisible();
});

test("immediate on: the form, validation, the honeypot, then a request", async ({ open, gas }) => {
  await turnOn(gas);
  const page = await open("/call");
  const section = page.getByTestId("immediate-section");
  await expect(section.getByText("$9.80 for 45 minutes. Audio call. I will email you a code within a few minutes if I am free.")).toBeVisible();
  await expect(section.getByText("Check your spam folder, and add benjamin@benjaminmithra.com to your contacts so it reaches you.")).toBeVisible();

  await page.getByTestId("immediate-submit").click();
  await expect(section.getByText("Please enter your name.")).toBeVisible();
  await expect(section.getByText("Please enter a valid email address.")).toBeVisible();
  await expect(section.getByText(/Please enter your phone number with the country code/)).toBeVisible();

  await fill(page, { phone: "98765 43210" });
  await page.getByTestId("immediate-submit").click();
  await expect(section.getByText(/Please enter your phone number with the country code/)).toBeVisible();

  await section.getByLabel("Phone number, with country code").fill("+91 98765 43210");
  await page.getByTestId("immediate-submit").click();
  await expect(page.getByTestId("immediate-done")).toHaveText("Request received. Keep an eye on your email.");
  const [b] = await gas.bookings();
  expect(b.type).toBe("immediate");
  expect(b.timezone).toBe("Asia/Kolkata");
  const [mail] = await gas.mails();
  expect(mail.subject).toBe("Immediate Talk: Asha Rao");
  expect(await gas.events()).toEqual([]);
});

test("immediate: the honeypot quietly drops the request", async ({ open, gas }) => {
  await turnOn(gas);
  const page = await open("/call");
  await fill(page);
  await page.getByTestId("immediate-form").locator('input[name="website"]').fill("http://spam.example", { force: true });
  await page.getByTestId("immediate-submit").click();
  await expect(page.getByTestId("immediate-done")).toBeVisible();
  expect(await gas.bookings()).toEqual([]);
  expect(await gas.mails()).toEqual([]);
});

test("immediate: one waiting request per email, and at most 5 waiting at once", async ({ open, gas }) => {
  await turnOn(gas);
  expect((await gas.immediate({ name: "Asha", email: "asha@example.com", phone: "+91 98765 43210" })).ok).toBe(true);
  const page = await open("/call");
  await fill(page, { email: "ASHA@example.com" });
  await page.getByTestId("immediate-submit").click();
  await expect(page.getByTestId("immediate-notice")).toHaveText("You already have a request waiting. I'll email you once I've seen it.");

  for (let i = 2; i <= 5; i++) expect((await gas.immediate({ name: `P${i}`, email: `p${i}@example.com`, phone: "+91 98765 43210" })).ok).toBe(true);
  await page.getByTestId("immediate-form").getByLabel("Your email").fill("sixth@example.com");
  await page.getByTestId("immediate-submit").click();
  await expect(page.getByTestId("immediate-notice")).toHaveText("I have a few requests waiting right now. Please try again in a little while, or book a time below.");
});

test("immediate switched off while the form is open: the page says so", async ({ open, gas }) => {
  await turnOn(gas);
  const page = await open("/call");
  await fill(page);
  await gas.admin("setImmediate", ADMIN_KEY, { on: false });
  await page.getByTestId("immediate-submit").click();
  await expect(page.getByTestId("immediate-off")).toBeVisible();
  await expect(page.getByTestId("immediate-form")).toHaveCount(0);
});

test("paused: the booking sections say so; Join still works", async ({ open, gas }) => {
  await gas.property("ADMIN_KEY", ADMIN_KEY);
  await gas.admin("setImmediate", ADMIN_KEY, { on: true });
  await gas.admin("setPaused", ADMIN_KEY, { on: true });
  const page = await open("/call");
  await expect(page.getByTestId("booking-paused")).toHaveText("Booking is paused right now. Please check back soon.");
  await expect(page.getByTestId("immediate-section")).toHaveCount(0);
  await expect(page.getByTestId("book-section")).toHaveCount(0);
  await expect(page.getByTestId("join-form")).toBeVisible();
});

test("an approved immediate request starts now: the client's code opens the room", async ({ open, gas }) => {
  await turnOn(gas);
  const page = await open("/call");
  await fill(page);
  await page.getByTestId("immediate-submit").click();
  await expect(page.getByTestId("immediate-done")).toBeVisible();

  const [mail] = await gas.mails();
  const approve = mail.htmlBody.match(/href="([^"]*action=approve[^"]*)"/)[1].replace(/&amp;/g, "&");
  const owner = await open(approve);
  await expect(owner.getByText(/wants to talk now/)).toBeVisible();
  await owner.getByRole("button", { name: "Approve" }).click();
  await expect(owner.getByRole("status")).toHaveText(/^Approved\./);

  const [b] = await gas.bookings();
  expect(Math.abs(Date.parse(b.start) - Date.now())).toBeLessThan(2 * 60_000);
  const client = (await gas.mails()).find((m) => m.to === "asha@example.com");
  expect(client.body).toContain("Your call is ready now. The room is open for you.");
  expect((await gas.events())[0].title).toBe("Immediate Talk: Asha Rao");

  const host = await openHost(open, b.code);
  const guest = await open(`/call?room=${b.code}`);
  await joinAsGuest(guest, b.code, "Asha");
  await expect(host.getByTestId("guest-name")).toHaveText("Asha is waiting.");
  await host.getByTestId("admit").click();
  await expect(guest.getByTestId("call-screen")).toHaveAttribute("data-call-state", "in-call");
});
