/**
 * Talk now bookings for benjaminmithra.com
 * =========================================
 *
 * This is the only "backend" for Talk now. It runs for free inside your own
 * Google account as a Google Apps Script web app, and uses only:
 *   - Google Calendar (CalendarApp): your free/busy times and the bookings,
 *   - Gmail (MailApp): the emails to you and to clients,
 *   - Script properties (PropertiesService): a small private store for the
 *     booking codes, deleted again after each call,
 *   - LockService: so two people can't book the same time at once.
 *
 * How it works:
 *   1. The website asks for free times ("slots"), or whether you're taking
 *      immediate calls right now ("status").
 *   2. A client books one ("book"). It goes on your calendar as
 *      "Talk now: <name> (pending)" and you get an email with Approve and
 *      Decline links. The client is told you'll review it.
 *   3. You tap Approve: the client gets their code and the join link.
 *      Or you tap Decline: the time is freed and the client gets a kind note.
 *   4. At the time of the call, the website checks the code ("check").
 *
 * Immediate Talk: when you switch it on (on /host), clients can ask to talk
 * right now. You get an "Immediate Talk" email with Approve and Decline; on
 * Approve the call starts at that moment and the client gets their code.
 * Requests you don't answer within 15 minutes are released politely.
 *
 * Your hours, blocked times, "Taking immediate calls" and "Pause all booking"
 * are changed on benjaminmithra.com/host (Availability), protected by the
 * ADMIN_KEY you add in Project Settings > Script properties. The values below
 * are only the starting defaults.
 *
 * Setup steps are in apps-script/README.md. After changing anything here,
 * deploy a new version (Deploy > Manage deployments > Edit > New version).
 *
 * Privacy: this script never writes names, emails or phone numbers to the
 * log.
 */

// =====================================================================
// SETTINGS: you can change these.
// =====================================================================

/** Where booking requests go, and who the client emails come from. */
var OWNER_EMAIL = "benjamin@benjaminmithra.com";

/** Your website (used for links in the emails). No slash at the end. */
var SITE_URL = "https://benjaminmithra.com";

/** Length of a call, and the gap kept free before and after each booking. */
var SESSION_MINUTES = 45;
var BUFFER_MINUTES = 15;

/** How far ahead people can book, and the least notice you need. */
var MIN_NOTICE_HOURS = 12;
var DAYS_AHEAD = 14;

/** Your time zone. The hours below are in this time zone. */
var TIMEZONE = "Asia/Kolkata";

/** Minutes between possible start times (60 = on the hour). */
var SLOT_STEP_MINUTES = 60;

/**
 * EDIT ME: these are placeholder hours.
 * The starting hours, used until you save your own on /host (Availability).
 * The times you take calls, for each day of the week, in TIMEZONE.
 * Each day is a list of [from, to] pairs in 24-hour time. A call must end by
 * the "to" time. Use [] for a day off. Example with a lunch break:
 *   monday: [["10:00", "13:00"], ["14:00", "18:00"]],
 */
var WORK_HOURS = {
  monday: [["18:00", "23:00"]],
  tuesday: [["18:00", "23:00"]],
  wednesday: [["18:00", "23:00"]],
  thursday: [["18:00", "23:00"]],
  friday: [["18:00", "23:00"]],
  saturday: [["18:00", "23:00"]],
  sunday: [],
};

/** A request you haven't answered within this many hours is released. */
var PENDING_HOURS = 48;

/** The code works from this many minutes before the start until this many after. */
var JOIN_EARLY_MINUTES = 15;
var JOIN_LATE_MINUTES = 60;

/** At most this many requests can wait for you at once (a guard against spam). */
var MAX_PENDING = 20;

/** Immediate Talk: how long a request waits for your answer, and how many can wait at once. */
var IMMEDIATE_WAIT_MINUTES = 15;
var MAX_PENDING_IMMEDIATE = 5;

/** Wrong admin keys allowed in this many minutes before admin changes are refused for a while. */
var ADMIN_MAX_FAILURES = 5;
var ADMIN_LOCK_MINUTES = 15;

/**
 * Leave empty. The script finds its own web address. Only fill this in if
 * the Approve and Decline links in your emails ever point to the wrong place.
 */
var WEB_APP_URL = "";

// =====================================================================
// Below here is the program itself. You don't need to change it.
// =====================================================================

var DAY_NAMES = ["sunday", "monday", "tuesday", "wednesday", "thursday", "friday", "saturday"];
// Booking codes use no look-alike characters (no 0/O, no 1/I/L).
var CODE_ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";
var CODE_LENGTH = 10;
var MINUTE = 60 * 1000;
var KEY_PREFIX = "booking_";
// Script properties used for settings (see "Settings" below).
var SETTINGS_KEY = "settings"; // { hours, immediate, paused }
var BLOCKS_KEY = "blocks"; // [{ id, date, from, to, note }]
var ADMIN_FAILS_KEY = "admin_fails"; // times of recent wrong admin keys
var ADMIN_KEY_PROPERTY = "ADMIN_KEY"; // you add this one by hand
var ADMIN_KEY_MIN_LENGTH = 16;

// ---------------------------------------------------------------------
// Web entry points
// ---------------------------------------------------------------------

/**
 * GET requests:
 *   ?action=slots              free start times (UTC ISO strings)
 *   ?action=status             { immediate, paused } only
 *   ?action=check&code=CODE    { valid, startsAt, endsAt } only
 *   ?action=approve&id=…&token=…   page for you (from your email)
 *   ?action=decline&id=…&token=…   page for you (from your email)
 *
 * Google answers web-app requests with a redirect to
 * script.googleusercontent.com; browsers follow it by themselves and the
 * final answer allows any website to read it, so the site can call this
 * directly.
 */
function doGet(e) {
  var p = (e && e.parameter) || {};
  try {
    if (p.action === "slots") return json_({ ok: true, slots: freeSlots_(new Date()), sessionMinutes: SESSION_MINUTES });
    if (p.action === "status") {
      releaseStaleImmediate_(new Date());
      var st = getSettings_();
      return json_({ immediate: st.immediate, paused: st.paused });
    }
    if (p.action === "check") {
      releaseStaleImmediate_(new Date());
      return json_(checkCode_(p.code, new Date()));
    }
    if (p.action === "approve" || p.action === "decline") return ownerPage_(p.action, p.id, p.token);
    return json_({ ok: true, service: "talk-now" });
  } catch (err) {
    logError_("doGet", err);
    return json_({ ok: false, error: "server" });
  }
}

