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

// ---- names, abbreviations, countries ------------------------------------
// timezoneData.json (made by scripts/generate-timezone-data.mjs) has, per
// zone: [country, city, main cities, generic name, standard, daylight].
// It's loaded only when the booking picker needs it, so other pages don't
// carry it.
export const loadZoneData = () => import("./timezoneData.json").then((m) => m.default || m);

const pad2 = (n) => String(n).padStart(2, "0");
/** "GMT+3", "GMT+5:30", "GMT−11", "GMT": for zones with no abbreviation. */
export function gmtStyle(minutes) {
  if (minutes === 0) return "GMT";
  const m = Math.abs(minutes);
  return `GMT${minutes < 0 ? "−" : "+"}${Math.floor(m / 60)}${m % 60 ? `:${pad2(m % 60)}` : ""}`;
}

/**
 * Everything shown for a zone at a moment (today, by default). The offset
 * comes from the browser (Intl), so it's right for today including daylight
 * saving; the name and abbreviation are the data's standard or daylight
 * variant that has that offset.
 */
export function zoneInfo(id, data, date = new Date()) {
  const offset = offsetMinutes(id, date);
  const d = data && data[id];
  if (!d) return { id, offset, abbr: gmtStyle(offset), name: "", country: "", city: "", cities: [], abbrs: [], known: false };
  const [country, city, cities, generic, std, dst] = d;
  const variant = dst && dst[0] === offset ? dst : std[0] === offset ? std : null;
  return {
    id,
    offset,
    abbr: (variant && variant[2]) || gmtStyle(offset),
    name: (variant && variant[1]) || generic || "",
    country,
    city,
    cities: cities ? cities.split("|") : [],
    // Both abbreviations, so "bst" finds London in winter too.
    abbrs: [std[2], dst && dst[2]].filter(Boolean),
    known: true,
  };
}

/** "(UTC+05:30) IST · India Standard Time · Kolkata, India" */
export function zoneLabel(z) {
  const place = z.known ? [z.city, z.country].filter(Boolean).join(", ") : z.id.replace(/_/g, " ");
  return [`(${offsetLabel(z.offset)}) ${z.abbr}`, z.name, place].filter(Boolean).join(" · ");
}

/** "IST (UTC+05:30), Kolkata, India": the line under the picker. */
export function zoneSummary(z) {
  const place = z.known ? [z.city, z.country].filter(Boolean).join(", ") : z.id.replace(/_/g, " ");
  return `${z.abbr} (${offsetLabel(z.offset)})${place ? `, ${place}` : ""}`;
}

// Lower case, no accents, plain minus, spaces for underscores.
const fold = (s) => String(s || "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/[−–]/g, "-").replace(/_/g, " ");

const listCache = new Map();
/**
 * Every zone the browser knows (none dropped), with its label for today,
 * sorted by offset, then country, then city. Without data yet, the labels
 * are just the offset and the zone's name.
 */
export function allZones(now = new Date(), data = null) {
  const cacheKey = data ? "data" : "plain";
  if (listCache.has(cacheKey)) return listCache.get(cacheKey);
  let names = [];
  try { names = Intl.supportedValuesOf("timeZone"); } catch { names = FALLBACK; }
  if (!names.length) names = FALLBACK;
  const ids = new Set();
  for (const n of [...names, "UTC", detectZone()]) {
    const id = tidyZone(n);
    if (validZone(id)) ids.add(id);
  }
  const list = [...ids]
    .map((id) => {
      const z = zoneInfo(id, data, now);
      const label = zoneLabel(z);
      const offsets = offsetSearchTerms(z.offset);
      return { ...z, label, hay: fold([label, id, z.cities.join(" "), z.abbrs.join(" "), offsets].join(" ")) };
    })
    .sort((a, b) =>
      a.offset - b.offset ||
      (a.country ? 0 : 1) - (b.country ? 0 : 1) ||
      a.country.localeCompare(b.country) ||
      (a.city || a.id).localeCompare(b.city || b.id));
  listCache.set(cacheKey, list);
  return list;
}

function offsetSearchTerms(minutes) {
  const sign = minutes < 0 ? "-" : "+";
  const m = Math.abs(minutes);
  const h = Math.floor(m / 60);
  const mm = pad2(m % 60);
  return `utc${sign}${pad2(h)}:${mm} gmt${sign}${h}${m % 60 ? `:${mm}` : ""}`;
}

/** An offset typed as "+5:30", "+05:30", "gmt+5:30", "utc+5", "-11" (in minutes), or null. */
export function parseOffset(query) {
  const q = fold(query).replace(/\s+/g, "");
  const m = q.match(/^(?:gmt|utc)?([+-])(\d{1,2})(?::?(\d{2}))?$/);
  if (!m) return null;
  const minutes = Number(m[2]) * 60 + Number(m[3] || 0);
  return m[1] === "-" ? -minutes : minutes;
}

/**
 * Zones matching what was typed: an abbreviation ("ist", "cst"), a name,
 * a country, a city, the zone id, or an offset ("+5:30"). Exact
 * abbreviation matches come first (today's before the other season's),
 * then exact country, then city.
 */
export function searchZones(list, query) {
  const q = fold(query).trim().replace(/\s+/g, " ");
  if (!q) return list;
  const offset = parseOffset(q);
  if (offset !== null) return list.filter((z) => z.offset === offset);
  const terms = q.split(" ");
  const rank = (z) => {
    if (fold(z.abbr) === q) return 0; // today's abbreviation
    if (z.abbrs.some((a) => fold(a) === q)) return 1; // the other season's
    if (fold(z.country) === q) return 2;
    if (fold(z.city) === q || z.cities.some((c) => fold(c) === q)) return 3;
    if (fold(z.city).startsWith(q) || fold(z.country).startsWith(q)) return 4;
    return 5;
  };
  return list
    .filter((z) => terms.every((t) => z.hay.includes(t)))
    .map((z, i) => [rank(z), i, z])
    .sort((a, b) => a[0] - b[0] || a[1] - b[1])
    .map((x) => x[2]);
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
