// Unit tests for Code.gs, run in Node against fake Google services.
// Run with: node --test apps-script/test/
import { test } from "node:test";
import assert from "node:assert/strict";
import { createGas } from "./gas-mock.mjs";

// Monday 2 November 2026, 05:30 in India.
const NOW = "2026-11-02T00:00:00Z";
const IST = (date, time) => new Date(`${date}T${time}:00+05:30`).toISOString();
const CLIENT = { name: "Asha Rao", email: "asha@example.com", phone: "+91 98765 43210", timezone: "Europe/London" };
const book = (gas, start, extra = {}) => gas.post({ action: "book", ...CLIENT, start, ...extra });

function setup(settings) {
  const gas = createGas({ now: Date.parse(NOW), settings });
  return gas;
}
function linkParams(html, action) {
  const m = html.match(new RegExp(`\\?action=${action}&amp;id=([^&]+)&amp;token=([0-9a-f]+)`));
  return { id: decodeURIComponent(m[1]), token: m[2] };
}

// ---- slots ------------------------------------------------------------------
test("slots: the placeholder hours, 18:00-23:00 India time, Monday to Saturday, for 14 days", () => {
  const gas = setup();
  const res = gas.get({ action: "slots" });
  assert.equal(res.ok, true);
  assert.equal(res.sessionMinutes, 45);
  // 12 working days (two Sundays off) x 5 start times (18:00 ... 22:00).
  assert.equal(res.slots.length, 60);
  assert.equal(res.slots[0], IST("2026-11-02", "18:00"));
  assert.equal(res.slots[4], IST("2026-11-02", "22:00"));
  assert.ok(!res.slots.includes(IST("2026-11-08", "18:00")), "Sunday is closed");
  assert.equal(res.slots.at(-1), IST("2026-11-14", "22:00"));
  for (const s of res.slots) assert.match(s, /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:00\.000Z$/);
});

test("slots: at least 12 hours' notice", () => {
  const gas = setup();
  gas.setNow(IST("2026-11-02", "18:30")); // earliest bookable: Tuesday 06:30
  const { slots } = gas.get({ action: "slots" });
  assert.equal(slots[0], IST("2026-11-03", "18:00"));
  gas.setNow(IST("2026-11-02", "07:00")); // 12 h later is exactly 19:00
  assert.equal(gas.get({ action: "slots" }).slots[0], IST("2026-11-02", "19:00"));
});

test("slots: busy calendar events block overlapping times; free or declined events don't", () => {
  const gas = setup();
  gas.addBusy(IST("2026-11-02", "19:30"), IST("2026-11-02", "20:15"));
  gas.addBusy(IST("2026-11-03", "18:00"), IST("2026-11-03", "23:00"), { transparency: "TRANSPARENT" });
  gas.addBusy(IST("2026-11-04", "18:00"), IST("2026-11-04", "23:00"), { myStatus: "NO" });
  const { slots } = gas.get({ action: "slots" });
  assert.ok(slots.includes(IST("2026-11-02", "18:00")));
  assert.ok(!slots.includes(IST("2026-11-02", "19:00")), "19:00-19:45 overlaps 19:30");
  assert.ok(!slots.includes(IST("2026-11-02", "20:00")), "20:00 overlaps until 20:15");
  assert.ok(slots.includes(IST("2026-11-02", "21:00")));
  assert.ok(slots.includes(IST("2026-11-03", "18:00")), "an event marked Free doesn't block");
  assert.ok(slots.includes(IST("2026-11-04", "18:00")), "a declined invitation doesn't block");
});

test("slots: other bookings block their time plus the 15-minute buffer, and pending ones hold their slot", () => {
  const gas = setup({ SLOT_STEP_MINUTES: 15 });
  assert.equal(book(gas, IST("2026-11-02", "19:00")).ok, true);
  const { slots } = gas.get({ action: "slots" });
  assert.ok(slots.includes(IST("2026-11-02", "18:00")), "ends 18:45, then 15 minutes' buffer to 19:00: fine");
  assert.ok(!slots.includes(IST("2026-11-02", "18:15")), "would end 19:00, with no buffer before the booking");
  assert.ok(!slots.includes(IST("2026-11-02", "19:00")), "the booking itself (still pending)");
  assert.ok(!slots.includes(IST("2026-11-02", "19:45")), "straight after the booking, with no buffer");
  assert.ok(slots.includes(IST("2026-11-02", "20:00")), "19:45 + 15 minutes");
});

