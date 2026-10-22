import { useState } from "react";
import { requestImmediate } from "./bookingApi.js";
import { detectZone } from "./timezones.js";
import { FIELD_ERROR, validate } from "./BookTime.jsx";

// "Need to talk right now?": a request Benjamin approves (or not) by email.
// onStatus is told when the server says immediate calls are off or paused.
export function ImmediateTalk({ ui, onStatus }) {
  const [form, setForm] = useState({ name: "", email: "", phone: "", website: "" });
  const [errors, setErrors] = useState({});
  const [notice, setNotice] = useState("");
  const [sending, setSending] = useState(false);
  const [done, setDone] = useState(false);

  const set = (k) => (e) => { setForm({ ...form, [k]: e.target.value }); setErrors({ ...errors, [k]: undefined }); };

  async function submit(e) {
    e.preventDefault();
    setNotice("");
    const errs = validate(form);
    setErrors(errs);
    if (Object.keys(errs).length) return;
    setSending(true);
    try {
      const res = await requestImmediate({ name: form.name.trim(), email: form.email.trim(), phone: form.phone.trim(), website: form.website, timezone: detectZone() });
      if (res.ok) setDone(true);
      else if (res.error === "immediate-off") onStatus({ immediate: false });
      else if (res.error === "paused") onStatus({ paused: true });
      else if (res.error === "pending-exists") setNotice("You already have a request waiting. I'll email you once I've seen it.");
      else if (res.error === "busy") setNotice("I have a few requests waiting right now. Please try again in a little while, or book a time below.");
      else if (res.error === "invalid" && Array.isArray(res.fields)) {
        const errs2 = {};
        for (const f of res.fields) if (FIELD_ERROR[f]) errs2[f] = FIELD_ERROR[f];
        setErrors(errs2);
      } else setNotice("Something went wrong. Please try again in a moment.");
    } catch {
      setNotice("We couldn't send your request. Please check your connection and try again.");
    }
    setSending(false);
  }

  if (done) {
    return (
      <div style={ui.panel} data-testid="immediate-done" role="status">
        <p style={ui.text}>Request received. Keep an eye on your email.</p>
      </div>
    );
  }
  return (
    <form onSubmit={submit} noValidate style={{ ...ui.panel, position: "relative" }} data-testid="immediate-form">
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
      {notice && <p style={ui.error} role="alert" data-testid="immediate-notice">{notice}</p>}
      <button type="submit" style={ui.btnLarge} disabled={sending} data-testid="immediate-submit">{sending ? "Sending…" : "Book now"}</button>
    </form>
  );
}
