// A small stand-in for the Google services Code.gs uses (CalendarApp,
// MailApp, PropertiesService, LockService, ContentService, HtmlService,
// ScriptApp, Utilities), so the real Code.gs can run in Node for tests.
import fs from "node:fs";
import vm from "node:vm";
import crypto from "node:crypto";

const CODE_PATH = new URL("../Code.gs", import.meta.url);

// ---- Utilities.formatDate (the Java-style patterns Code.gs uses) ----------
function zoneOrUtc(tz) {
  try { new Intl.DateTimeFormat("en-US", { timeZone: tz }); return tz; } catch { return "UTC"; } // Google falls back to GMT
}
function offsetString(date, tz) {
  const name = new Intl.DateTimeFormat("en-US", { timeZone: tz, timeZoneName: "longOffset" }).formatToParts(date).find((p) => p.type === "timeZoneName").value;
  const m = name.match(/GMT([+-])(\d{2}):(\d{2})/);
  return m ? `${m[1]}${m[2]}${m[3]}` : "+0000";
}
export function formatDate(dateIn, tzIn, pattern) {
  const date = new Date(dateIn.getTime());
  const tz = zoneOrUtc(tzIn);
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat("en-US", { timeZone: tz, year: "numeric", month: "long", day: "numeric", weekday: "long", hour: "numeric", minute: "2-digit", second: "2-digit", hourCycle: "h23" })
      .formatToParts(date).map((p) => [p.type, p.value]),
  );
  const monthNum = new Intl.DateTimeFormat("en-US", { timeZone: tz, month: "numeric" }).format(date);
  const h24 = Number(parts.hour);
  const pad = (n) => String(n).padStart(2, "0");
  const map = {
    EEEE: parts.weekday, EEE: parts.weekday.slice(0, 3), MMMM: parts.month, MMM: parts.month.slice(0, 3), MM: pad(monthNum),
    yyyy: parts.year, dd: pad(parts.day), d: String(Number(parts.day)), HH: pad(h24), H: String(h24),
    hh: pad(h24 % 12 || 12), h: String(h24 % 12 || 12), mm: parts.minute, ss: parts.second, a: h24 < 12 ? "AM" : "PM", Z: offsetString(date, tz),
  };
  return pattern.replace(/EEEE|EEE|MMMM|MMM|MM|yyyy|dd|d|HH|H|hh|h|mm|ss|a|Z|'[^']*'/g, (t) => (t.startsWith("'") ? t.slice(1, -1) : map[t]));
}