// ---- booking -------------------------------------------------------------------
test("book: creates a pending calendar event and emails the owner, but not the code", () => {
  const gas = setup();
  const start = IST("2026-11-02", "19:00");
  assert.deepEqual(book(gas, start), { ok: true });
  const [b] = gas.bookings();
  assert.equal(b.status, "pending");
  assert.match(b.code, /^[ABCDEFGHJKMNPQRSTUVWXYZ23456789]{10}$/);
  assert.match(b.approveToken, /^[0-9a-f]{64}$/);
  assert.match(b.declineToken, /^[0-9a-f]{64}$/);
  assert.notEqual(b.approveToken, b.declineToken);

  assert.equal(gas.events.length, 1);
  const ev = gas.events[0];
  assert.equal(ev.title, "Talk now: Asha Rao (pending)");
  assert.equal(new Date(ev.start).toISOString(), start);
  assert.equal(ev.end - ev.start, 45 * 60 * 1000);
  for (const s of ["Asha Rao", "asha@example.com", "+91 98765 43210", "Europe/London", b.id]) assert.ok(ev.description.includes(s), s);

  assert.equal(gas.mails.length, 1);
  const m = gas.mails[0];
  assert.equal(m.to, "benjamin@benjaminmithra.com");
  assert.equal(m.replyTo, "asha@example.com");
  assert.ok(m.htmlBody.includes("Monday 2 November 2026, 7:00 PM (India time)"));
  assert.ok(m.htmlBody.includes("Monday 2 November 2026, 1:30 PM (Europe/London)"));
  assert.ok(m.htmlBody.includes("https://wa.me/919876543210"));
  assert.deepEqual(linkParams(m.htmlBody, "approve"), { id: b.id, token: b.approveToken });
  assert.deepEqual(linkParams(m.htmlBody, "decline"), { id: b.id, token: b.declineToken });
  assert.ok(m.htmlBody.includes("https://script.google.com/macros/s/TEST/exec?action=approve"));
  assert.ok(!m.htmlBody.includes(b.code) && !m.body.includes(b.code), "the code isn't sent yet");
});

test("book: validation of name, email, phone and time", () => {
  const gas = setup();
  const start = IST("2026-11-02", "19:00");
  const bad = (extra) => book(gas, start, extra);
  assert.deepEqual(bad({ name: "" }).fields, ["name"]);
  assert.deepEqual(bad({ name: "x".repeat(81) }).fields, ["name"]);
  assert.deepEqual(bad({ name: "<script>" }).fields, ["name"]);
  assert.deepEqual(bad({ email: "asha@" }).fields, ["email"]);
  assert.deepEqual(bad({ email: "a b@example.com" }).fields, ["email"]);
  assert.deepEqual(bad({ phone: "98765 43210" }).fields, ["phone"], "needs a country code (+)");
  assert.deepEqual(bad({ phone: "+91 123" }).fields, ["phone"], "too short");
  assert.deepEqual(bad({ phone: "+91 98765 43210 12345 6" }).fields, ["phone"], "too long");
  assert.deepEqual(bad({ phone: "+91 98765-ABCDE" }).fields, ["phone"]);
  assert.deepEqual(bad({ start: "soon" }).fields, ["start"]);
  assert.deepEqual(bad({ name: "", email: "", phone: "" }).fields, ["name", "email", "phone"]);
  assert.equal(bad({ name: "x" }).ok, true, "a one-letter name is fine");
  assert.equal(gas.events.length, 1);
});

test("book: an unknown time zone falls back to UTC", () => {
  const gas = setup();
  book(gas, IST("2026-11-02", "19:00"), { timezone: "<b>bad</b>" });
  assert.equal(gas.bookings()[0].timezone, "UTC");
});

test("book: the hidden honeypot field makes it a silent no-op", () => {
  const gas = setup();
  assert.deepEqual(book(gas, IST("2026-11-02", "19:00"), { website: "http://spam.example" }), { ok: true });
  assert.equal(gas.events.length, 0);
  assert.equal(gas.mails.length, 0);
  assert.equal(gas.bookings().length, 0);
});