/**
 * POST requests carry a JSON text body (sent as text/plain so browsers
 * don't need a "preflight" check):
 *   { action: "book", name, email, phone, timezone, start, website }
 *   { action: "immediate", name, email, phone, timezone, website }
 *   { action: "getSettings" | "saveHours" | "addBlock" | "removeBlock" |
 *             "setImmediate" | "setPaused", key, … }   (admin, see below)
 * "website" is a hidden honeypot field that people never see or fill in.
 */
function doPost(e) {
  var body;
  try {
    body = JSON.parse((e && e.postData && e.postData.contents) || "{}");
  } catch (err) {
    return json_({ ok: false, error: "bad-request" });
  }
  try {
    if (body && body.action === "book") return json_(book_(body, new Date()));
    if (body && body.action === "immediate") return json_(immediate_(body, new Date()));
    if (body && ADMIN_ACTIONS.indexOf(body.action) >= 0) return json_(admin_(body, new Date()));
    return json_({ ok: false, error: "bad-request" });
  } catch (err) {
    logError_("doPost", err);
    return json_({ ok: false, error: "server" });
  }
}

/**
 * Run this once by hand (select "setup" at the top, then Run). It asks for
 * the permissions the script needs, and sets up the hourly clean-up that
 * releases requests you haven't answered within PENDING_HOURS.
 */
function setup() {
  CalendarApp.getDefaultCalendar(); // asks for Calendar permission
  MailApp.getRemainingDailyQuota(); // asks for Gmail permission
  ScriptApp.getProjectTriggers().forEach(function (t) {
    if (t.getHandlerFunction() === "releaseExpired") ScriptApp.deleteTrigger(t);
  });
  ScriptApp.newTrigger("releaseExpired").timeBased().everyHours(1).create();
  console.log("Setup complete. The hourly clean-up is on.");
}

// ---------------------------------------------------------------------
// Free times
// ---------------------------------------------------------------------

/** Every possible start time in your weekly hours for the next DAYS_AHEAD days. */
function candidateSlots_(now) {
  var hours = getSettings_().hours;
  var today = localParts_(now, TIMEZONE);
  var out = [];
  for (var d = 0; d < DAYS_AHEAD; d++) {
    // Midday on the local day avoids any daylight-saving edge.
    var day = localParts_(localToUtc_(today.year, today.month, today.day + d, 12, 0, TIMEZONE), TIMEZONE);
    var ranges = hours[DAY_NAMES[day.weekday]] || [];
    ranges.forEach(function (range) {
      var from = hhmm_(range[0]);
      var to = hhmm_(range[1]);
      for (var m = from; m + SESSION_MINUTES <= to; m += SLOT_STEP_MINUTES) {
        out.push(localToUtc_(day.year, day.month, day.day, Math.floor(m / 60), m % 60, TIMEZONE));
      }
    });
  }
  return out;
}

/** Busy times: your calendar's busy events, your blocked times, and other bookings with their buffer. */
function busyIntervals_(from, to) {
  var busy = [];
  CalendarApp.getDefaultCalendar().getEvents(from, to).forEach(function (ev) {
    if (!eventIsBusy_(ev)) return;
    busy.push({ start: ev.getStartTime().getTime(), end: ev.getEndTime().getTime(), pad: 0 });
  });
  getBlocks_().forEach(function (k) {
    var r = blockRange_(k);
    busy.push({ start: r.start.getTime(), end: r.end.getTime(), pad: 0 });
  });
  allBookings_().forEach(function (b) {
    // Pending requests hold their time too. (A waiting immediate request has
    // no time yet; once approved it holds its 45 minutes like any booking.)
    if (!b.start) return;
    busy.push({ start: Date.parse(b.start), end: Date.parse(b.end), pad: BUFFER_MINUTES * MINUTE });
  });
  return busy;
}

/** Events marked "Free", or that you declined, don't block bookings. */
function eventIsBusy_(ev) {
  try {
    if (ev.getTransparency && ev.getTransparency() === CalendarApp.EventTransparency.TRANSPARENT) return false;
  } catch (err) { /* older events: treat as busy */ }
  try {
    if (ev.getMyStatus && ev.getMyStatus() === CalendarApp.GuestStatus.NO) return false;
  } catch (err) { /* not an invitation */ }
  return true;
}

function isFree_(start, busy) {
  var s = start.getTime();
  var e = s + SESSION_MINUTES * MINUTE;
  for (var i = 0; i < busy.length; i++) {
    var b = busy[i];
    if (s < b.end + b.pad && e + b.pad > b.start) return false;
  }
  return true;
}

/** Free start times, as UTC ISO strings, at least MIN_NOTICE_HOURS away. None while booking is paused. */
function freeSlots_(now) {
  if (getSettings_().paused) return [];
  var earliest = now.getTime() + MIN_NOTICE_HOURS * 60 * MINUTE;
  var candidates = candidateSlots_(now).filter(function (s) { return s.getTime() >= earliest; });
  if (candidates.length === 0) return [];
  var from = new Date(candidates[0].getTime() - 24 * 60 * MINUTE);
  var to = new Date(candidates[candidates.length - 1].getTime() + 24 * 60 * MINUTE);
  var busy = busyIntervals_(from, to);
  return candidates.filter(function (s) { return isFree_(s, busy); }).map(function (s) { return s.toISOString(); });
}

// ---------------------------------------------------------------------
// Booking
// ---------------------------------------------------------------------

function book_(body, now) {
  // A bot filled in the hidden field: say "received" and do nothing.
  if (body.website) return { ok: true };

  var v = validateBooking_(body);
  if (v.errors.length) return { ok: false, error: "invalid", fields: v.errors };
  if (getSettings_().paused) return { ok: false, error: "paused" };

  var lock = LockService.getScriptLock();
  if (!lock.tryLock(15000)) return { ok: false, error: "try-again" };
  try {
    var all = allBookings_();
    var refused = pendingLimits_(all, v.email);
    if (refused) return refused;
    // Check again, inside the lock, that the time is still free.
    if (freeSlots_(now).indexOf(v.start.toISOString()) < 0) return { ok: false, error: "slot-taken" };

    var start = v.start;
    var end = new Date(start.getTime() + SESSION_MINUTES * MINUTE);
    var booking = {
      id: Utilities.getUuid(),
      type: "booked",
      code: newCode_(all),
      approveToken: newToken_(),
      declineToken: newToken_(),
      status: "pending",
      start: start.toISOString(),
      end: end.toISOString(),
      createdAt: now.toISOString(),
      name: v.name,
      email: v.email,
      phone: v.phone,
      timezone: v.timezone,
      eventId: null,
    };
    var event = CalendarApp.getDefaultCalendar().createEvent("Talk now: " + booking.name + " (pending)", start, end, {
      description: eventDescription_(booking),
    });
    booking.eventId = event.getId();
    saveBooking_(booking);
    try {
      emailOwnerRequest_(booking);
    } catch (err) {
      // Couldn't email you: undo, so the time isn't held by a request you never saw.
      deleteEvent_(booking);
      deleteBooking_(booking.id);
      throw err;
    }
    return { ok: true };
  } finally {
    lock.releaseLock();
  }
}

