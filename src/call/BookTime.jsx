import { useEffect, useMemo, useState } from "react";
import { getSlots, book } from "./bookingApi.js";
import { isPrerender } from "./talkConfig.js";
import { TimeZonePicker } from "./TimeZonePicker.jsx";
import { addDays, dateKey, detectZone, formatDayKey, formatDateTime, formatTime, offsetLabel, offsetMinutes, weekdayIndex } from "./timezones.js";

const WEEKDAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
const EMAIL = /^[^\s@<>()",;]+@[^\s@<>()",;]+\.[A-Za-z]{2,}$/;
const FIELD_ERROR = {
  name: "Please enter your name.",
  email: "Please enter a valid email address.",
  phone: "Please enter your phone number with the country code, for example +91 98765 43210.",
};

function validate({ name, email, phone }) {
  const errors = {};
  if (!name.trim() || name.trim().length > 80) errors.name = FIELD_ERROR.name;
  if (!EMAIL.test(email.trim()) || email.trim().length > 200) errors.email = FIELD_ERROR.email;
  const p = phone.replace(/\s+/g, " ").trim();
  const digits = p.replace(/\D/g, "").length;
  if (!/^\+[0-9][0-9 ()\-.]*$/.test(p) || p.length > 30 || digits < 8 || digits > 15) errors.phone = FIELD_ERROR.phone;
  return errors;
}