test("book: only one pending booking per email", () => {
  const gas = setup();
  assert.equal(book(gas, IST("2026-11-02", "19:00")).ok, true);
  assert.deepEqual(book(gas, IST("2026-11-03", "19:00"), { email: "ASHA@example.com" }), { ok: false, error: "pending-exists" });
  assert.equal(book(gas, IST("2026-11-03", "19:00"), { email: "other@example.com" }).ok, true);
});

test("book: a time that was just taken, or isn't offered, is refused", () => {
  const gas = setup();
  assert.equal(book(gas, IST("2026-11-02", "19:00")).ok, true);
  assert.deepEqual(book(gas, IST("2026-11-02", "19:00"), { email: "b@example.com" }), { ok: false, error: "slot-taken" });
  assert.deepEqual(book(gas, IST("2026-11-02", "19:15"), { email: "b@example.com" }), { ok: false, error: "slot-taken" });
  assert.deepEqual(book(gas, IST("2026-11-08", "19:00"), { email: "b@example.com" }), { ok: false, error: "slot-taken" }, "Sunday");
  assert.deepEqual(book(gas, IST("2026-11-30", "19:00"), { email: "b@example.com" }), { ok: false, error: "slot-taken" }, "too far ahead");
});

test("book: too many waiting requests pauses booking", () => {
  const gas = setup({ MAX_PENDING: 2 });
  assert.equal(book(gas, IST("2026-11-02", "19:00"), { email: "a1@example.com" }).ok, true);
  assert.equal(book(gas, IST("2026-11-02", "20:00"), { email: "a2@example.com" }).ok, true);
  assert.deepEqual(book(gas, IST("2026-11-02", "21:00"), { email: "a3@example.com" }), { ok: false, error: "try-again" });
});

test("book: if the email to the owner fails, nothing is kept", () => {
  const gas = setup();
  gas.failNextMails(1);
  assert.deepEqual(book(gas, IST("2026-11-02", "19:00")), { ok: false, error: "server" });
  assert.equal(gas.events.length, 0);
  assert.equal(gas.bookings().length, 0);
  assert.ok(gas.get({ action: "slots" }).slots.includes(IST("2026-11-02", "19:00")));
});

test("bad requests get a plain error", () => {
  const gas = setup();
  assert.deepEqual(gas.post("{not json"), { ok: false, error: "bad-request" });
  assert.deepEqual(gas.post({ action: "nope" }), { ok: false, error: "bad-request" });
});

// ---- approve / decline ---------------------------------------------------------------
test("approve: the link opens a confirm page; the button approves once and emails the client", () => {
  const gas = setup();
  book(gas, IST("2026-11-02", "19:00"));
  const { id, token } = linkParams(gas.mails[0].htmlBody, "approve");

  // Opening the link only shows the page (a link scanner can't approve).
  const page = gas.get({ action: "approve", id, token });
  assert.equal(page.kind, "html");
  assert.ok(page.html.includes("Approve this request?"));
  assert.ok(page.html.includes("google.script.run"));
  assert.equal(gas.bookings()[0].status, "pending");

  assert.equal(gas.context.ownerAction("approve", id, token), "Approved. The client has been emailed.");
  const b = gas.bookings()[0];
  assert.equal(b.status, "approved");
  assert.equal(gas.events[0].title, "Talk now: Asha Rao");

  const [client, copy] = gas.mails.slice(1);
  assert.equal(client.to, "asha@example.com");
  assert.equal(client.replyTo, "benjamin@benjaminmithra.com");
  assert.ok(client.htmlBody.includes(b.code));
  assert.ok(client.htmlBody.includes(`https://benjaminmithra.com/call?room=${b.code}`));
  assert.ok(client.htmlBody.includes("Monday 2 November 2026, 1:30 PM</strong> (your time, Europe/London)"));
  assert.ok(client.htmlBody.includes("Monday 2 November 2026, 7:00 PM (India time)"));
  assert.ok(client.htmlBody.includes("Use headphones or over-ear headphones."));
  assert.ok(client.body.includes(b.code));
  assert.equal(copy.to, "benjamin@benjaminmithra.com");
  assert.ok(copy.subject.startsWith("Copy: "));
  assert.ok(copy.htmlBody.includes(b.code));

  // One use only.
  assert.match(gas.context.ownerAction("approve", id, token), /already been used/);
  assert.ok(gas.get({ action: "approve", id, token }).html.includes("already been used"));
  assert.equal(gas.mails.length, 3);
});