/** At most one waiting request per email, and not too many waiting at once. */
function pendingLimits_(all, email) {
  var lower = email.toLowerCase();
  if (all.some(function (b) { return b.status === "pending" && b.email.toLowerCase() === lower; })) {
    return { ok: false, error: "pending-exists" };
  }
  if (all.filter(function (b) { return b.status === "pending"; }).length >= MAX_PENDING) {
    return { ok: false, error: "try-again" };
  }
  return null;
}

/** Basic checks on what the client typed. */
function validateBooking_(body) {
  var v = validateContact_(body);
  var start = new Date(String(body.start || ""));
  if (isNaN(start.getTime())) v.errors.push("start");
  v.start = start;
  return v;
}

/** Name, email, phone (with country code) and time zone. */
function validateContact_(body) {
  var errors = [];
  var name = String(body.name || "").replace(/\s+/g, " ").trim();
  if (name.length < 1 || name.length > 80 || /[<>{}]/.test(name)) errors.push("name");
  var email = String(body.email || "").trim();
  if (email.length > 200 || !/^[^\s@<>()",;]+@[^\s@<>()",;]+\.[A-Za-z]{2,}$/.test(email)) errors.push("email");
  var phone = String(body.phone || "").replace(/\s+/g, " ").trim();
  var digits = phone.replace(/\D/g, "");
  if (!/^\+[0-9][0-9 ()\-.]*$/.test(phone) || phone.length > 30 || digits.length < 8 || digits.length > 15) errors.push("phone");
  var tz = String(body.timezone || "UTC");
  if (tz.length > 64 || !/^(UTC|[A-Za-z]+(\/[A-Za-z0-9_+\-]+){1,2})$/.test(tz)) tz = "UTC";
  return { errors: errors, name: name, email: email, phone: phone, timezone: tz };
}

// ---------------------------------------------------------------------
// Immediate Talk
// ---------------------------------------------------------------------

/**
 * A client asks to talk right now. Nothing goes on your calendar yet; you
 * get an "Immediate Talk" email with Approve and Decline. If you don't
 * answer within IMMEDIATE_WAIT_MINUTES, the request is released politely.
 */
function immediate_(body, now) {
  if (body.website) return { ok: true }; // honeypot: say "received" and do nothing
  var v = validateContact_(body);
  if (v.errors.length) return { ok: false, error: "invalid", fields: v.errors };
  var settings = getSettings_();
  if (settings.paused) return { ok: false, error: "paused" };
  if (!settings.immediate) return { ok: false, error: "immediate-off" };

  var lock = LockService.getScriptLock();
  if (!lock.tryLock(15000)) return { ok: false, error: "try-again" };
  try {
    releaseStaleImmediateLocked_(now);
    var all = allBookings_();
    var refused = pendingLimits_(all, v.email);
    if (refused) return refused;
    var waiting = all.filter(function (b) { return b.status === "pending" && b.type === "immediate"; }).length;
    if (waiting >= MAX_PENDING_IMMEDIATE) return { ok: false, error: "busy" };

    var booking = {
      id: Utilities.getUuid(),
      type: "immediate",
      code: newCode_(all),
      approveToken: newToken_(),
      declineToken: newToken_(),
      status: "pending",
      start: null, // set when you approve
      end: null,
      createdAt: now.toISOString(),
      name: v.name,
      email: v.email,
      phone: v.phone,
      timezone: v.timezone,
      eventId: null,
    };
    saveBooking_(booking);
    try {
      emailOwnerImmediate_(booking);
    } catch (err) {
      deleteBooking_(booking.id);
      throw err;
    }
    return { ok: true };
  } finally {
    lock.releaseLock();
  }
}

/** Releases immediate requests that waited too long (also run from status/check). */
function releaseStaleImmediate_(now) {
  var lock = LockService.getScriptLock();
  if (!lock.tryLock(5000)) return; // someone else is busy; the next call will do it
  try {
    releaseStaleImmediateLocked_(now);
  } finally {
    lock.releaseLock();
  }
}
function releaseStaleImmediateLocked_(now) {
  allBookings_().forEach(function (b) {
    if (b.type === "immediate" && b.status === "pending" && now.getTime() - Date.parse(b.createdAt) > IMMEDIATE_WAIT_MINUTES * MINUTE) {
      deleteBooking_(b.id);
      try { emailClientReleased_(b); } catch (err) { logError_("releaseStaleImmediate", err); }
    }
  });
}

// ---------------------------------------------------------------------
// Approve / decline (from the links in your email)
// ---------------------------------------------------------------------

/**
 * The link in your email opens a small page with one button. The button,
 * not the link itself, approves or declines: this way an email security
 * scanner that "visits" links can't approve or decline a request by itself.
 */
function ownerPage_(action, id, token) {
  var b = findBooking_(id);
  var usable = b && tokenMatches_(b, action, token);
  var title = action === "approve" ? "Approve this request?" : (b && b.status === "approved" ? "Cancel this call?" : "Decline this request?");
  var body;
  if (!usable) {
    body = "<p>This link has already been used, or the request is no longer waiting.</p>";
  } else {
    var when = b.start
      ? esc_(formatTime_(b.start, TIMEZONE)) + " (India time)<br>" + esc_(formatTime_(b.start, b.timezone)) + " (" + esc_(b.timezone) + ")"
      : "Immediate Talk: wants to talk now (asked at " + esc_(formatTime_(b.createdAt, TIMEZONE)) + " India time)." +
        (action === "approve" ? "<br>If you approve, the call starts now and the client gets their code." : "");
    body =
      "<p><strong>" + esc_(b.name) + "</strong><br>" + when + "</p>" +
      '<p><button id="go">' + (action === "approve" ? "Approve" : (b.status === "approved" ? "Cancel the call" : "Decline")) + "</button></p>" +
      '<p id="msg" role="status"></p>' +
      "<script>" +
      "var args=" + JSON.stringify([action, id, token]).replace(/</g, "\\u003c") + ";" +
      "document.getElementById('go').onclick=function(){" +
      "var btn=this;btn.disabled=true;btn.textContent='Working…';" +
      "google.script.run.withSuccessHandler(function(m){btn.remove();document.getElementById('msg').textContent=m;})" +
      ".withFailureHandler(function(){btn.disabled=false;btn.textContent='Try again';document.getElementById('msg').textContent='Something went wrong. Please try again.';})" +
      ".ownerAction(args[0],args[1],args[2]);};" +
      "</script>";
  }
  return page_(usable ? title : "Talk now", body);
}

