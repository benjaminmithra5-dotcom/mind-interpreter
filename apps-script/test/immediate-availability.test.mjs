// Unit tests for Immediate Talk and the website-managed availability in
// Code.gs, run in Node against fake Google services.
// Run with: node --test apps-script/test/*.test.mjs
import { test } from "node:test";
import assert from "node:assert/strict";
import { createGas } from "./gas-mock.mjs";

// Monday 2 November 2026, 05:30 in India.
const NOW = "2026-11-02T00:00:00Z";
const IST = (date, time) => new Date(`${date}T${time}:00+05:30`).toISOString();
const KEY = "test-admin-key-0123456789abcdef";
const CLIENT = { name: "Asha Rao", email: "asha@example.com", phone: "+91 98765 43210", timezone: "Europe/London" };

function setup({ key = KEY, settings } = {}) {
  const gas = createGas({ now: Date.parse(NOW), settings });
  if (key) gas.props.set("ADMIN_KEY", key);
  return gas;
}
const admin = (gas, action, extra = {}, key = KEY) => gas.post({ action, key, ...extra });
const immediate = (gas, extra = {}) => gas.post({ action: "immediate", ...CLIENT, ...extra });
const turnOn = (gas) => assert.equal(admin(gas, "setImmediate", { on: true }).ok, true);
function links(html) {
  const get = (action) => {
    const m = html.match(new RegExp(`\\?action=${action}&amp;id=([^&]+)&amp;token=([0-9a-f]+)`));
    return { id: decodeURIComponent(m[1]), token: m[2] };
  };
  return { approve: get("approve"), decline: get("decline") };
}

// ---- status ------------------------------------------------------------------
test("status: only { immediate, paused }, both off by default", () => {
  const gas = setup();
  assert.deepEqual(gas.get({ action: "status" }), { immediate: false, paused: false });
  turnOn(gas);
  admin(gas, "setPaused", { on: true });
  assert.deepEqual(gas.get({ action: "status" }), { immediate: true, paused: true });
});

// ---- immediate requests ----------------------------------------------------------
test("immediate: refused while off or paused", () => {
  const gas = setup();
  assert.deepEqual(immediate(gas), { ok: false, error: "immediate-off" });
  turnOn(gas);
  admin(gas, "setPaused", { on: true });
  assert.deepEqual(immediate(gas), { ok: false, error: "paused" });
  assert.equal(gas.bookings().length, 0);
  assert.equal(gas.mails.length, 0);
});

test("immediate: validation and the honeypot", () => {
  const gas = setup();
  turnOn(gas);
  assert.deepEqual(immediate(gas, { name: "", email: "x@", phone: "98765" }).fields, ["name", "email", "phone"]);
  assert.deepEqual(immediate(gas, { phone: "+91 123" }).fields, ["phone"]);
  assert.deepEqual(immediate(gas, { website: "http://spam.example" }), { ok: true });
  assert.equal(gas.bookings().length, 0);
  assert.equal(gas.mails.length, 0);
});

test("immediate: stored without a calendar event; the owner gets an Immediate Talk email", () => {
  const gas = setup();
  turnOn(gas);
  assert.deepEqual(immediate(gas), { ok: true });
  const [b] = gas.bookings();
  assert.equal(b.type, "immediate");
  assert.equal(b.status, "pending");
  assert.equal(b.start, null);
  assert.equal(gas.events.length, 0);
  const [m] = gas.mails;
  assert.equal(m.to, "benjamin@benjaminmithra.com");
  assert.equal(m.subject, "Immediate Talk: Asha Rao");
  assert.equal(m.replyTo, "asha@example.com");
  for (const part of ["Asha Rao", "asha@example.com", "+91 98765 43210", 'href="https://wa.me/919876543210"']) assert.ok(m.htmlBody.includes(part), part);
  const { approve, decline } = links(m.htmlBody);
  assert.equal(approve.token, b.approveToken);
  assert.equal(decline.token, b.declineToken);
  assert.ok(!m.htmlBody.includes(b.code) && !m.body.includes(b.code), "no code yet");
});

test("immediate: one waiting request per email (including booked ones), and at most 5 immediate at once", () => {
  const gas = setup();
  turnOn(gas);
  assert.equal(gas.post({ action: "book", ...CLIENT, start: IST("2026-11-02", "19:00") }).ok, true);
  assert.deepEqual(immediate(gas, { email: "ASHA@example.com" }), { ok: false, error: "pending-exists" });
  for (let i = 1; i <= 5; i++) assert.equal(immediate(gas, { email: `p${i}@example.com` }).ok, true);
  assert.deepEqual(immediate(gas, { email: "p6@example.com" }), { ok: false, error: "busy" });
  assert.equal(gas.bookings().filter((b) => b.type === "immediate").length, 5);
});