test("approve/decline: a wrong or missing token changes nothing", () => {
  const gas = setup();
  book(gas, IST("2026-11-02", "19:00"));
  const { id, token } = linkParams(gas.mails[0].htmlBody, "approve");
  const decline = linkParams(gas.mails[0].htmlBody, "decline");
  assert.match(gas.context.ownerAction("approve", id, token.replace(/.$/, (c) => (c === "a" ? "b" : "a"))), /already been used/);
  assert.match(gas.context.ownerAction("approve", id, decline.token), /already been used/, "the decline token can't approve");
  assert.match(gas.context.ownerAction("approve", id, undefined), /already been used/);
  assert.match(gas.context.ownerAction("approve", "nope", token), /already been used/);
  assert.equal(gas.bookings()[0].status, "pending");
  assert.equal(gas.mails.length, 1);
});

test("decline: removes the event, frees the time and sends a kind note", () => {
  const gas = setup();
  const start = IST("2026-11-02", "19:00");
  book(gas, start);
  const { id, token } = linkParams(gas.mails[0].htmlBody, "decline");
  assert.ok(gas.get({ action: "decline", id, token }).html.includes("Decline this request?"));
  assert.equal(gas.context.ownerAction("decline", id, token), "Declined. The client has been emailed and the time is free again.");
  assert.equal(gas.events.length, 0);
  assert.equal(gas.bookings().length, 0);
  assert.ok(gas.get({ action: "slots" }).slots.includes(start));
  const note = gas.mails[1];
  assert.equal(note.to, "asha@example.com");
  assert.ok(note.htmlBody.includes('href="https://benjaminmithra.com/consultation"'));
  assert.ok(!note.htmlBody.includes(gas.mails[0].htmlBody.match(/token=([0-9a-f]+)/)[1]));
  assert.match(gas.context.ownerAction("decline", id, token), /already been used/);
});

test("decline after approving cancels the call", () => {
  const gas = setup();
  book(gas, IST("2026-11-02", "19:00"));
  const a = linkParams(gas.mails[0].htmlBody, "approve");
  const d = linkParams(gas.mails[0].htmlBody, "decline");
  gas.context.ownerAction("approve", a.id, a.token);
  assert.ok(gas.get({ action: "decline", id: d.id, token: d.token }).html.includes("Cancel this call?"));
  assert.match(gas.context.ownerAction("decline", d.id, d.token), /^Cancelled\./);
  assert.equal(gas.events.length, 0);
  assert.match(gas.mails.at(-1).body, /I need to cancel our call/);
});

test("approve: a request whose time has passed can't be approved", () => {
  const gas = setup();
  book(gas, IST("2026-11-02", "19:00"));
  const { id, token } = linkParams(gas.mails[0].htmlBody, "approve");
  gas.setNow(IST("2026-11-02", "19:05"));
  assert.match(gas.context.ownerAction("approve", id, token), /already passed/);
  assert.equal(gas.bookings()[0].status, "pending");
});

// ---- check ----------------------------------------------------------------------------
test("check: only { valid, startsAt, endsAt }, valid from 15 minutes before to 60 minutes after the start", () => {
  const gas = setup();
  const start = IST("2026-11-02", "19:00");
  book(gas, start);
  const code = gas.bookings()[0].code;
  // Not approved yet: the code doesn't work.
  assert.deepEqual(gas.get({ action: "check", code }), { valid: false, startsAt: null, endsAt: null });
  const { id, token } = linkParams(gas.mails[0].htmlBody, "approve");
  gas.context.ownerAction("approve", id, token);

  const at = (time) => { gas.setNow(time); return gas.get({ action: "check", code }); };
  const ends = IST("2026-11-02", "19:45");
  assert.deepEqual(at(IST("2026-11-02", "18:44")), { valid: false, startsAt: start, endsAt: ends });
  assert.deepEqual(at(IST("2026-11-02", "18:45")), { valid: true, startsAt: start, endsAt: ends });
  assert.deepEqual(at(IST("2026-11-02", "20:00")), { valid: true, startsAt: start, endsAt: ends });
  assert.deepEqual(at(IST("2026-11-02", "20:01")), { valid: false, startsAt: start, endsAt: ends });

  gas.setNow(IST("2026-11-02", "19:10"));
  const loose = `${code.slice(0, 5).toLowerCase()}-${code.slice(5)}`;
  assert.equal(gas.get({ action: "check", code: loose }).valid, true, "lower case and a dash are fine");
  assert.deepEqual(gas.get({ action: "check", code: "ABCDEFGHJK" }), { valid: false, startsAt: null, endsAt: null });
  assert.deepEqual(gas.get({ action: "check" }), { valid: false, startsAt: null, endsAt: null });
});