// ---- the fake Google services ------------------------------------------
// now: a fixed time (ms) for unit tests, or null to follow the real clock.
export function createGas({ now = null, url = "https://script.google.com/macros/s/TEST/exec", settings = {} } = {}) {
  const clock = { now };
  const events = [];
  const mails = [];
  const logs = [];
  const props = new Map();
  const triggers = [];
  let mailFailures = 0;

  const current = () => (clock.now == null ? Date.now() : clock.now);
  class FakeDate extends Date {
    constructor(...args) { if (args.length === 0) super(current()); else super(...args); }
    static now() { return current(); }
  }

  const makeEvent = (title, start, end, opts = {}) => {
    const ev = {
      id: crypto.randomUUID() + "@google.com", title, start: start.getTime(), end: end.getTime(),
      description: opts.description || "", transparency: opts.transparency || "OPAQUE", myStatus: opts.myStatus || "OWNER",
      getId() { return this.id; }, getTitle() { return this.title; }, setTitle(t) { this.title = t; return this; },
      getStartTime() { return new Date(this.start); }, getEndTime() { return new Date(this.end); },
      getDescription() { return this.description; }, setDescription(d) { this.description = d; return this; },
      getTransparency() { return this.transparency; }, getMyStatus() { return this.myStatus; },
      deleteEvent() { const i = events.indexOf(this); if (i >= 0) events.splice(i, 1); },
    };
    events.push(ev);
    return ev;
  };
  const calendar = {
    getEvents(from, to) { return events.filter((e) => e.start < to.getTime() && e.end > from.getTime()); },
    createEvent(title, start, end, opts) { return makeEvent(title, start, end, opts); },
    getEventById(id) { return events.find((e) => e.id === id) || null; },
  };

  const sandbox = {
    console: {
      log: (...a) => logs.push(a.join(" ")), info: (...a) => logs.push(a.join(" ")),
      warn: (...a) => logs.push(a.join(" ")), error: (...a) => logs.push(a.join(" ")),
    },
    CalendarApp: {
      getDefaultCalendar: () => calendar,
      EventTransparency: { OPAQUE: "OPAQUE", TRANSPARENT: "TRANSPARENT" },
      GuestStatus: { YES: "YES", NO: "NO", MAYBE: "MAYBE", INVITED: "INVITED", OWNER: "OWNER" },
    },
    MailApp: {
      sendEmail(msg) {
        if (mailFailures > 0) { mailFailures -= 1; throw new Error(`Invalid email: ${msg.to}`); }
        mails.push(msg);
      },
      getRemainingDailyQuota: () => 100,
    },
    PropertiesService: {
      getScriptProperties: () => ({
        getProperty: (k) => (props.has(k) ? props.get(k) : null),
        setProperty(k, v) {
          if (String(v).length > 9000) throw new Error("Property too large");
          props.set(k, String(v));
          return this;
        },
        deleteProperty(k) { props.delete(k); return this; },
        getProperties: () => Object.fromEntries(props),
        getKeys: () => [...props.keys()],
      }),
    },
    LockService: {
      getScriptLock: () => ({ tryLock: () => true, waitLock: () => {}, releaseLock: () => {}, hasLock: () => true }),
    },
    ContentService: {
      MimeType: { JSON: "JSON", TEXT: "TEXT" },
      createTextOutput: (content) => ({ kind: "text", content, mime: "TEXT", setMimeType(m) { this.mime = m; return this; }, getContent() { return this.content; } }),
    },
    HtmlService: {
      createHtmlOutput: (html) => ({
        kind: "html", html, title: "", meta: {},
        setTitle(t) { this.title = t; return this; }, addMetaTag(n, c) { this.meta[n] = c; return this; },
        getContent() { return this.html; },
      }),
    },
    ScriptApp: {
      getService: () => ({ getUrl: () => url }),
      getProjectTriggers: () => [...triggers],
      deleteTrigger: (t) => { const i = triggers.indexOf(t); if (i >= 0) triggers.splice(i, 1); },
      newTrigger: (handler) => {
        const t = { handler, hours: null, getHandlerFunction: () => handler };
        const builder = { timeBased: () => builder, everyHours: (n) => { t.hours = n; return builder; }, create: () => { triggers.push(t); return t; } };
        return builder;
      },
    },
    Utilities: {
      getUuid: () => crypto.randomUUID(),
      formatDate,
      DigestAlgorithm: { SHA_256: "SHA_256" },
      Charset: { UTF_8: "UTF_8" },
      // Like Google's: an array of signed bytes.
      computeDigest: (alg, value) => [...crypto.createHash("sha256").update(String(value), "utf8").digest()].map((b) => (b > 127 ? b - 256 : b)),
    },
  };
  const context = vm.createContext(sandbox);
  context.Date = FakeDate;
  vm.runInContext(fs.readFileSync(CODE_PATH, "utf8"), context, { filename: "Code.gs" });
  Object.assign(context, settings);

  const parse = (out) => (out.kind === "text" ? JSON.parse(out.content) : out);
  return {
    context, events, mails, logs, props, triggers, clock,
    setNow(t) { clock.now = typeof t === "number" ? t : Date.parse(t); },
    failNextMails(n = 1) { mailFailures = n; },
    get(params) { return parse(context.doGet({ parameter: params })); },
    post(body) { return parse(context.doPost({ postData: { contents: typeof body === "string" ? body : JSON.stringify(body), type: "text/plain" }, parameter: {} })); },
    bookings() { return [...props.entries()].filter(([k]) => k.startsWith("booking_")).map(([, v]) => JSON.parse(v)); },
    addBusy(start, end, opts) { return makeEvent("Busy", new Date(start), new Date(end), opts); },
  };
}
