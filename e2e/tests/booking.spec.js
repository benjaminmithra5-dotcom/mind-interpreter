import { test, expect } from "./helpers.js";
import { tidyZone } from "../../src/call/timezones.js";

// The calendar date of a moment in a zone, as "YYYY-MM-DD".
const dayIn = (iso, timeZone) => new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date(iso));

async function chooseSlot(page, iso, tz = "Asia/Kolkata") {
  await page.locator(`[data-day="${dayIn(iso, tz)}"]`).click();
  await page.locator(`[data-slot="${iso}"]`).click();
  await expect(page.getByTestId("book-form")).toBeVisible();
}
async function fillDetails(page, { name = "Asha Rao", email = "asha@example.com", phone = "+91 98765 43210" } = {}) {
  await page.getByLabel("Your name", { exact: true }).last().fill(name);
  await page.getByLabel("Your email").fill(email);
  await page.getByLabel("WhatsApp number (with country code)").fill(phone);
}

test("the page shows Join first, then Need to talk right now?, then Book a time, with the price and notices", async ({ open }) => {
  const page = await open("/call");
  await expect(page.getByTestId("book-section")).toBeVisible();
  const headings = await page.getByRole("heading", { level: 2 }).allTextContents();
  expect(headings).toEqual(["Join your call", "Need to talk right now?", "Book a time"]);
  await expect(page.getByText("$9.80 for 45 minutes. Audio call.")).toBeVisible();
  await expect(page.getByText("I will review your request and send your code on WhatsApp.")).toBeVisible();
  await expect(page.getByTestId("privacy-notice")).toHaveText("Your call is private and goes directly between us. It is not recorded.");
  await expect(page.getByTestId("crisis-notice")).toHaveText("This is not an emergency service. If you are in crisis, contact your local emergency services or a crisis line right away (for example, 988 in the US).");
  await expect(page.locator('meta[name="robots"]')).toHaveAttribute("content", /noindex/);
  const body = await page.locator("body").innerText();
  expect(body).not.toMatch(/per minute|\/min\b/i);
});

test("time zones: the visitor's own zone by default, with abbreviation, name, city and country", async ({ open }) => {
  const page = await open("/call");
  const input = page.getByTestId("tz-input");
  await expect(input).toHaveValue("(UTC+05:30) IST · India Standard Time · Kolkata, India");
  await expect(page.getByTestId("tz-note")).toHaveText("Times are shown in IST (UTC+05:30), Kolkata, India.");
});

test("time zones: every zone the browser knows is listed, sorted by offset", async ({ open }) => {
  const page = await open("/call");
  await expect(page.getByTestId("tz-input")).toHaveValue(/IST/);
  await page.getByTestId("tz-input").click();
  const options = page.locator('[data-testid="tz-list"] [role="option"]');
  const listed = new Set(await options.evaluateAll((els) => els.map((e) => e.dataset.zone)));
  const supported = await page.evaluate(() => Intl.supportedValuesOf("timeZone"));
  for (const z of supported) expect(listed.has(tidyZone(z)), z).toBe(true);
  const labels = await options.allTextContents();
  const offsets = labels.map((l) => {
    const m = l.match(/^\(UTC([+−])(\d{2}):(\d{2})\)/);
    return (m[1] === "−" ? -1 : 1) * (Number(m[2]) * 60 + Number(m[3]));
  });
  for (let i = 1; i < offsets.length; i++) expect(offsets[i]).toBeGreaterThanOrEqual(offsets[i - 1]);
  expect(labels).toContain("(UTC+14:00) LINT · Line Islands Time · Kiritimati, Kiribati");
  expect(labels).toContain("(UTC−11:00) GMT−11 · American Samoa Standard Time · Pago Pago, American Samoa");
  expect(labels).toContain("(UTC+05:45) NPT · Nepal Time · Kathmandu, Nepal");
});