/**
 * Called by the button on the approve/decline page. Returns the message to
 * show you. Each link works once.
 */
function ownerAction(action, id, token) {
  var lock = LockService.getScriptLock();
  lock.waitLock(15000);
  try {
    var b = findBooking_(id);
    if (!b || !tokenMatches_(b, action, token)) return "This link has already been used, or the request is no longer waiting.";
    if (action === "approve" && b.type === "immediate") {
      if (Date.now() - Date.parse(b.createdAt) > IMMEDIATE_WAIT_MINUTES * MINUTE) {
        deleteBooking_(b.id);
        emailClientReleased_(b);
        return "This request waited more than " + IMMEDIATE_WAIT_MINUTES + " minutes, so it was released and the client was told.";
      }
      // The call starts now (to the minute) and lasts SESSION_MINUTES.
      var start = new Date(Math.floor(Date.now() / MINUTE) * MINUTE);
      b.start = start.toISOString();
      b.end = new Date(start.getTime() + SESSION_MINUTES * MINUTE).toISOString();
      b.status = "approved";
      b.approveToken = null;
      b.approvedAt = new Date().toISOString();
      var event = CalendarApp.getDefaultCalendar().createEvent("Immediate Talk: " + b.name, start, new Date(b.end), { description: eventDescription_(b) });
      b.eventId = event.getId();
      saveBooking_(b);
      emailClientApproved_(b);
      return "Approved. The client has been emailed their code. Open the room on /host.";
    }
    if (action === "approve") {
      if (Date.now() > Date.parse(b.start)) return "This request's time has already passed, so it can't be approved.";
      b.status = "approved";
      b.approveToken = null;
      b.approvedAt = new Date().toISOString();
      var ev = getEvent_(b);
      if (ev) {
        ev.setTitle("Talk now: " + b.name);
        ev.setDescription(eventDescription_(b));
      }
      saveBooking_(b);
      emailClientApproved_(b);
      return "Approved. The client has been emailed.";
    }
    var wasApproved = b.status === "approved";
    deleteEvent_(b);
    deleteBooking_(b.id);
    emailClientDeclined_(b, wasApproved);
    if (b.type === "immediate" && !wasApproved) return "Declined. The client has been emailed.";
    return wasApproved
      ? "Cancelled. The client has been emailed and the time is free again."
      : "Declined. The client has been emailed and the time is free again.";
  } finally {
    lock.releaseLock();
  }
}

/** Approve works while waiting; Decline works while waiting or approved. */
function tokenMatches_(b, action, token) {
  if (action === "approve") return b.status === "pending" && safeEqual_(b.approveToken, token);
  if (action === "decline") return (b.status === "pending" || b.status === "approved") && safeEqual_(b.declineToken, token);
  return false;
}

// ---------------------------------------------------------------------
// Code check (from the website, at the time of the call)
// ---------------------------------------------------------------------

/**
 * Returns only { valid, startsAt, endsAt }: no personal details. A code is
 * valid from JOIN_EARLY_MINUTES before the start until JOIN_LATE_MINUTES
 * after it. Outside that window the times are still given, so the website
 * can say "opens soon" or "has expired".
 */
function checkCode_(input, now) {
  var code = normalizeCode_(input);
  var none = { valid: false, startsAt: null, endsAt: null };
  if (code.length !== CODE_LENGTH) return none;
  var b = allBookings_().filter(function (x) { return x.status === "approved" && x.code === code; })[0];
  if (!b) return none;
  var start = Date.parse(b.start);
  var t = now.getTime();
  return {
    valid: t >= start - JOIN_EARLY_MINUTES * MINUTE && t <= start + JOIN_LATE_MINUTES * MINUTE,
    startsAt: b.start,
    endsAt: b.end,
  };
}

function normalizeCode_(input) {
  return String(input || "").toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 32);
}

// ---------------------------------------------------------------------
// Hourly clean-up (set up by setup())
// ---------------------------------------------------------------------

/**
 * Releases requests you haven't answered within PENDING_HOURS (or whose time
 * has already passed), with a polite email to the client. Also deletes the
 * stored details of approved calls a day after they ended; the calendar
 * event stays as your record.
 */
function releaseExpired() {
  var lock = LockService.getScriptLock();
  lock.waitLock(30000);
  try {
    var now = Date.now();
    allBookings_().forEach(function (b) {
      if (b.status === "pending" && b.type === "immediate") {
        if (now - Date.parse(b.createdAt) > IMMEDIATE_WAIT_MINUTES * MINUTE) {
          deleteBooking_(b.id);
          try { emailClientReleased_(b); } catch (err) { logError_("releaseExpired", err); }
        }
      } else if (b.status === "pending") {
        var tooOld = now - Date.parse(b.createdAt) > PENDING_HOURS * 60 * MINUTE;
        var passed = now > Date.parse(b.start);
        if (tooOld || passed) {
          deleteEvent_(b);
          deleteBooking_(b.id);
          try { emailClientReleased_(b); } catch (err) { logError_("releaseExpired", err); }
        }
      } else if (b.status === "approved" && now > Date.parse(b.start) + (JOIN_LATE_MINUTES + 24 * 60) * MINUTE) {
        deleteBooking_(b.id);
      }
    });
  } finally {
    lock.releaseLock();
  }
}

// ---------------------------------------------------------------------
// Emails
// ---------------------------------------------------------------------

