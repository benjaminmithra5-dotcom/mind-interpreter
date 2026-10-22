// Builds src/call/timezoneData.json: names, abbreviations, countries and
// cities for the Talk now time-zone picker. Run with:
//   npm run generate:timezones
// Run it again now and then (for example once a year, or after updating
// @vvo/tzdb or the system's tzdata) and commit the result.
//
// Sources:
//   - @vvo/tzdb (MIT): long names, main cities, and the table that turns a
//     name such as "India Standard Time" into an abbreviation such as IST.
//   - The IANA tz database's zone.tab (public domain): the country of each
//     zone. Read from TZDIR or /usr/share/zoneinfo.
//   - Node's own Intl (ICU): each zone's standard and daylight-saving
//     offsets and names this year, and English country names.
//
// For each zone id the file has one array:
//   [country, city, main cities ("|"-separated, for search), generic name,
//    standard variant, daylight-saving variant or 0]
// where a variant is [offset in minutes, long name, abbreviation or 0].
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const raw = require("@vvo/tzdb/raw-time-zones.json");
const abbreviations = require("@vvo/tzdb/abbreviations.json");

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const out = path.join(root, "src/call/timezoneData.json");
const tzdir = process.env.TZDIR || "/usr/share/zoneinfo";

// Zone -> country code, from the IANA zone.tab.
const countryOf = new Map();
for (const line of fs.readFileSync(path.join(tzdir, "zone.tab"), "utf8").split("\n")) {
  if (!line || line.startsWith("#")) continue;
  const [cc, , zone] = line.split("\t");
  countryOf.set(zone, cc);
}
const regionName = new Intl.DisplayNames(["en"], { type: "region" });

// tzdb entries by their main zone, and the main zone of each linked name.
const primary = new Map(raw.map((z) => [z.name, z]));
const groupOf = new Map();
for (const z of raw) for (const member of z.group) if (!groupOf.has(member)) groupOf.set(member, z);

const longName = (tz, date) =>
  new Intl.DateTimeFormat("en-US", { timeZone: tz, timeZoneName: "long" }).formatToParts(date).find((p) => p.type === "timeZoneName").value;
const offsetAt = (tz, date) => {
  const p = Object.fromEntries(
    new Intl.DateTimeFormat("en-US", { timeZone: tz, hourCycle: "h23", year: "numeric", month: "numeric", day: "numeric", hour: "numeric", minute: "numeric" })
      .formatToParts(date).map((x) => [x.type, x.value]),
  );
  return Math.round((Date.UTC(+p.year, +p.month - 1, +p.day, +p.hour % 24, +p.minute) - date.getTime()) / 60000);
};
// "Central European Standard Time" is listed as "Central European Time", and so on.
const abbreviationFor = (name) =>
  abbreviations[name] || abbreviations[name.replace(" Standard Time", " Time")] || abbreviations[name.replace(" Daylight Time", " Summer Time")] || null;

const year = new Date().getUTCFullYear();
const winter = new Date(Date.UTC(year, 0, 15, 12));
const summer = new Date(Date.UTC(year, 6, 15, 12));

const zones = new Set([...Intl.supportedValuesOf("timeZone"), ...countryOf.keys(), ...primary.keys(), "UTC"]);
const data = {};
for (const id of [...zones].sort()) {
  try { new Intl.DateTimeFormat("en-US", { timeZone: id }); } catch { continue; }
  const entry = primary.get(id) || groupOf.get(id) || null;
  const cc = countryOf.get(id) || (entry && entry.countryCode) || "";
  const variant = (date) => {
    const offset = offsetAt(id, date);
    let name = longName(id, date);
    if (/^GMT([+-]|$)/.test(name)) name = ""; // no real name, only "GMT+3"
    const abbr = name ? abbreviationFor(name) : null;
    return [offset, name, abbr || 0];
  };
  const a = variant(winter);
  const b = variant(summer);
  // Standard time is the smaller offset; daylight saving the larger, if any.
  const [std, dst] = a[0] === b[0] ? [a, null] : a[0] < b[0] ? [a, b] : [b, a];
  const city = id === "UTC" ? "" : id.split("/").pop().replace(/_/g, " ");
  const cities = entry && entry.name === id ? entry.mainCities.filter((c) => c !== city).slice(0, 4) : [];
  data[id] = [
    cc ? regionName.of(cc) : "",
    city,
    cities.join("|"),
    entry ? entry.alternativeName : id === "UTC" ? "Coordinated Universal Time" : "",
    std,
    dst || 0,
  ];
}
data.UTC[4] = [0, "Coordinated Universal Time", "UTC"];

fs.writeFileSync(out, JSON.stringify(data));
const withAbbr = Object.values(data).filter((z) => z[4][2]).length;
console.log(`Wrote ${Object.keys(data).length} zones (${withAbbr} with an abbreviation) to ${path.relative(root, out)} (${fs.statSync(out).size} bytes).`);
