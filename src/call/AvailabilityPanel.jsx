import { useEffect, useMemo, useState } from "react";
import { adminCall, getSlots } from "./bookingApi.js";
import { addDays, dateKey, formatDayKey, formatTime } from "./timezones.js";

// "Availability" on /host: Benjamin's switches, weekly hours, blocked times
// and a preview of what clients see. Every change goes to the Apps Script
// with the admin key (kept for this tab only, in sessionStorage).

const KEY_STORE = "talk-now-admin-key";
const DAYS = [
  ["monday", "Monday"], ["tuesday", "Tuesday"], ["wednesday", "Wednesday"], ["thursday", "Thursday"],
  ["friday", "Friday"], ["saturday", "Saturday"], ["sunday", "Sunday"],
];
const INDIA = "Asia/Kolkata";
const readKey = () => { try { return sessionStorage.getItem(KEY_STORE) || ""; } catch { return ""; } };
const writeKey = (k) => { try { k ? sessionStorage.setItem(KEY_STORE, k) : sessionStorage.removeItem(KEY_STORE); } catch { /* private mode */ } };
const mins = (t) => { const [h, m] = t.split(":").map(Number); return h * 60 + m; };
const endMins = (t) => (t === "00:00" ? 24 * 60 : mins(t)); // 00:00 as an end means midnight

function errorText(res, what) {
  switch (res && res.error) {
    case "wrong-key": return "That key isn't right.";
    case "locked": return `Too many wrong tries. Please wait about ${res.retryAfterMinutes || 15} minutes and try again.`;
    case "not-configured": return "The admin key isn't set up yet. Add ADMIN_KEY in the Apps Script's Script properties (see the README), then deploy a new version.";
    case "invalid": return what === "hours" ? "Please check the times: each start must be before its end, and ranges can't overlap." : "Please check the date and times.";
    case "too-many": return "There are already 50 upcoming blocked times. Remove some first.";
    case "try-again": return "The booking service is busy. Please try again in a moment.";
    default: return "Something went wrong. Please try again.";
  }
}
const NETWORK = "Couldn't reach the booking service. Please check your internet and try again.";

// Checks a day's ranges like the server does.
function hoursProblem(hours) {
  for (const [day, label] of DAYS) {
    const list = [...hours[day]].sort((a, b) => mins(a[0]) - mins(b[0]));
    for (let i = 0; i < list.length; i++) {
      const [from, to] = list[i];
      if (!from || !to) return `${label}: please fill in both times.`;
      if (mins(from) >= endMins(to)) return `${label}: each start must be before its end.`;
      if (i > 0 && mins(from) < endMins(list[i - 1][1])) return `${label}: the times overlap.`;
    }
  }
  return "";
}
// <input type="time"> has no 24:00, so midnight as an end is shown as 00:00.
const toServer = (hours) => Object.fromEntries(DAYS.map(([d]) => [d, hours[d].map(([f, t]) => [f, t === "00:00" ? "24:00" : t])]));
const fromServer = (hours) => Object.fromEntries(DAYS.map(([d]) => [d, (hours[d] || []).map(([f, t]) => [f, t === "24:00" ? "00:00" : t])]));

function Switch({ ui, c, label, on, onToggle, busy, testId }) {
  return (
    <button type="button" role="switch" aria-checked={on} onClick={onToggle} disabled={busy} data-testid={testId}
      style={{ ...ui.panel, flexDirection: "row", alignItems: "center", justifyContent: "space-between", cursor: "pointer", borderColor: on ? c.accent : c.line, borderWidth: on ? 2 : 1, padding: "14px 16px" }}>
      <span style={{ ...ui.text, fontWeight: 700, textAlign: "left" }}>{label}</span>
      <span aria-hidden="true" style={{ flexShrink: 0, width: 58, height: 32, borderRadius: 16, background: on ? c.accent : c.panelHover, border: `1px solid ${on ? c.accent : c.strongLine}`, position: "relative", transition: "background 150ms" }}>
        <span style={{ position: "absolute", top: 3, left: on ? 29 : 3, width: 24, height: 24, borderRadius: "50%", background: on ? c.onAccent : c.faint, transition: "left 150ms" }} />
      </span>
      <span style={{ ...ui.small, minWidth: 28, textAlign: "right" }}>{on ? "On" : "Off"}</span>
    </button>
  );
}