function emailOwnerRequest_(b) {
  var url = webAppUrl_();
  var approve = url + "?action=approve&id=" + encodeURIComponent(b.id) + "&token=" + b.approveToken;
  var decline = url + "?action=decline&id=" + encodeURIComponent(b.id) + "&token=" + b.declineToken;
  var whatsapp = "https://wa.me/" + b.phone.replace(/\D/g, "");
  var india = formatTime_(b.start, TIMEZONE);
  var theirs = formatTime_(b.start, b.timezone);
  var html =
    "<p>New Talk now request:</p>" +
    "<p><strong>" + esc_(b.name) + "</strong><br>" +
    'Email: <a href="mailto:' + esc_(b.email) + '">' + esc_(b.email) + "</a><br>" +
    "Phone: " + esc_(b.phone) + ' (<a href="' + esc_(whatsapp) + '">WhatsApp</a>)</p>' +
    "<p>Time: " + esc_(india) + " (India time)<br>" +
    "Their time: " + esc_(theirs) + " (" + esc_(b.timezone) + ")</p>" +
    '<p><a href="' + esc_(approve) + '" style="' + BUTTON_STYLE + '">Approve</a> &nbsp; ' +
    '<a href="' + esc_(decline) + '" style="' + BUTTON_QUIET_STYLE + '">Decline</a></p>' +
    "<p style=\"color:#566A6C\">Each link opens a page with one button to confirm. If you don't answer within " +
    PENDING_HOURS + " hours, the request is released and the client is told politely.</p>";
  var text =
    "New Talk now request:\n\n" + b.name + "\nEmail: " + b.email + "\nPhone: " + b.phone + "\nWhatsApp: " + whatsapp +
    "\n\nTime: " + india + " (India time)\nTheir time: " + theirs + " (" + b.timezone + ")" +
    "\n\nApprove: " + approve + "\nDecline: " + decline + "\n";
  MailApp.sendEmail({
    to: OWNER_EMAIL,
    replyTo: b.email,
    subject: "Talk now request: " + b.name + ", " + india,
    body: text,
    htmlBody: wrapHtml_(html),
    name: "Talk now",
  });
}

function emailClientApproved_(b) {
  if (b.type === "immediate") return emailClientImmediateApproved_(b);
  var link = SITE_URL + "/call?room=" + b.code;
  var theirs = formatTime_(b.start, b.timezone);
  var india = formatTime_(b.start, TIMEZONE);
  var subject = "Your Talk now call: " + theirs;
  var html =
    "<p>Hello " + esc_(b.name) + ",</p>" +
    "<p>Your call is confirmed.</p>" +
    "<p style=\"color:#566A6C\">If you can't find this email later, check your spam folder and add " + esc_(OWNER_EMAIL) + " to your contacts.</p>" +
    "<p><strong>" + esc_(theirs) + "</strong> (your time, " + esc_(b.timezone) + ")<br>" +
    esc_(india) + " (India time)</p>" +
    '<p>Your code: <strong style="font-family:monospace;font-size:18px;letter-spacing:2px">' + b.code + "</strong></p>" +
    '<p><a href="' + esc_(link) + '" style="' + BUTTON_STYLE + '">Join your call</a></p>' +
    "<p>Or open " + esc_(link) + " a few minutes before the time. The room opens " + JOIN_EARLY_MINUTES + " minutes before the start.</p>" +
    "<p>Use headphones or over-ear headphones.</p>" +
    "<p>The call is " + SESSION_MINUTES + " minutes, audio only, private, and not recorded. If you need to change the time, just reply to this email.</p>" +
    "<p>Benjamin</p>";
  var text =
    "Hello " + b.name + ",\n\nYour call is confirmed.\n\n" +
    "If you can't find this email later, check your spam folder and add " + OWNER_EMAIL + " to your contacts.\n\n" + theirs + " (your time, " + b.timezone + ")\n" + india +
    " (India time)\n\nYour code: " + b.code + "\nJoin here: " + link +
    "\n\nThe room opens " + JOIN_EARLY_MINUTES + " minutes before the start.\nUse headphones or over-ear headphones.\n\n" +
    "The call is " + SESSION_MINUTES + " minutes, audio only, private, and not recorded. If you need to change the time, just reply to this email.\n\nBenjamin\n";
  MailApp.sendEmail({ to: b.email, replyTo: OWNER_EMAIL, subject: subject, body: text, htmlBody: wrapHtml_(html), name: "Benjamin Mithra" });
  // Your copy, with a button to send the code on WhatsApp too, in case the
  // email lands in the client's spam folder.
  sendOwnerCopy_(b, subject, text, html, whatsappCodeLink_(b, theirs, india, link));
}

/** Your copy of an email to the client, with the "Send the code on WhatsApp" button. */
function sendOwnerCopy_(b, subject, text, html, whatsapp) {
  MailApp.sendEmail({
    to: OWNER_EMAIL,
    subject: "Copy: " + subject + " (sent to " + b.name + ")",
    body: "This is a copy of the email sent to " + b.email + ".\n\nSend the code on WhatsApp: " + whatsapp + "\n\n" + text,
    htmlBody: wrapHtml_(
      "<p style=\"color:#566A6C\">This is a copy of the email sent to " + esc_(b.email) + ".</p>" +
      '<p><a href="' + esc_(whatsapp) + '" style="' + BUTTON_STYLE + '">Send the code on WhatsApp</a></p><hr>' + html
    ),
    name: "Talk now",
  });
}

/**
 * A wa.me link that opens WhatsApp with a short message to the client,
 * ready to send: their name, the time (theirs and India's), the code, the
 * join link and the headphones reminder.
 */
function whatsappCodeLink_(b, theirs, india, link) {
  var when = theirs
    ? "is confirmed for " + theirs + " (your time, " + b.timezone + "), which is " + india + " in India"
    : "is ready now"; // Immediate Talk
  var message =
    "Hello " + b.name + ", your Talk now call " + when + ". Your code is " + b.code + ". Join here: " + link +
    " Please use headphones or over-ear headphones. Benjamin";
  return "https://wa.me/" + b.phone.replace(/\D/g, "") + "?text=" + encodeURIComponent(message);
}

/** Immediate Talk: you got a request to talk now. */
function emailOwnerImmediate_(b) {
  var url = webAppUrl_();
  var approve = url + "?action=approve&id=" + encodeURIComponent(b.id) + "&token=" + b.approveToken;
  var decline = url + "?action=decline&id=" + encodeURIComponent(b.id) + "&token=" + b.declineToken;
  var whatsapp = "https://wa.me/" + b.phone.replace(/\D/g, "");
  var asked = formatTime_(b.createdAt, TIMEZONE);
  var html =
    "<p><strong>" + esc_(b.name) + "</strong> would like to talk now.</p>" +
    "<p>Email: <a href=\"mailto:" + esc_(b.email) + "\">" + esc_(b.email) + "</a><br>" +
    "Phone: " + esc_(b.phone) + ' (<a href="' + esc_(whatsapp) + '">WhatsApp</a>)<br>' +
    "Asked at " + esc_(asked) + " (India time). Their time zone: " + esc_(b.timezone) + "</p>" +
    '<p><a href="' + esc_(approve) + '" style="' + BUTTON_STYLE + '">Approve</a> &nbsp; ' +
    '<a href="' + esc_(decline) + '" style="' + BUTTON_QUIET_STYLE + '">Decline</a></p>' +
    "<p style=\"color:#566A6C\">If you approve, the call starts then: the client gets their code, and you open the room on /host. " +
    "If you don't answer within " + IMMEDIATE_WAIT_MINUTES + " minutes, the request is released and the client is told politely.</p>";
  var text =
    b.name + " would like to talk now.\n\nEmail: " + b.email + "\nPhone: " + b.phone + "\nWhatsApp: " + whatsapp +
    "\nAsked at " + asked + " (India time). Their time zone: " + b.timezone +
    "\n\nApprove: " + approve + "\nDecline: " + decline + "\n";
  MailApp.sendEmail({ to: OWNER_EMAIL, replyTo: b.email, subject: "Immediate Talk: " + b.name, body: text, htmlBody: wrapHtml_(html), name: "Talk now" });
}