test("time zones: searching by abbreviation, country, city and offset", async ({ open }) => {
  const page = await open("/call");
  const input = page.getByTestId("tz-input");
  await expect(input).toHaveValue(/IST/);
  const results = () => page.locator('[data-testid="tz-list"] [role="option"]');

  await input.fill("ist");
  await expect(results().first()).toHaveText(/\) IST · /);
  await expect(page.locator('[data-zone="Asia/Kolkata"]')).toBeVisible();

  // CST is several zones: each shows its country.
  await input.fill("cst");
  for (const [zone, country] of [["Asia/Shanghai", "China"], ["America/Chicago", "United States"], ["America/Havana", "Cuba"]]) {
    await expect(page.locator(`[data-zone="${zone}"]`)).toContainText(country);
  }

  await input.fill("india");
  await expect(results().first()).toHaveAttribute("data-zone", "Asia/Kolkata");
  await input.fill("chicago");
  await expect(results().first()).toHaveAttribute("data-zone", "America/Chicago");
  await input.fill("sao paulo");
  await expect(results().first()).toHaveAttribute("data-zone", "America/Sao_Paulo");
  for (const q of ["+5:30", "+05:30", "gmt+5:30"]) {
    await input.fill(q);
    await expect(page.locator('[data-zone="Asia/Kolkata"]')).toBeVisible();
    for (const l of await results().allTextContents()) expect(l.startsWith("(UTC+05:30)")).toBe(true);
  }
  await input.fill("+05:45");
  await expect(results()).toHaveText(["(UTC+05:45) NPT · Nepal Time · Kathmandu, Nepal"]);

  // Keyboard: arrows and Enter choose; the field then shows the full label.
  await input.fill("chicago");
  await input.press("ArrowDown");
  await input.press("ArrowUp");
  await input.press("Enter");
  await expect(input).toHaveValue(/^\(UTC−0[56]:00\) C[SD]T · Central (Standard|Daylight) Time · Chicago, United States$/);
  await expect(page.getByTestId("tz-note")).toHaveText(/^Times are shown in C[SD]T \(UTC−0[56]:00\), Chicago, United States\.$/);
  // Escape closes without changing the zone.
  await input.click();
  await input.fill("london");
  await input.press("Escape");
  await expect(page.getByTestId("tz-list")).toHaveCount(0);
  await expect(input).toHaveValue(/Chicago, United States$/);
});

test("London shows GMT or BST, whichever applies today", async ({ open }) => {
  const page = await open("/call", { timezoneId: "Europe/London" });
  // British Summer Time when London is an hour ahead of UTC today.
  const summer = await page.evaluate(() => new Intl.DateTimeFormat("en-US", { timeZone: "Europe/London", timeZoneName: "shortOffset" }).format(new Date()).endsWith("GMT+1"));
  await expect(page.getByTestId("tz-input")).toHaveValue(summer
    ? "(UTC+01:00) BST · British Summer Time · London, United Kingdom"
    : "(UTC+00:00) GMT · Greenwich Mean Time · London, United Kingdom");
});

test("slots are shown in the chosen zone, including a half-hour zone and one across the date line", async ({ open, gas }) => {
  const slots = await gas.slots();
  const first = slots[0]; // 18:00 in India
  const page = await open("/call");
  await expect(page.getByTestId("tz-note")).toHaveText("Times are shown in IST (UTC+05:30), Kolkata, India.");
  await page.locator(`[data-day="${dayIn(first, "Asia/Kolkata")}"]`).click();
  await expect(page.locator(`[data-slot="${first}"]`)).toHaveText(/^6:00\sPM$/);

  // Kiritimati is UTC+14: 18:00 in India is 02:30 the next day there.
  await page.getByTestId("tz-input").fill("kiritimati");
  await page.locator('[data-zone="Pacific/Kiritimati"]').click();
  await expect(page.getByTestId("tz-note")).toHaveText("Times are shown in LINT (UTC+14:00), Kiritimati, Kiribati.");
  const kDay = dayIn(first, "Pacific/Kiritimati");
  expect(kDay > dayIn(first, "Asia/Kolkata")).toBe(true);
  await page.locator(`[data-day="${kDay}"]`).click();
  await expect(page.locator(`[data-slot="${first}"]`)).toHaveText(/^2:30\sAM$/);

  // Pago Pago is UTC−11: the same moment is 01:30 on the India date.
  await page.getByTestId("tz-input").fill("pago");
  await page.locator('[data-zone="Pacific/Pago_Pago"]').click();
  await expect(page.getByTestId("tz-note")).toHaveText("Times are shown in GMT−11 (UTC−11:00), Pago Pago, American Samoa.");
  await page.locator(`[data-day="${dayIn(first, "Pacific/Pago_Pago")}"]`).click();
  await expect(page.locator(`[data-slot="${first}"]`)).toHaveText(/^1:30\sAM$/);

  // Kathmandu is UTC+05:45: 15 minutes after India.
  await page.getByTestId("tz-input").fill("kathmandu");
  await page.locator('[data-zone="Asia/Kathmandu"]').click();
  await page.locator(`[data-day="${dayIn(first, "Asia/Kathmandu")}"]`).click();
  await expect(page.locator(`[data-slot="${first}"]`)).toHaveText(/^6:15\sPM$/);
});