export function AvailabilityPanel({ ui, c }) {
  const [key, setKey] = useState(readKey);
  const [keyInput, setKeyInput] = useState("");
  const [settings, setSettings] = useState(null);
  const [hours, setHours] = useState(null); // the editable copy
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState({ area: "", text: "" });
  const [block, setBlock] = useState({ date: "", from: "", to: "", note: "" });
  const [slots, setSlots] = useState(null);

  const today = useMemo(() => dateKey(new Date(), INDIA), []);

  async function call(action, payload = {}, what = "") {
    setBusy(true);
    setError("");
    try {
      const res = await adminCall(action, key, payload);
      setBusy(false);
      if (!res || !res.ok) {
        if (res && ["wrong-key", "locked", "not-configured"].includes(res.error)) {
          // Back to the key form.
          setSettings(null);
          writeKey("");
          setKey("");
        }
        setError(errorText(res, what));
        return null;
      }
      setSettings(res);
      return res;
    } catch {
      setBusy(false);
      setError(NETWORK);
      return null;
    }
  }
  async function refreshPreview() {
    try { setSlots((await getSlots()).slots || []); } catch { setSlots(null); }
  }

  // Unlock with a key from this tab's earlier visit, if there is one.
  useEffect(() => {
    if (key && !settings) call("getSettings").then((res) => { if (res) { setHours(fromServer(res.hours)); refreshPreview(); } });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);

  function unlock(e) {
    e.preventDefault();
    const k = keyInput.trim();
    if (!k) return;
    writeKey(k);
    setKeyInput("");
    setKey(k);
  }
  const lock = () => { writeKey(""); setKey(""); setSettings(null); setHours(null); setMessage({ area: "", text: "" }); };

  async function toggle(action, on, label) {
    const res = await call(action, { on });
    if (res) { setMessage({ area: "switches", text: `${label}: ${on ? "on" : "off"}.` }); refreshPreview(); }
  }
  async function saveHours() {
    const problem = hoursProblem(hours);
    if (problem) { setError(problem); return; }
    const res = await call("saveHours", { hours: toServer(hours) }, "hours");
    if (res) { setHours(fromServer(res.hours)); setMessage({ area: "hours", text: "Saved. Clients now see the new hours." }); refreshPreview(); }
  }
  async function addBlock(e) {
    e.preventDefault();
    if (!block.date) { setError("Please choose a date."); return; }
    if ((block.from || block.to) && !(block.from && block.to)) { setError("Please give both a start and an end time, or neither for the whole day."); return; }
    const res = await call("addBlock", { date: block.date, from: block.from || null, to: block.to === "00:00" ? "24:00" : block.to || null, note: block.note }, "block");
    if (res) { setBlock({ date: "", from: "", to: "", note: "" }); setMessage({ area: "blocks", text: "Blocked." }); refreshPreview(); }
  }
  async function removeBlock(id) {
    const res = await call("removeBlock", { id });
    if (res) { setMessage({ area: "blocks", text: "Removed." }); refreshPreview(); }
  }

  const setRange = (day, i, j, value) => setHours({ ...hours, [day]: hours[day].map((r, k) => (k === i ? (j === 0 ? [value, r[1]] : [r[0], value]) : r)) });
  // A new range goes after the last one if there's room, otherwise in the morning.
  const addRange = (day) => {
    const list = hours[day];
    const hhmm = (m) => `${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`;
    const lastEnd = list.length ? endMins(list[list.length - 1][1]) : null;
    let range = ["18:00", "23:00"];
    if (lastEnd !== null && lastEnd <= 22 * 60) range = [hhmm(lastEnd + 60), lastEnd + 180 >= 24 * 60 ? "00:00" : hhmm(lastEnd + 180)];
    else if (list.length && mins(list[0][0]) >= 12 * 60) range = ["09:00", "12:00"];
    else if (list.length) range = ["", ""];
    setHours({ ...hours, [day]: [...list, range] });
  };
  const removeRange = (day, i) => setHours({ ...hours, [day]: hours[day].filter((_, k) => k !== i) });
  const setClosed = (day, closed) => setHours({ ...hours, [day]: closed ? [] : [["18:00", "23:00"]] });

  // The next 14 days as clients see them, in India time.
  const preview = useMemo(() => {
    if (!slots) return null;
    const byDay = new Map();
    for (const s of slots) {
      const k = dateKey(new Date(s), INDIA);
      if (!byDay.has(k)) byDay.set(k, []);
      byDay.get(k).push(formatTime(new Date(s), INDIA));
    }
    return Array.from({ length: 14 }, (_, i) => addDays(today, i)).map((k) => ({ day: k, times: byDay.get(k) || [] }));
  }, [slots, today]);

  const Msg = ({ area }) => (message.area === area && message.text ? <p style={ui.success} role="status" data-testid={`avail-msg-${area}`}>{message.text}</p> : null);
  const smallBtn = { ...ui.btnQuiet, padding: "8px 12px", fontSize: 13 };
  const timeInput = { ...ui.input, width: "100%", minWidth: 0, padding: "8px 8px" };
  const linkBtn = { ...ui.small, background: "none", border: "none", padding: 0, color: c.accent, textDecoration: "underline", textUnderlineOffset: 3, cursor: "pointer" };

  return (
    <section style={{ width: "100%", display: "flex", flexDirection: "column", gap: 14 }} aria-labelledby="avail-heading" data-testid="availability">
      <h2 id="avail-heading" style={ui.h2}>Availability</h2>

      {!settings && (
        <form onSubmit={unlock} style={ui.panel} data-testid="admin-key-form">
          <label style={ui.label}>Admin key
            <input style={ui.input} type="password" value={keyInput} onChange={(e) => setKeyInput(e.target.value)} autoComplete="current-password" data-testid="admin-key" />
          </label>
          <p style={ui.small}>The ADMIN_KEY from the Apps Script's Script properties. It's kept in this tab only.</p>
          {error && <p style={ui.error} role="alert" data-testid="avail-error">{error}</p>}
          <div style={ui.row}><button type="submit" style={ui.btn} disabled={busy} data-testid="admin-unlock">{busy ? "Checking…" : "Unlock"}</button></div>
        </form>
      )}

      {settings && hours && (
        <>
          {error && <p style={ui.error} role="alert" data-testid="avail-error">{error}</p>}

          <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
            <Switch ui={ui} c={c} label="Taking immediate calls" on={settings.immediate} busy={busy} testId="switch-immediate"
              onToggle={() => toggle("setImmediate", !settings.immediate, "Taking immediate calls")} />
            <Switch ui={ui} c={c} label="Pause all booking" on={settings.paused} busy={busy} testId="switch-paused"
              onToggle={() => toggle("setPaused", !settings.paused, "Pause all booking")} />
            <Msg area="switches" />
          </div>

          <div style={ui.panel} data-testid="weekly-hours">
            <p style={ui.panelTitle}>Weekly hours</p>
            <p style={ui.small}>In India time. A call must end by the end of a range.</p>
            {DAYS.map(([day, label]) => {
              const closed = hours[day].length === 0;
              return (
                <div key={day} style={{ borderTop: `1px solid ${c.line}`, paddingTop: 10, display: "flex", flexDirection: "column", gap: 8 }} data-day-row={day}>
                  <div style={{ ...ui.row, justifyContent: "space-between" }}>
                    <span style={{ ...ui.text, fontWeight: 700 }}>{label}</span>
                    <label style={{ ...ui.small, display: "flex", gap: 6, alignItems: "center" }}>
                      <input type="checkbox" checked={closed} onChange={(e) => setClosed(day, e.target.checked)} /> Closed
                    </label>
                  </div>
                  {hours[day].map(([from, to], i) => (
                    <div key={i} style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                      <div style={{ display: "grid", gridTemplateColumns: "minmax(0, 1fr) auto minmax(0, 1fr)", gap: 8, alignItems: "center" }}>
                        <input style={timeInput} type="time" step={900} value={from} onChange={(e) => setRange(day, i, 0, e.target.value)} aria-label={`${label} from`} />
                        <span style={ui.small}>to</span>
                        <input style={timeInput} type="time" step={900} value={to} onChange={(e) => setRange(day, i, 1, e.target.value)} aria-label={`${label} to`} />
                      </div>
                      <div><button type="button" style={linkBtn} onClick={() => removeRange(day, i)} aria-label={`Remove ${label} ${from} to ${to}`}>Remove this range</button></div>
                    </div>
                  ))}
                  {!closed && hours[day].length < 6 && (
                    <div><button type="button" style={smallBtn} onClick={() => addRange(day)}>Add a time range</button></div>
                  )}
                </div>
              );
            })}
            <button type="button" style={ui.btnLarge} onClick={saveHours} disabled={busy} data-testid="save-hours">{busy ? "Saving…" : "Save hours"}</button>
            <Msg area="hours" />
          </div>

          <div style={ui.panel} data-testid="blocks">
            <p style={ui.panelTitle}>Blocked times</p>
            <p style={ui.small}>Days or hours when you can't take calls, in India time. Leave the times empty to block the whole day.</p>
            <form onSubmit={addBlock} style={{ display: "flex", flexDirection: "column", gap: 10 }}>
              <label style={ui.label}>Date<input style={ui.input} type="date" min={today} value={block.date} onChange={(e) => setBlock({ ...block, date: e.target.value })} data-testid="block-date" /></label>
              <div style={{ ...ui.row, flexWrap: "nowrap" }}>
                <label style={{ ...ui.label, flex: 1 }}>From (optional)<input style={ui.input} type="time" step={900} value={block.from} onChange={(e) => setBlock({ ...block, from: e.target.value })} data-testid="block-from" /></label>
                <label style={{ ...ui.label, flex: 1 }}>To (optional)<input style={ui.input} type="time" step={900} value={block.to} onChange={(e) => setBlock({ ...block, to: e.target.value })} data-testid="block-to" /></label>
              </div>
              <label style={ui.label}>Note (optional, just for you)<input style={ui.input} value={block.note} maxLength={80} onChange={(e) => setBlock({ ...block, note: e.target.value })} data-testid="block-note" /></label>
              <div style={ui.row}><button type="submit" style={ui.btn} disabled={busy} data-testid="add-block">Block this time</button></div>
            </form>
            <Msg area="blocks" />
            {settings.blocks.length === 0 ? (
              <p style={ui.small}>No upcoming blocked times.</p>
            ) : (
              <ul style={{ listStyle: "none", margin: 0, padding: 0, display: "flex", flexDirection: "column", gap: 8 }} data-testid="block-list">
                {settings.blocks.map((k) => (
                  <li key={k.id} style={{ ...ui.row, justifyContent: "space-between", flexWrap: "nowrap", borderTop: `1px solid ${c.line}`, paddingTop: 8 }} data-block-date={k.date}>
                    <span style={{ ...ui.text, fontSize: 15, minWidth: 0, overflowWrap: "anywhere" }}>
                      {formatDayKey(k.date, { weekday: "short", day: "numeric", month: "short" })} · {k.from ? `${k.from}–${k.to}` : "whole day"}{k.note ? ` · ${k.note}` : ""}
                    </span>
                    <button type="button" style={{ ...smallBtn, flexShrink: 0 }} onClick={() => removeBlock(k.id)}>Remove</button>
                  </li>
                ))}
              </ul>
            )}
          </div>

          <div style={ui.panel} data-testid="preview">
            <p style={ui.panelTitle}>What clients see: the next 14 days</p>
            <p style={ui.small}>Free start times in India time, after your hours, blocked times and Google Calendar. Clients see them in their own time zone.</p>
            {settings.paused && <p style={ui.text}>Booking is paused: clients see no times.</p>}
            {!preview && <p style={ui.small}>Loading…</p>}
            {preview && !settings.paused && (
              <ul style={{ listStyle: "none", margin: 0, padding: 0, display: "flex", flexDirection: "column", gap: 4 }}>
                {preview.map(({ day, times }) => (
                  <li key={day} style={{ ...ui.small, display: "flex", gap: 10 }} data-preview-day={day}>
                    <span style={{ flex: "0 0 92px", color: c.ink }}>{formatDayKey(day, { weekday: "short", day: "numeric", month: "short" })}</span>
                    <span style={{ minWidth: 0 }}>{times.length ? times.join(", ") : "No times"}</span>
                  </li>
                ))}
              </ul>
            )}
          </div>

          <div style={ui.row}><button type="button" style={ui.btnQuiet} onClick={lock} data-testid="admin-lock">Lock (forget the key)</button></div>
        </>
      )}
    </section>
  );
}