// "Book a time": pick a time zone, a day and a free time, then send a request.
export function BookTime({ ui, c }) {
  const [tz, setTz] = useState(detectZone);
  const [slots, setSlots] = useState(null); // UTC ISO strings
  const [loadError, setLoadError] = useState(false);
  const [day, setDay] = useState(null);
  const [slot, setSlot] = useState(null);
  const [form, setForm] = useState({ name: "", email: "", phone: "", website: "" });
  const [errors, setErrors] = useState({});
  const [notice, setNotice] = useState("");
  const [sending, setSending] = useState(false);
  const [done, setDone] = useState(null);

  async function load({ keepNotice = false } = {}) {
    setLoadError(false);
    if (!keepNotice) setNotice("");
    try {
      const res = await getSlots();
      if (!res || !Array.isArray(res.slots)) throw new Error("bad");
      setSlots(res.slots);
    } catch {
      setLoadError(true);
      setSlots((s) => s || []);
    }
  }
  useEffect(() => { if (!isPrerender()) load(); }, []);

  // Days to show: from today (in the chosen zone) for 14 days, or to the last free time.
  const { days, byDay } = useMemo(() => {
    const today = dateKey(new Date(), tz);
    const map = new Map();
    for (const s of slots || []) {
      const k = dateKey(new Date(s), tz);
      if (!map.has(k)) map.set(k, []);
      map.get(k).push(s);
    }
    let last = addDays(today, 13);
    for (const k of map.keys()) if (k > last) last = k;
    const list = [];
    for (let k = today; k <= last; k = addDays(k, 1)) list.push(k);
    return { days: list, byDay: map };
  }, [slots, tz]);

  // Pick a sensible day: the chosen time's day, or the first day with free times.
  useEffect(() => {
    if (slot && slots?.includes(slot)) { setDay(dateKey(new Date(slot), tz)); return; }
    if (!day || !byDay.has(day)) setDay(days.find((k) => byDay.has(k)) || null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [byDay, tz]);

  const set = (k) => (e) => { setForm({ ...form, [k]: e.target.value }); setErrors({ ...errors, [k]: undefined }); };

  async function submit(e) {
    e.preventDefault();
    setNotice("");
    const errs = validate(form);
    setErrors(errs);
    if (Object.keys(errs).length || !slot) return;
    setSending(true);
    try {
      const res = await book({ name: form.name.trim(), email: form.email.trim(), phone: form.phone.trim(), website: form.website, timezone: tz, start: slot });
      if (res.ok) {
        setDone({ slot, tz });
      } else if (res.error === "slot-taken") {
        setSlot(null);
        setNotice("Sorry, that time was just taken. Please choose another time.");
        await load({ keepNotice: true });
      } else if (res.error === "pending-exists") {
        setNotice("You already have a request waiting. I'll email you once I've reviewed it.");
      } else if (res.error === "invalid" && Array.isArray(res.fields)) {
        const errs2 = {};
        for (const f of res.fields) if (FIELD_ERROR[f]) errs2[f] = FIELD_ERROR[f];
        if (res.fields.includes("start")) { setSlot(null); setNotice("Please choose a time."); }
        setErrors(errs2);
      } else {
        setNotice("Something went wrong. Please try again in a moment.");
      }
    } catch {
      setNotice("We couldn't send your request. Please check your connection and try again.");
    }
    setSending(false);
  }

  if (done) {
    return (
      <div style={ui.panel} data-testid="book-done" role="status">
        <p style={ui.panelTitle}>Request received</p>
        <p style={ui.text}>Request received. I will review it and email you a code. Please check your spam folder, and add benjamin@benjaminmithra.com to your contacts so it reaches you.</p>
        <p style={ui.small}>You asked for {formatDateTime(new Date(done.slot), done.tz)} (your time, {done.tz.replace(/_/g, " ")}).</p>
      </div>
    );
  }

  const tzLabel = `${tz.replace(/_/g, " ")} (${offsetLabel(offsetMinutes(tz))})`;
  const lead = days.length ? weekdayIndex(days[0]) : 0;
  const daySlots = (day && byDay.get(day)) || [];
  return (
    <div style={ui.panel} data-testid="book">
      <TimeZonePicker ui={ui} c={c} value={tz} onChange={setTz} />
      <p style={ui.small} data-testid="tz-note">All times are shown in your time: {tzLabel}.</p>

      {slots === null && <p style={ui.small}>Loading free times…</p>}
      {loadError && (
        <p style={ui.error} role="alert">
          We couldn't load the free times. <button type="button" style={{ ...ui.btnQuiet, padding: "6px 12px", marginLeft: 6 }} onClick={() => load()}>Try again</button>
        </p>
      )}
      {notice && <p style={ui.error} role="alert" data-testid="book-notice">{notice}</p>}

      {slots !== null && !loadError && slots.length === 0 && <p style={ui.text} data-testid="no-slots">There are no free times in the next two weeks. Please check again later.</p>}

      {slots !== null && slots.length > 0 && (
        <>
          <div role="grid" aria-label="Next 14 days" data-testid="calendar" style={{ display: "grid", gridTemplateColumns: "repeat(7, minmax(0, 1fr))", gap: 4 }}>
            {WEEKDAYS.map((w) => <div key={w} role="columnheader" style={{ ...ui.small, fontSize: 12.5, textAlign: "center" }}>{w}</div>)}
            {Array.from({ length: lead }, (_, i) => <div key={`blank-${i}`} aria-hidden="true" />)}
            {days.map((k, i) => {
              const count = byDay.get(k)?.length || 0;
              const selected = k === day;
              const dayNum = Number(k.slice(8));
              const showMonth = i === 0 || dayNum === 1;
              return (
                <button
                  key={k}
                  type="button"
                  role="gridcell"
                  disabled={!count}
                  aria-pressed={selected}
                  aria-label={`${formatDayKey(k)}: ${count ? `${count} free ${count === 1 ? "time" : "times"}` : "no free times"}`}
                  data-day={k}
                  onClick={() => { setDay(k); setSlot(null); }}
                  style={{
                    minWidth: 0, padding: "8px 0 6px", borderRadius: 8, cursor: count ? "pointer" : "default",
                    border: `1px solid ${selected ? c.accent : count ? c.strongLine : c.line}`,
                    background: selected ? c.accent : count ? c.surface : "transparent",
                    color: selected ? c.onAccent : count ? c.ink : c.faint,
                    fontFamily: ui.text.fontFamily, fontSize: 15, lineHeight: 1.2, display: "flex", flexDirection: "column", alignItems: "center", gap: 2,
                    opacity: count ? 1 : 0.55,
                  }}
                >
                  <span style={{ fontWeight: 700 }}>{dayNum}</span>
                  <span style={{ fontSize: 11 }}>{showMonth ? formatDayKey(k, { month: "short" }) : count ? "•" : " "}</span>
                </button>
              );
            })}
          </div>

          {day && (
            <div style={{ display: "flex", flexDirection: "column", gap: 8 }} data-testid="times">
              <p style={ui.text}><strong>{formatDayKey(day)}</strong> <span style={ui.small}>(your time)</span></p>
              {daySlots.length === 0 ? (
                <p style={ui.small}>No free times on this day.</p>
              ) : (
                <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(96px, 1fr))", gap: 8 }}>
                  {daySlots.map((s) => (
                    <button key={s} type="button" data-slot={s} aria-pressed={s === slot} onClick={() => { setSlot(s); setNotice(""); }}
                      style={{ ...(s === slot ? ui.btn : ui.btnQuiet), padding: "10px 6px", textTransform: "none", letterSpacing: 0 }}>
                      {formatTime(new Date(s), tz)}
                    </button>
                  ))}
                </div>
              )}
            </div>
          )}
        </>
      )}

      {slot && (
        <form onSubmit={submit} noValidate style={{ display: "flex", flexDirection: "column", gap: 12, position: "relative" }} data-testid="book-form">
          <hr style={ui.divider} />
          <p style={ui.text} data-testid="chosen-time">{formatDateTime(new Date(slot), tz)} <span style={ui.small}>(your time)</span></p>
          <label style={ui.label}>Your name
            <input style={ui.input} value={form.name} onChange={set("name")} maxLength={80} autoComplete="name" aria-invalid={Boolean(errors.name)} />
          </label>
          {errors.name && <p style={ui.error} role="alert">{errors.name}</p>}
          <label style={ui.label}>Your email
            <input style={ui.input} type="email" value={form.email} onChange={set("email")} maxLength={200} autoComplete="email" aria-invalid={Boolean(errors.email)} />
          </label>
          {errors.email && <p style={ui.error} role="alert">{errors.email}</p>}
          <label style={ui.label}>Phone number, with country code
            <input style={ui.input} type="tel" value={form.phone} onChange={set("phone")} maxLength={30} autoComplete="tel" placeholder="+91 98765 43210" aria-invalid={Boolean(errors.phone)} />
          </label>
          {errors.phone && <p style={ui.error} role="alert">{errors.phone}</p>}
          {/* A hidden field people never see; bots that fill it in are ignored. */}
          <div aria-hidden="true" style={{ position: "absolute", left: -10000, top: "auto", width: 1, height: 1, overflow: "hidden" }}>
            <label>Website<input tabIndex={-1} autoComplete="off" name="website" value={form.website} onChange={set("website")} /></label>
          </div>
          <button type="submit" style={ui.btnLarge} disabled={sending} data-testid="book-submit">{sending ? "Sending…" : "Submit"}</button>
        </form>
      )}
    </div>
  );
}