/** Immediate Talk approved: the code, ready now. */
function emailClientImmediateApproved_(b) {
  var link = SITE_URL + "/call?room=" + b.code;
  var subject = "Your Talk now call is ready";
  var html =
    "<p>Hello " + esc_(b.name) + ",</p>" +
    "<p>Your call is ready now. The room is open for you.</p>" +
    "<p style=\"color:#566A6C\">If you can't find this email later, check your spam folder and add " + esc_(OWNER_EMAIL) + " to your contacts.</p>" +
    '<p>Your code: <strong style="font-family:monospace;font-size:18px;letter-spacing:2px">' + b.code + "</strong></p>" +
    '<p><a href="' + esc_(link) + '" style="' + BUTTON_STYLE + '">Join your call</a></p>' +
    "<p>Or open " + esc_(link) + ".</p>" +
    "<p>Use headphones or over-ear headphones.</p>" +
    "<p>The call is " + SESSION_MINUTES + " minutes, audio only, private, and not recorded.</p>" +
    "<p>Benjamin</p>";
  var text =
    "Hello " + b.name + ",\n\nYour call is ready now. The room is open for you.\n\n" +
    "If you can't find this email later, check your spam folder and add " + OWNER_EMAIL + " to your contacts.\n\n" +
    "Your code: " + b.code + "\nJoin here: " + link + "\n\nUse headphones or over-ear headphones.\n\n" +
    "The call is " + SESSION_MINUTES + " minutes, audio only, private, and not recorded.\n\nBenjamin\n";
  MailApp.sendEmail({ to: b.email, replyTo: OWNER_EMAIL, subject: subject, body: text, htmlBody: wrapHtml_(html), name: "Benjamin Mithra" });
  sendOwnerCopy_(b, subject, text, html, whatsappCodeLink_(b, null, null, link));
}

function emailClientDeclined_(b, wasApproved) {
  var consult = SITE_URL + "/consultation";
  var theirs = b.start ? formatTime_(b.start, b.timezone) : "";
  var lead = wasApproved
    ? "I'm sorry, I need to cancel our call on " + theirs + " (your time)."
    : b.start
      ? "Thank you for your request for " + theirs + " (your time). I'm not able to take a call at that time."
      : "Thank you for your request to talk now. I'm not able to take a call at the moment.";
  var html =
    "<p>Hello " + esc_(b.name) + ",</p><p>" + esc_(lead) + "</p>" +
    '<p>You\'re welcome to write to me on the <a href="' + esc_(consult) + '">Consultation page</a>, and we can find another way.</p><p>Benjamin</p>';
  var text = "Hello " + b.name + ",\n\n" + lead + "\n\nYou're welcome to write to me on the Consultation page, and we can find another way:\n" + consult + "\n\nBenjamin\n";
  MailApp.sendEmail({ to: b.email, replyTo: OWNER_EMAIL, subject: "Your Talk now request", body: text, htmlBody: wrapHtml_(html), name: "Benjamin Mithra" });
}

function emailClientReleased_(b) {
  var consult = SITE_URL + "/consultation";
  var book = SITE_URL + "/call";
  if (b.type === "immediate") {
    var leadNow = "I wasn't able to take your call just now. You're welcome to book a time: " + book;
    MailApp.sendEmail({
      to: b.email, replyTo: OWNER_EMAIL, subject: "Your Talk now request", name: "Benjamin Mithra",
      body: "Hello " + b.name + ",\n\n" + leadNow + "\n\nBenjamin\n",
      htmlBody: wrapHtml_("<p>Hello " + esc_(b.name) + ",</p><p>I wasn't able to take your call just now. You're welcome to book a time: " +
        '<a href="' + esc_(book) + '">' + esc_(book) + "</a></p><p>Benjamin</p>"),
    });
    return;
  }
  var theirs = formatTime_(b.start, b.timezone);
  var lead = "Thank you for your request for " + theirs + " (your time). I'm sorry I wasn't able to confirm it in time, so that time has been released.";
  var html =
    "<p>Hello " + esc_(b.name) + ",</p><p>" + esc_(lead) + "</p>" +
    '<p>You\'re welcome to <a href="' + esc_(book) + '">choose another time</a> or write to me on the <a href="' + esc_(consult) + '">Consultation page</a>.</p><p>Benjamin</p>';
  var text = "Hello " + b.name + ",\n\n" + lead + "\n\nYou're welcome to choose another time (" + book + ") or write to me on the Consultation page (" + consult + ").\n\nBenjamin\n";
  MailApp.sendEmail({ to: b.email, replyTo: OWNER_EMAIL, subject: "Your Talk now request", body: text, htmlBody: wrapHtml_(html), name: "Benjamin Mithra" });
}

var BUTTON_STYLE = "display:inline-block;background:#0E5A5F;color:#FFFFFF;padding:10px 20px;border-radius:6px;text-decoration:none;font-weight:bold";
var BUTTON_QUIET_STYLE = "display:inline-block;border:1px solid #0E5A5F;color:#0E5A5F;padding:9px 19px;border-radius:6px;text-decoration:none;font-weight:bold";

function wrapHtml_(inner) {
  return '<div style="font-family:Georgia,serif;font-size:16px;line-height:1.6;color:#1E2B2C;max-width:560px">' + inner + "</div>";
}

// ---------------------------------------------------------------------
// Storage (script properties: private to this script)
// ---------------------------------------------------------------------

function allBookings_() {
  var props = PropertiesService.getScriptProperties().getProperties();
  return Object.keys(props)
    .filter(function (k) { return k.indexOf(KEY_PREFIX) === 0; })
    .map(function (k) { try { return JSON.parse(props[k]); } catch (err) { return null; } })
    .filter(Boolean);
}
function findBooking_(id) {
  if (!id || typeof id !== "string" || id.length > 64) return null;
  var raw = PropertiesService.getScriptProperties().getProperty(KEY_PREFIX + id);
  return raw ? JSON.parse(raw) : null;
}
function saveBooking_(b) {
  PropertiesService.getScriptProperties().setProperty(KEY_PREFIX + b.id, JSON.stringify(b));
}
function deleteBooking_(id) {
  PropertiesService.getScriptProperties().deleteProperty(KEY_PREFIX + id);
}