test("immediate approve: starts at the moment of approval, books the calendar, emails the code", () => {
  const gas = setup();
  turnOn(gas);
  gas.setNow("2026-11-02T10:01:00Z");
  immediate(gas);
  const { approve } = links(gas.mails[0].htmlBody);
  assert.match(gas.get({ action: "approve", ...approve }).html, /wants to talk now/);

  gas.setNow("2026-11-02T10:07:31Z");
  assert.match(gas.context.ownerAction("approve", approve.id, approve.token), /^Approved\./);
  const [b] = gas.bookings();
  assert.equal(b.status, "approved");
  assert.equal(b.start, "2026-11-02T10:07:00.000Z", "to the minute");
  assert.equal(b.end, "2026-11-02T10:52:00.000Z");
  assert.equal(gas.events.length, 1);
  assert.equal(gas.events[0].title, "Immediate Talk: Asha Rao");
  assert.equal(new Date(gas.events[0].start).toISOString(), b.start);

  const [client, copy] = gas.mails.slice(1);
  assert.equal(client.to, "asha@example.com");
  for (const part of [
    "Your call is ready now. The room is open for you.",
    b.code,
    `https://benjaminmithra.com/call?room=${b.code}`,
    "Use headphones or over-ear headphones.",
    "If you can't find this email later, check your spam folder and add benjamin@benjaminmithra.com to your contacts.",
  ]) {
    assert.ok(client.htmlBody.includes(part), part);
    assert.ok(client.body.includes(part), part);
  }
  // The owner's copy: WhatsApp button with a "ready now" message.
  assert.equal(copy.to, "benjamin@benjaminmithra.com");
  const href = copy.htmlBody.match(/<a href="(https:\/\/wa\.me\/[^"]+)"[^>]*>Send the code on WhatsApp<\/a>/)[1].replace(/&amp;/g, "&");
  const url = new URL(href);
  assert.equal(url.pathname, "/919876543210");
  assert.equal(href.split("?text=")[1], encodeURIComponent(url.searchParams.get("text")));
  const message = url.searchParams.get("text");
  assert.match(message, /^Hello Asha Rao, your Talk now call is ready now\. /);
  assert.ok(message.includes(b.code) && message.includes(`/call?room=${b.code}`) && message.includes("Please use headphones or over-ear headphones."));
  assert.ok(copy.body.includes(`Send the code on WhatsApp: ${href}`));

  // The code works now, and until 60 minutes after the start.
  assert.deepEqual(gas.get({ action: "check", code: b.code }), { valid: true, startsAt: b.start, endsAt: b.end });
  gas.setNow("2026-11-02T11:07:00Z");
  assert.equal(gas.get({ action: "check", code: b.code }).valid, true);
  gas.setNow("2026-11-02T11:08:00Z");
  assert.equal(gas.get({ action: "check", code: b.code }).valid, false);
});

test("immediate: an approved call takes its time off the booking calendar", () => {
  const gas = setup();
  turnOn(gas);
  // Requested and approved at 18:20 India time on Monday, while booking calls
  // further ahead: the immediate call holds 18:20-19:05 (plus the buffer).
  gas.setNow(IST("2026-11-02", "18:20"));
  immediate(gas);
  const { approve } = links(gas.mails[0].htmlBody);
  gas.context.ownerAction("approve", approve.id, approve.token);
  assert.equal(gas.bookings()[0].start, IST("2026-11-02", "18:20"));
  // From the morning before (12 hours' notice), Monday 19:00 would have been offered; now it's taken.
  gas.setNow(IST("2026-11-02", "06:00"));
  const { slots } = gas.get({ action: "slots" });
  assert.ok(slots.includes(IST("2026-11-02", "21:00")));
  assert.ok(!slots.includes(IST("2026-11-02", "19:00")), "19:00 is within 15 minutes of 19:05");
});

test("immediate: unanswered after 15 minutes, released politely (status, check, or the hourly clean-up)", () => {
  for (const run of [(g) => g.get({ action: "status" }), (g) => g.get({ action: "check", code: "ABCDEFGHJK" }), (g) => g.context.releaseExpired()]) {
    const gas = setup();
    turnOn(gas);
    immediate(gas);
    gas.setNow(Date.parse(NOW) + 14 * 60e3);
    run(gas);
    assert.equal(gas.bookings().length, 1, "still waiting at 14 minutes");
    gas.setNow(Date.parse(NOW) + 16 * 60e3);
    run(gas);
    assert.equal(gas.bookings().length, 0);
    const note = gas.mails.at(-1);
    assert.equal(note.to, "asha@example.com");
    assert.ok(note.body.includes("I wasn't able to take your call just now. You're welcome to book a time: https://benjaminmithra.com/call"));
  }
});

