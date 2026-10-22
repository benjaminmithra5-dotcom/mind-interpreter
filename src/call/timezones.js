// Every time zone in the world, with its current UTC offset, for the
// booking calendar. Times are always stored in UTC and only shown in the
// visitor's chosen zone.

// Browsers still use some old zone names (Chrome lists "Asia/Calcutta").
// Show the current official names instead; both work the same.
const RENAMES = {
  "Asia/Calcutta": "Asia/Kolkata",
  "Asia/Katmandu": "Asia/Kathmandu",
  "Asia/Saigon": "Asia/Ho_Chi_Minh",
  "Asia/Rangoon": "Asia/Yangon",
  "Asia/Ulan_Bator": "Asia/Ulaanbaatar",
  "Asia/Thimbu": "Asia/Thimphu",
  "Asia/Dacca": "Asia/Dhaka",
  "Europe/Kiev": "Europe/Kyiv",
  "Europe/Uzhgorod": "Europe/Kyiv",
  "Europe/Zaporozhye": "Europe/Kyiv",
  "Atlantic/Faeroe": "Atlantic/Faroe",
  "America/Godthab": "America/Nuuk",
  "Pacific/Truk": "Pacific/Chuuk",
  "Pacific/Ponape": "Pacific/Pohnpei",
  "Pacific/Enderbury": "Pacific/Kanton",
  "Africa/Asmera": "Africa/Asmara",
  "America/Buenos_Aires": "America/Argentina/Buenos_Aires",
  "America/Indianapolis": "America/Indiana/Indianapolis",
  "America/Louisville": "America/Kentucky/Louisville",
  "Etc/UTC": "UTC",
  "Etc/GMT": "UTC",
};

// For old browsers without Intl.supportedValuesOf.
const FALLBACK = [
  "Pacific/Pago_Pago", "Pacific/Honolulu", "America/Anchorage", "America/Los_Angeles", "America/Denver", "America/Chicago",
  "America/New_York", "America/Halifax", "America/St_Johns", "America/Sao_Paulo", "Atlantic/Azores", "UTC", "Europe/London",
  "Europe/Paris", "Europe/Berlin", "Africa/Lagos", "Africa/Johannesburg", "Europe/Athens", "Africa/Cairo", "Europe/Moscow",
  "Asia/Riyadh", "Asia/Tehran", "Asia/Dubai", "Asia/Kabul", "Asia/Karachi", "Asia/Kolkata", "Asia/Kathmandu", "Asia/Dhaka",
  "Asia/Yangon", "Asia/Bangkok", "Asia/Singapore", "Asia/Shanghai", "Asia/Tokyo", "Australia/Adelaide", "Australia/Sydney",
  "Pacific/Noumea", "Pacific/Auckland", "Pacific/Chatham", "Pacific/Tongatapu", "Pacific/Kiritimati",
];

const validZone = (tz) => {
  try { new Intl.DateTimeFormat("en-US", { timeZone: tz }); return true; } catch { return false; }
};
export const tidyZone = (tz) => (RENAMES[tz] && validZone(RENAMES[tz]) ? RENAMES[tz] : tz);

const partsCache = new Map();
function zoneParts(tz, date) {
  let fmt = partsCache.get(tz);
  if (!fmt) {
    fmt = new Intl.DateTimeFormat("en-US", { timeZone: tz, hourCycle: "h23", year: "numeric", month: "numeric", day: "numeric", hour: "numeric", minute: "numeric", second: "numeric", weekday: "short" });
    partsCache.set(tz, fmt);
  }
  const p = Object.fromEntries(fmt.formatToParts(date).map((x) => [x.type, x.value]));
  return { year: +p.year, month: +p.month, day: +p.day, hour: +p.hour % 24, minute: +p.minute, second: +p.second, weekday: p.weekday };
}

/** Minutes ahead of UTC for a zone at a moment (e.g. 330 for India). */
export function offsetMinutes(tz, date = new Date()) {
  const p = zoneParts(tz, date);
  const asUtc = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second);
  return Math.round((asUtc - Math.floor(date.getTime() / 1000) * 1000) / 60000);
}

export function offsetLabel(minutes) {
  const sign = minutes < 0 ? "−" : "+";
  const m = Math.abs(minutes);
  return `UTC${sign}${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`;
}

/** The visitor's own zone, as the browser reports it. */
export function detectZone() {
  try { return tidyZone(Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC"); } catch { return "UTC"; }
}

let zoneList = null;
/** [{ id, offset, label, search }] sorted by offset, then name. */
export function allZones(now = new Date()) {
  if (zoneList) return zoneList;
  let names = [];
  try { names = Intl.supportedValuesOf("timeZone"); } catch { names = FALLBACK; }
  if (!names.length) names = FALLBACK;
  const ids = new Set();
  for (const n of [...names, "UTC", detectZone()]) {
    const id = tidyZone(n);
    if (validZone(id)) ids.add(id);
  }
  zoneList = [...ids]
    .map((id) => {
      const offset = offsetMinutes(id, now);
      const label = `${offsetLabel(offset)} · ${id.replace(/_/g, " ")}`;
      return { id, offset, label, search: `${label} ${id}`.toLowerCase().replace(/[−]/g, "-") };
    })
    .sort((a, b) => a.offset - b.offset || a.id.localeCompare(b.id));
  return zoneList;
}

// ---- showing UTC times in a zone ---------------------------------------
const pad = (n) => String(n).padStart(2, "0");

/** "2026-11-02": the calendar date of a moment in a zone. */
export function dateKey(date, tz) {
  const p = zoneParts(tz, date);
  return `${p.year}-${pad(p.month)}-${pad(p.day)}`;
}
export function addDays(key, n) {
  const [y, m, d] = key.split("-").map(Number);
  const t = new Date(Date.UTC(y, m - 1, d + n));
  return `${t.getUTCFullYear()}-${pad(t.getUTCMonth() + 1)}-${pad(t.getUTCDate())}`;
}
/** 0 = Monday … 6 = Sunday, for a date key. */
export function weekdayIndex(key) {
  const [y, m, d] = key.split("-").map(Number);
  return (new Date(Date.UTC(y, m - 1, d)).getUTCDay() + 6) % 7;
}
export function formatDayKey(key, opts = { weekday: "long", day: "numeric", month: "long" }) {
  const [y, m, d] = key.split("-").map(Number);
  return new Intl.DateTimeFormat("en-GB", { ...opts, timeZone: "UTC" }).format(new Date(Date.UTC(y, m - 1, d, 12)));
}
/** "7:00 pm" in a zone. */
export function formatTime(date, tz) {
  return new Intl.DateTimeFormat("en-US", { timeZone: tz, hour: "numeric", minute: "2-digit" }).format(date);
}
/** "Monday 2 November, 7:00 PM" in a zone. */
export function formatDateTime(date, tz) {
  return `${formatDayKey(dateKey(date, tz))}, ${formatTime(date, tz)}`;
}