test("time zones at 390px: long labels wrap, nothing spills sideways", async ({ open }) => {
  const page = await open("/call", { viewport: { width: 390, height: 844 } });
  const input = page.getByTestId("tz-input");
  await expect(input).toHaveValue(/IST/);
  const box = await input.boundingBox();
  expect(box.height).toBeGreaterThan(50); // the label takes two lines
  await input.click();
  await input.fill("cst");
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  const widest = await page.locator('[data-testid="tz-list"] [role="option"]').evaluateAll((els) => Math.max(...els.map((e) => e.scrollWidth - e.clientWidth)));
  expect(widest).toBeLessThanOrEqual(1);
});

test("booking: validation, then a request is sent without the code", async ({ open, gas }) => {
  const [slot] = await gas.slots();
  const page = await open("/call");
  await chooseSlot(page, slot);
  await page.getByTestId("book-submit").click();
  await expect(page.getByText("Please enter your name.")).toBeVisible();
  await expect(page.getByText("Please enter a valid email address.")).toBeVisible();
  await expect(page.getByText("Please check your WhatsApp number. Include the country code, for example +91 98765 43210.")).toBeVisible();
  await expect(page.getByText("I will send your code on WhatsApp.")).toBeVisible();

  await fillDetails(page, { phone: "+91 98765" });
  await page.getByTestId("book-submit").click();
  await expect(page.getByText(/Please check your WhatsApp number/)).toBeVisible();
  await expect(page.getByText("Please enter your name.")).toHaveCount(0);

  await page.getByLabel("WhatsApp number (with country code)").fill("+91 (98765) 432-10");
  await page.getByTestId("book-submit").click();
  await expect(page.getByTestId("book-done")).toContainText("Request received. I will review it and send your code on WhatsApp to +919876543210. Please keep WhatsApp ready.");
  await expect(page.getByTestId("book-done")).not.toContainText("spam");

  const [booking] = await gas.bookings();
  expect(booking.status).toBe("pending");
  expect(booking.phone).toBe("+919876543210");
  expect(booking.timezone).toBe("Asia/Kolkata");
  expect(booking.start).toBe(slot);
  const [mail] = await gas.mails();
  expect(mail.to).toBe("benjamin@benjaminmithra.com");
  expect(mail.htmlBody).toContain("Asha Rao");
  expect(mail.htmlBody).toContain("https://wa.me/919876543210");
  expect(mail.htmlBody).not.toContain(booking.code);
  const [event] = await gas.events();
  expect(event.title).toBe("Talk now: Asha Rao (pending)");
});

test("booking: the hidden honeypot field quietly drops the request", async ({ open, gas }) => {
  const [slot] = await gas.slots();
  const page = await open("/call");
  await chooseSlot(page, slot);
  await fillDetails(page);
  await page.locator('input[name="website"]').fill("http://spam.example", { force: true });
  await page.getByTestId("book-submit").click();
  await expect(page.getByTestId("book-done")).toBeVisible();
  expect(await gas.bookings()).toEqual([]);
  expect(await gas.mails()).toEqual([]);
});

test("booking: one waiting request per email", async ({ open, gas }) => {
  const slots = await gas.slots();
  expect((await gas.book({ name: "Asha Rao", email: "asha@example.com", phone: "+91 98765 43210", timezone: "Asia/Kolkata", start: slots[0] })).ok).toBe(true);
  const page = await open("/call");
  await chooseSlot(page, slots[1]);
  await fillDetails(page, { email: "ASHA@example.com" });
  await page.getByTestId("book-submit").click();
  await expect(page.getByTestId("book-notice")).toHaveText("You already have a request waiting. I'll send your code on WhatsApp once I've reviewed it.");
  expect((await gas.bookings()).length).toBe(1);
});

test("booking: a time taken a moment ago is refused kindly and the list refreshes", async ({ open, gas }) => {
  const slots = await gas.slots();
  const page = await open("/call");
  await chooseSlot(page, slots[0]);
  await fillDetails(page);
  // Someone else books the same time first.
  expect((await gas.book({ name: "Other", email: "other@example.com", phone: "+44 7700 900123", timezone: "Europe/London", start: slots[0] })).ok).toBe(true);
  await page.getByTestId("book-submit").click();
  await expect(page.getByTestId("book-notice")).toHaveText("Sorry, that time was just taken. Please choose another time.");
  await expect(page.locator(`[data-slot="${slots[0]}"]`)).toHaveCount(0);
  await expect(page.getByTestId("book-form")).toHaveCount(0);
  // A different time still works.
  await chooseSlot(page, slots[1]);
  await page.getByTestId("book-submit").click();
  await expect(page.getByTestId("book-done")).toBeVisible();
});