test("immediate: approving after 15 minutes releases it instead", () => {
  const gas = setup();
  turnOn(gas);
  immediate(gas);
  const { approve } = links(gas.mails[0].htmlBody);
  gas.setNow(Date.parse(NOW) + 16 * 60e3);
  assert.match(gas.context.ownerAction("approve", approve.id, approve.token), /waited more than 15 minutes/);
  assert.equal(gas.bookings().length, 0);
  assert.equal(gas.events.length, 0);
  assert.match(gas.mails.at(-1).body, /I wasn't able to take your call just now/);
});

test("immediate decline: a polite note, nothing on the calendar", () => {
  const gas = setup();
  turnOn(gas);
  immediate(gas);
  const { decline } = links(gas.mails[0].htmlBody);
  assert.equal(gas.context.ownerAction("decline", decline.id, decline.token), "Declined. The client has been emailed.");
  assert.equal(gas.bookings().length, 0);
  const note = gas.mails.at(-1);
  assert.match(note.body, /Thank you for your request to talk now\. I'm not able to take a call at the moment\./);
  assert.ok(note.htmlBody.includes('href="https://benjaminmithra.com/consultation"'));
});

// ---- admin key ---------------------------------------------------------------------
test("admin: every action refuses while ADMIN_KEY isn't set (or is too short)", () => {
  for (const key of [null, "short"]) {
    const gas = setup({ key });
    for (const action of ["getSettings", "saveHours", "addBlock", "removeBlock", "setImmediate", "setPaused"]) {
      assert.deepEqual(admin(gas, action, { on: true }, "anything"), { ok: false, error: "not-configured" }, action);
    }
    assert.deepEqual(gas.get({ action: "status" }), { immediate: false, paused: false });
  }
});

test("admin: wrong keys, then a 15-minute lockout after 5 tries", () => {
  const gas = setup();
  assert.equal(admin(gas, "getSettings").ok, true);
  for (let i = 0; i < 4; i++) assert.deepEqual(admin(gas, "setImmediate", { on: true }, `${KEY}x`), { ok: false, error: "wrong-key" });
  assert.equal(admin(gas, "getSettings", {}, KEY.slice(0, -1)).error, "locked", "the 5th wrong try locks");
  const locked = admin(gas, "getSettings");
  assert.equal(locked.error, "locked", "even the right key waits");
  assert.ok(locked.retryAfterMinutes >= 1 && locked.retryAfterMinutes <= 15);
  assert.equal(admin(gas, "getSettings", {}, "").error, "locked");
  assert.deepEqual(gas.get({ action: "status" }), { immediate: false, paused: false }, "nothing changed");
  gas.setNow(Date.parse(NOW) + 16 * 60e3);
  assert.equal(admin(gas, "getSettings").ok, true);
});

test("admin: getSettings returns the defaults and nothing private", () => {
  const gas = setup();
  const s = admin(gas, "getSettings");
  assert.equal(s.ok, true);
  assert.equal(s.timezone, "Asia/Kolkata");
  assert.deepEqual(s.hours.monday, [["18:00", "23:00"]]);
  assert.deepEqual(s.hours.sunday, []);
  assert.equal(s.immediate, false);
  assert.equal(s.paused, false);
  assert.deepEqual(s.blocks, []);
  assert.ok(!JSON.stringify(s).includes(KEY));
});

// ---- hours -----------------------------------------------------------------------------
test("saving hours changes the slots; existing bookings stay valid", () => {
  const gas = setup();
  assert.equal(gas.post({ action: "book", ...CLIENT, start: IST("2026-11-02", "19:00") }).ok, true);
  const hours = { monday: [["09:00", "11:00"], ["20:00", "22:00"]], tuesday: [], wednesday: [], thursday: [], friday: [], saturday: [], sunday: [["10:00", "12:00"]] };
  const res = admin(gas, "saveHours", { hours });
  assert.equal(res.ok, true);
  assert.deepEqual(res.hours.monday, [["09:00", "11:00"], ["20:00", "22:00"]]);
  const { slots } = gas.get({ action: "slots" });
  // Monday: 09:00 and 10:00 are under 12 hours away; 20:00 and 21:00 fit in 20:00-22:00.
  assert.deepEqual(slots.filter((s) => s < IST("2026-11-03", "00:00")), [IST("2026-11-02", "20:00"), IST("2026-11-02", "21:00")]);
  assert.ok(slots.includes(IST("2026-11-08", "10:00")), "Sunday is open now");
  assert.ok(!slots.some((s) => s.startsWith("2026-11-03")), "Tuesday closed");
  // The 19:00 booking made under the old hours is still there and still holds.
  assert.equal(gas.bookings()[0].start, IST("2026-11-02", "19:00"));
  const { approve } = links(gas.mails[0].htmlBody);
  assert.match(gas.context.ownerAction("approve", approve.id, approve.token), /^Approved/);
});

test("saving hours: invalid hours are refused", () => {
  const gas = setup();
  const base = { monday: [], tuesday: [], wednesday: [], thursday: [], friday: [], saturday: [], sunday: [] };
  for (const bad of [
    { ...base, monday: [["18:00", "17:00"]] },
    { ...base, monday: [["18:00", "20:00"], ["19:00", "21:00"]] },
    { ...base, monday: [["7pm", "9pm"]] },
    { ...base, monday: [["24:00", "24:00"]] },
    { monday: [] },
    null,
  ]) assert.deepEqual(admin(gas, "saveHours", { hours: bad }), { ok: false, error: "invalid" });
  assert.equal(admin(gas, "saveHours", { hours: { ...base, monday: [["22:00", "24:00"]] } }).ok, true, "24:00 as an end is fine");
});

// ---- blocks ----------------------------------------------------------------------------
test("blocked times remove slots; removing a block brings them back", () => {
  const gas = setup();
  let res = admin(gas, "addBlock", { date: "2026-11-03", note: "Family <dinner>" });
  assert.equal(res.ok, true);
  assert.equal(res.blocks.length, 1);
  assert.equal(res.blocks[0].note, "Family dinner");
  res = admin(gas, "addBlock", { date: "2026-11-04", from: "19:30", to: "20:30" });
  let { slots } = gas.get({ action: "slots" });
  assert.ok(!slots.some((s) => s.startsWith("2026-11-03")), "the whole day");
  assert.ok(slots.includes(IST("2026-11-04", "18:00")));
  assert.ok(!slots.includes(IST("2026-11-04", "19:00")) && !slots.includes(IST("2026-11-04", "20:00")));
  assert.ok(slots.includes(IST("2026-11-04", "21:00")));

  const whole = res.blocks.find((k) => k.date === "2026-11-03");
  res = admin(gas, "removeBlock", { id: whole.id });
  assert.equal(res.blocks.length, 1);
  ({ slots } = gas.get({ action: "slots" }));
  assert.ok(slots.includes(IST("2026-11-03", "18:00")));
});

test("blocked times: bad dates and times are refused; past blocks drop off the list", () => {
  const gas = setup();
  for (const bad of [
    { date: "2026-11-01" }, // yesterday in India
    { date: "2026-02-31" },
    { date: "tomorrow" },
    { date: "2026-11-05", from: "20:00" },
    { date: "2026-11-05", from: "20:00", to: "19:00" },
  ]) assert.deepEqual(admin(gas, "addBlock", bad), { ok: false, error: "invalid" }, JSON.stringify(bad));
  assert.equal(admin(gas, "addBlock", { date: "2026-11-02" }).ok, true, "today is fine");
  assert.equal(admin(gas, "addBlock", { date: "2026-11-05" }).blocks.length, 2);
  gas.setNow(IST("2026-11-03", "09:00"));
  assert.deepEqual(admin(gas, "getSettings").blocks.map((k) => k.date), ["2026-11-05"]);
});

// ---- pause -------------------------------------------------------------------------------
test("paused: no slots, booking refused, status says so", () => {
  const gas = setup();
  admin(gas, "setPaused", { on: true });
  assert.deepEqual(gas.get({ action: "slots" }).slots, []);
  assert.deepEqual(gas.post({ action: "book", ...CLIENT, start: IST("2026-11-02", "19:00") }), { ok: false, error: "paused" });
  assert.equal(gas.get({ action: "status" }).paused, true);
  admin(gas, "setPaused", { on: false });
  assert.equal(gas.get({ action: "slots" }).slots.length, 60);
});

// ---- privacy -------------------------------------------------------------------------------
test("immediate and admin flows never log names, emails, phones, codes or the key", () => {
  const gas = setup();
  turnOn(gas);
  gas.failNextMails(1);
  immediate(gas, { email: "fails@example.com", name: "Ravi Kumar", phone: "+44 7700 900123" });
  immediate(gas);
  const { approve } = links(gas.mails[0].htmlBody);
  gas.context.ownerAction("approve", approve.id, approve.token);
  admin(gas, "getSettings", {}, "wrong-key-value-1234567");
  const code = gas.bookings()[0].code;
  const log = gas.logs.join("\n");
  assert.ok(gas.logs.length > 0);
  for (const secret of ["Asha", "asha@example.com", "98765", "Ravi", "fails@example.com", "7700", code, KEY, "wrong-key-value"]) {
    assert.ok(!log.includes(secret), `log contains ${secret}`);
  }
});