function getEvent_(b) {
  if (!b.eventId) return null;
  try { return CalendarApp.getDefaultCalendar().getEventById(b.eventId); } catch (err) { return null; }
}
function deleteEvent_(b) {
  var ev = getEvent_(b);
  if (ev) {
    try { ev.deleteEvent(); } catch (err) { /* already gone */ }
  }
}
function eventDescription_(b) {
  return [
    (b.type === "immediate" ? "Immediate Talk" : "Talk now booking") + " (" + (b.status === "approved" ? "approved" : "waiting for your answer") + ")",
    "Name: " + b.name,
    "Email: " + b.email,
    "Phone: " + b.phone,
    "Their time zone: " + b.timezone,
    "Booking id: " + b.id,
  ].join("\n");
}

// ---------------------------------------------------------------------
// Settings: your hours, blocked times, Immediate Talk and Pause
// ---------------------------------------------------------------------
// Changed on benjaminmithra.com/host (Availability) and kept in script
// properties. Until you save your own, the defaults at the top are used.

function getSettings_() {
  var saved = readJsonProperty_(SETTINGS_KEY, {});
  return {
    hours: normalizeHours_(saved.hours) || WORK_HOURS,
    immediate: saved.immediate === true, // off unless you switch it on
    paused: saved.paused === true,
  };
}
function saveSettings_(patch) {
  var s = getSettings_();
  Object.keys(patch).forEach(function (k) { s[k] = patch[k]; });
  PropertiesService.getScriptProperties().setProperty(SETTINGS_KEY, JSON.stringify(s));
  return s;
}

/**
 * Weekly hours: { monday: [["18:00", "23:00"]], …, sunday: [] }. Each day
 * has up to 6 ranges, "HH:MM" in TIMEZONE ("24:00" allowed as an end),
 * each start before its end, with no overlaps. Returns a tidy copy, or null.
 */
function normalizeHours_(hours) {
  if (!hours || typeof hours !== "object") return null;
  var out = {};
  for (var i = 0; i < DAY_NAMES.length; i++) {
    var day = DAY_NAMES[i];
    var ranges = hours[day];
    if (!Array.isArray(ranges) || ranges.length > 6) return null;
    var list = [];
    for (var j = 0; j < ranges.length; j++) {
      var r = ranges[j];
      if (!Array.isArray(r) || r.length !== 2 || !validTime_(r[0]) || !validTime_(r[1]) || r[0] === "24:00") return null;
      if (hhmm_(r[0]) >= hhmm_(r[1])) return null;
      list.push([r[0], r[1]]);
    }
    list.sort(function (a, b) { return hhmm_(a[0]) - hhmm_(b[0]); });
    for (var k = 1; k < list.length; k++) if (hhmm_(list[k][0]) < hhmm_(list[k - 1][1])) return null;
    out[day] = list;
  }
  return out;
}
function validTime_(t) {
  return typeof t === "string" && /^(([01]\d|2[0-3]):[0-5]\d|24:00)$/.test(t);
}

/** Blocked times: [{ id, date: "YYYY-MM-DD", from, to, note }] in TIMEZONE; no from/to = the whole day. */
function getBlocks_() {
  var list = readJsonProperty_(BLOCKS_KEY, []);
  return Array.isArray(list) ? list : [];
}
function saveBlocks_(list) {
  PropertiesService.getScriptProperties().setProperty(BLOCKS_KEY, JSON.stringify(list));
}
function blockRange_(k) {
  var p = k.date.split("-").map(Number);
  var from = hhmm_(k.from || "00:00");
  var to = hhmm_(k.to || "24:00");
  return {
    start: localToUtc_(p[0], p[1], p[2], Math.floor(from / 60), from % 60, TIMEZONE),
    end: localToUtc_(p[0], p[1], p[2], Math.floor(to / 60), to % 60, TIMEZONE),
  };
}
/** Today's date in TIMEZONE, as "YYYY-MM-DD". */
function todayKey_(now) {
  var t = localParts_(now, TIMEZONE);
  return t.year + "-" + ("0" + t.month).slice(-2) + "-" + ("0" + t.day).slice(-2);
}
function upcomingBlocks_(now) {
  var today = todayKey_(now);
  return getBlocks_()
    .filter(function (k) { return k.date >= today; })
    .sort(function (a, b) { return (a.date + (a.from || "")).localeCompare(b.date + (b.from || "")); });
}

function readJsonProperty_(key, fallback) {
  var raw = PropertiesService.getScriptProperties().getProperty(key);
  if (!raw) return fallback;
  try { return JSON.parse(raw); } catch (err) { return fallback; }
}

// ---------------------------------------------------------------------
// Admin actions (from /host, with your ADMIN_KEY)
// ---------------------------------------------------------------------
// Add ADMIN_KEY yourself in Project Settings > Script properties (see the
// README). Without it, every admin action is refused. After
// ADMIN_MAX_FAILURES wrong keys in ADMIN_LOCK_MINUTES, all admin actions are
// refused until that window has passed.

var ADMIN_ACTIONS = ["getSettings", "saveHours", "addBlock", "removeBlock", "setImmediate", "setPaused"];

function admin_(body, now) {
  var lock = LockService.getScriptLock();
  if (!lock.tryLock(15000)) return { ok: false, error: "try-again" };
  try {
    var refused = checkAdminKey_(body.key, now);
    if (refused) return refused;
    switch (body.action) {
      case "getSettings":
        break;
      case "saveHours": {
        var hours = normalizeHours_(body.hours);
        if (!hours) return { ok: false, error: "invalid" };
        saveSettings_({ hours: hours });
        break;
      }
      case "addBlock": {
        var block = validBlock_(body, now);
        if (!block) return { ok: false, error: "invalid" };
        var list = upcomingBlocks_(now); // past blocks are dropped as we go
        if (list.length >= 50) return { ok: false, error: "too-many" };
        list.push(block);
        saveBlocks_(list);
        break;
      }
      case "removeBlock":
        saveBlocks_(upcomingBlocks_(now).filter(function (k) { return k.id !== body.id; }));
        break;
      case "setImmediate":
        saveSettings_({ immediate: body.on === true });
        break;
      case "setPaused":
        saveSettings_({ paused: body.on === true });
        break;
    }
    var st = getSettings_();
    return { ok: true, hours: st.hours, immediate: st.immediate, paused: st.paused, blocks: upcomingBlocks_(now), timezone: TIMEZONE, sessionMinutes: SESSION_MINUTES };
  } finally {
    lock.releaseLock();
  }
}