test("the owner approves from the email link; the page shows the WhatsApp button, and no email goes to the client", async ({ open, gas }) => {
  const [slot] = await gas.slots();
  await gas.book({ name: "Asha Rao", email: "asha@example.com", phone: "+91 98765 43210", timezone: "Europe/London", start: slot });
  const [mail] = await gas.mails();
  const approve = mail.htmlBody.match(/href="([^"]*action=approve[^"]*)"/)[1].replace(/&amp;/g, "&");
  const owner = await open(approve, { permissions: ["clipboard-read", "clipboard-write"] });
  await expect(owner.getByRole("heading")).toHaveText("Approve this request?");
  expect((await gas.bookings())[0].status).toBe("pending");
  await owner.getByRole("button", { name: "Approve" }).click();
  await expect(owner.getByRole("status")).toHaveText("Approved.");
  const [booking] = await gas.bookings();
  expect(booking.status).toBe("approved");

  // The big button opens WhatsApp outside the Apps Script frame, with the message ready.
  const wa = owner.getByRole("link", { name: "Send the code on WhatsApp" });
  await expect(wa).toBeVisible();
  await expect(wa).toHaveAttribute("target", "_top");
  const href = await wa.getAttribute("href");
  const text = await owner.locator("#text").inputValue();
  expect(href).toBe(`https://wa.me/919876543210?text=${encodeURIComponent(text)}`);
  for (const part of ["Asha Rao", "(your time, Europe/London)", "in India", booking.code, `https://benjaminmithra.com/call?room=${booking.code}`, "Please use headphones or over-ear headphones."]) {
    expect(text).toContain(part);
  }
  // Copy message, in case WhatsApp doesn't open.
  await owner.getByRole("button", { name: "Copy message" }).click();
  await expect(owner.locator("#copied")).toHaveText("Copied.");

  // No code email to the client; the owner gets a copy with the same button.
  const mails = await gas.mails();
  expect(mails.find((m) => m.to === "asha@example.com")).toBeUndefined();
  const copy = mails.at(-1);
  expect(copy.to).toBe("benjamin@benjaminmithra.com");
  expect(copy.body).toContain(`Send the code on WhatsApp: ${href}`);

  // The link only works once.
  await owner.goto(approve);
  await expect(owner.getByText("This link has already been used, or the request is no longer waiting.")).toBeVisible();
});

test("the approved page fits at 390px", async ({ open, gas }) => {
  const [slot] = await gas.slots();
  await gas.book({ name: "Asha Rao", email: "asha@example.com", phone: "+91 98765 43210", timezone: "Europe/London", start: slot });
  const [mail] = await gas.mails();
  const approve = mail.htmlBody.match(/href="([^"]*action=approve[^"]*)"/)[1].replace(/&amp;/g, "&");
  const owner = await open(approve, { viewport: { width: 390, height: 844 } });
  await owner.getByRole("button", { name: "Approve" }).click();
  await expect(owner.getByRole("link", { name: "Send the code on WhatsApp" })).toBeVisible();
  expect(await owner.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});

test("works at 390px with no sideways scroll", async ({ open, gas }) => {
  const [slot] = await gas.slots();
  const page = await open("/call", { viewport: { width: 390, height: 844 } });
  await page.getByTestId("tz-input").click();
  await page.getByTestId("tz-input").press("Escape");
  await expect(page.getByTestId("tz-input")).toHaveValue(/IST/);
  await chooseSlot(page, slot);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});

test("time zones: typing straight after leaving the field keeps the list open", async ({ open }) => {
  const page = await open("/call");
  const input = page.getByTestId("tz-input");
  await expect(input).toHaveValue(/IST/);
  for (let i = 0; i < 5; i++) {
    // Leave the field (a click elsewhere), then type in it again at once.
    await page.evaluate(() => {
      const el = document.querySelector('[data-testid="tz-input"]');
      el.focus();
      el.blur();
      el.focus();
    });
    await input.fill(i % 2 ? "pago" : "kiritimati");
    await page.waitForTimeout(250); // longer than the close delay
    await expect(page.getByTestId("tz-list")).toBeVisible();
    await expect(page.locator(`[data-zone="${i % 2 ? "Pacific/Pago_Pago" : "Pacific/Kiritimati"}"]`)).toBeVisible();
    await input.press("Escape");
  }
});