// ---- clean-up ---------------------------------------------------------------------------
test("releaseExpired: unanswered requests are released after 48 hours with a polite email", () => {
  const gas = setup();
  book(gas, IST("2026-11-05", "19:00"));
  gas.setNow(Date.parse(NOW) + 47 * 3600e3);
  gas.context.releaseExpired();
  assert.equal(gas.bookings().length, 1);
  gas.setNow(Date.parse(NOW) + 49 * 3600e3);
  gas.context.releaseExpired();
  assert.equal(gas.bookings().length, 0);
  assert.equal(gas.events.length, 0);
  const note = gas.mails.at(-1);
  assert.equal(note.to, "asha@example.com");
  assert.match(note.body, /wasn't able to confirm it in time/);
});

test("releaseExpired: a waiting request whose time has passed is released; approved ones are forgotten a day after", () => {
  const gas = setup();
  book(gas, IST("2026-11-02", "19:00"));
  book(gas, IST("2026-11-02", "21:00"), { email: "second@example.com" });
  const second = gas.mails[1];
  const { id, token } = linkParams(second.htmlBody, "approve");
  gas.context.ownerAction("approve", id, token);

  gas.setNow(IST("2026-11-02", "19:30"));
  gas.context.releaseExpired();
  assert.deepEqual(gas.bookings().map((b) => b.email), ["second@example.com"]);

  gas.setNow(IST("2026-11-03", "21:00"));
  gas.context.releaseExpired();
  assert.equal(gas.bookings().length, 1, "kept until a day after the join window");
  gas.setNow(IST("2026-11-03", "22:01"));
  gas.context.releaseExpired();
  assert.equal(gas.bookings().length, 0);
  assert.equal(gas.events.length, 1, "the calendar event stays as the owner's record");
});

test("setup: creates one hourly clean-up trigger, even if run twice", () => {
  const gas = setup();
  gas.context.setup();
  gas.context.setup();
  assert.equal(gas.triggers.length, 1);
  assert.equal(gas.triggers[0].handler, "releaseExpired");
  assert.equal(gas.triggers[0].hours, 1);
});

// ---- privacy ---------------------------------------------------------------------------------
test("names, emails, phone numbers and codes never reach the log", () => {
  const gas = setup();
  book(gas, IST("2026-11-02", "19:00"));
  const { id, token } = linkParams(gas.mails[0].htmlBody, "approve");
  gas.context.ownerAction("approve", id, token);
  gas.failNextMails(1);
  book(gas, IST("2026-11-03", "19:00"), { email: "fails@example.com", name: "Ravi Kumar", phone: "+44 7700 900123" });
  gas.context.setup();
  const code = gas.bookings()[0].code;
  const log = gas.logs.join("\n");
  assert.ok(gas.logs.length > 0, "something was logged");
  for (const secret of ["Asha", "asha@example.com", "98765", "Ravi", "fails@example.com", "7700", code, token]) {
    assert.ok(!log.includes(secret), `log contains ${secret}`);
  }
});

test("a visitor across the date line sees the right day in the owner email", () => {
  const gas = setup();
  book(gas, IST("2026-11-02", "22:00"), { timezone: "Pacific/Kiritimati" });
  assert.ok(gas.mails[0].htmlBody.includes("Tuesday 3 November 2026, 6:30 AM (Pacific/Kiritimati)"));
});