/** Returns an error to send back, or null if the key is right. */
function checkAdminKey_(key, now) {
  var props = PropertiesService.getScriptProperties();
  var real = props.getProperty(ADMIN_KEY_PROPERTY);
  if (!real || real.length < ADMIN_KEY_MIN_LENGTH) return { ok: false, error: "not-configured" };
  var windowMs = ADMIN_LOCK_MINUTES * MINUTE;
  var fails = (readJsonProperty_(ADMIN_FAILS_KEY, []) || []).filter(function (t) { return now.getTime() - t < windowMs; });
  var locked = function () {
    return { ok: false, error: "locked", retryAfterMinutes: Math.max(1, Math.ceil((fails[0] + windowMs - now.getTime()) / MINUTE)) };
  };
  if (fails.length >= ADMIN_MAX_FAILURES) return locked();
  if (!keyMatches_(key, real)) {
    fails.push(now.getTime());
    props.setProperty(ADMIN_FAILS_KEY, JSON.stringify(fails));
    return fails.length >= ADMIN_MAX_FAILURES ? locked() : { ok: false, error: "wrong-key" };
  }
  return null;
}

/** Compares the SHA-256 of both keys, without stopping at the first difference. */
function keyMatches_(given, real) {
  if (typeof given !== "string" || given.length === 0 || given.length > 512) return false;
  var a = Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, given, Utilities.Charset.UTF_8);
  var b = Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, real, Utilities.Charset.UTF_8);
  var diff = 0;
  for (var i = 0; i < b.length; i++) diff |= a[i] ^ b[i];
  return diff === 0;
}

function validBlock_(body, now) {
  var date = String(body.date || "");
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return null;
  var p = date.split("-").map(Number);
  var check = new Date(Date.UTC(p[0], p[1] - 1, p[2]));
  if (check.getUTCMonth() !== p[1] - 1 || check.getUTCDate() !== p[2]) return null; // e.g. 31 February
  if (date < todayKey_(now)) return null;
  var from = body.from ? String(body.from) : "";
  var to = body.to ? String(body.to) : "";
  if (from || to) {
    if (!validTime_(from) || !validTime_(to) || from === "24:00" || hhmm_(from) >= hhmm_(to)) return null;
  }
  var note = String(body.note || "").replace(/[<>]/g, "").replace(/\s+/g, " ").trim().slice(0, 80);
  return { id: Utilities.getUuid(), date: date, from: from || null, to: to || null, note: note };
}

// ---------------------------------------------------------------------
// Small helpers
// ---------------------------------------------------------------------

function json_(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}

function page_(title, body) {
  var html =
    '<!doctype html><html><head><meta charset="utf-8"><title>' + esc_(title) + "</title>" +
    "<style>body{margin:0;background:#F6F0E4;color:#1E2B2C;font:17px/1.6 Georgia,serif}" +
    "main{max-width:520px;margin:40px auto;padding:24px;background:#FFFFFF;border:1px solid rgba(14,90,95,.28);border-radius:12px}" +
    "h1{color:#0E5A5F;font-size:22px;margin:0 0 12px}" +
    "button{background:#0E5A5F;color:#FFFFFF;border:0;border-radius:6px;padding:12px 24px;font-size:16px;cursor:pointer}" +
    "button:disabled{opacity:.6}</style></head><body><main><h1>" + esc_(title) + "</h1>" + body + "</main></body></html>";
  return HtmlService.createHtmlOutput(html)
    .setTitle(title)
    .addMetaTag("viewport", "width=device-width, initial-scale=1");
}

function webAppUrl_() {
  return WEB_APP_URL || ScriptApp.getService().getUrl();
}

/** A new booking code that no other booking uses. */
function newCode_(existing) {
  var used = {};
  existing.forEach(function (b) { used[b.code] = true; });
  for (;;) {
    var code = randomString_(CODE_ALPHABET, CODE_LENGTH);
    if (!used[code]) return code;
  }
}

/** A long one-time secret for the Approve and Decline links. */
function newToken_() {
  return (Utilities.getUuid() + Utilities.getUuid()).replace(/-/g, "");
}

/** Random characters from an alphabet, using Google's random UUIDs. */
function randomString_(alphabet, length) {
  var out = "";
  var limit = 256 - (256 % alphabet.length); // keeps every character equally likely
  while (out.length < length) {
    var hex = Utilities.getUuid().replace(/-/g, "");
    // Skip the two UUID positions that aren't random (version and variant).
    hex = hex.slice(0, 12) + hex.slice(13, 16) + hex.slice(17);
    for (var i = 0; i + 1 < hex.length && out.length < length; i += 2) {
      var byte = parseInt(hex.substr(i, 2), 16);
      if (byte < limit) out += alphabet.charAt(byte % alphabet.length);
    }
  }
  return out;
}

function safeEqual_(a, b) {
  if (typeof a !== "string" || typeof b !== "string" || a.length !== b.length || a.length === 0) return false;
  var diff = 0;
  for (var i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

function hhmm_(s) {
  var p = String(s).split(":");
  return Number(p[0]) * 60 + Number(p[1] || 0);
}

/** The time-zone offset (in minutes) of a zone at a given moment. */
function offsetMinutes_(date, tz) {
  var z = Utilities.formatDate(date, tz, "Z"); // e.g. "+0530"
  var sign = z.charAt(0) === "-" ? -1 : 1;
  return sign * (Number(z.substr(1, 2)) * 60 + Number(z.substr(3, 2)));
}

/** Year, month (1-12), day and weekday (0 = Sunday) of a moment in a zone. */
function localParts_(date, tz) {
  var shifted = new Date(date.getTime() + offsetMinutes_(date, tz) * MINUTE);
  return { year: shifted.getUTCFullYear(), month: shifted.getUTCMonth() + 1, day: shifted.getUTCDate(), weekday: shifted.getUTCDay() };
}

/** The moment when the clock in a zone shows this local date and time. */
function localToUtc_(year, month, day, hour, minute, tz) {
  var guess = Date.UTC(year, month - 1, day, hour, minute);
  var first = guess - offsetMinutes_(new Date(guess), tz) * MINUTE;
  return new Date(guess - offsetMinutes_(new Date(first), tz) * MINUTE);
}

/** e.g. "Monday 3 November 2026, 7:00 PM" */
function formatTime_(iso, tz) {
  return Utilities.formatDate(new Date(iso), tz, "EEEE d MMMM yyyy, h:mm a");
}

function esc_(s) {
  return String(s == null ? "" : s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;");
}

/** Logs only where the error happened, never its details (they can contain an email address). */
function logError_(where, err) {
  console.error("Talk now error in " + where + (err && err.name ? " (" + err.name + ")" : ""));
}
