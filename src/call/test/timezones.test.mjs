// Unit tests for the time-zone labels and search (src/call/timezones.js).
// Run with: npm run test:timezones
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { allZones, searchZones, zoneInfo, zoneLabel, zoneSummary, parseOffset, gmtStyle, tidyZone } from "../timezones.js";

const data = JSON.parse(fs.readFileSync(new URL("../timezoneData.json", import.meta.url), "utf8"));
const WINTER = new Date("2026-01-15T12:00:00Z");
const SUMMER = new Date("2026-07-15T12:00:00Z");
const label = (id, date = WINTER) => zoneLabel(zoneInfo(id, data, date));
const ids = (list) => list.map((z) => z.id);

test("India: IST, +05:30, India Standard Time, Kolkata, India (all year)", () => {
  for (const d of [WINTER, SUMMER]) assert.equal(label("Asia/Kolkata", d), "(UTC+05:30) IST · India Standard Time · Kolkata, India");
  assert.equal(zoneSummary(zoneInfo("Asia/Kolkata", data, WINTER)), "IST (UTC+05:30), Kolkata, India");
});

test("London: GMT in winter, BST in summer", () => {
  assert.equal(label("Europe/London", WINTER), "(UTC+00:00) GMT · Greenwich Mean Time · London, United Kingdom");
  assert.equal(label("Europe/London", SUMMER), "(UTC+01:00) BST · British Summer Time · London, United Kingdom");
  // Today: whichever applies now.
  const now = zoneInfo("Europe/London", data);
  const offset = new Intl.DateTimeFormat("en-US", { timeZone: "Europe/London", timeZoneName: "shortOffset" }).format(new Date()).endsWith("GMT+1") ? 60 : 0;
  assert.equal(now.offset, offset);
  assert.equal(now.abbr, offset ? "BST" : "GMT");
});

test("New York and Chicago: EST/EDT and CST/CDT, switching on the right days", () => {
  assert.equal(label("America/New_York", WINTER), "(UTC−05:00) EST · Eastern Standard Time · New York, United States");
  assert.equal(label("America/New_York", SUMMER), "(UTC−04:00) EDT · Eastern Daylight Time · New York, United States");
  assert.equal(label("America/Chicago", WINTER), "(UTC−06:00) CST · Central Standard Time · Chicago, United States");
  assert.equal(label("America/Chicago", SUMMER), "(UTC−05:00) CDT · Central Daylight Time · Chicago, United States");
  // US clocks change on 8 March and 1 November 2026.
  assert.equal(zoneInfo("America/Chicago", data, new Date("2026-03-08T07:00:00Z")).abbr, "CST");
  assert.equal(zoneInfo("America/Chicago", data, new Date("2026-03-08T09:00:00Z")).abbr, "CDT");
  assert.equal(zoneInfo("America/New_York", data, new Date("2026-11-01T05:30:00Z")).abbr, "EDT");
  assert.equal(zoneInfo("America/New_York", data, new Date("2026-11-01T06:30:00Z")).abbr, "EST");
});

test("the southern hemisphere: Sydney is AEDT in January and AEST in July", () => {
  assert.equal(label("Australia/Sydney", WINTER), "(UTC+11:00) AEDT · Australian Eastern Daylight Time · Sydney, Australia");
  assert.equal(label("Australia/Sydney", SUMMER), "(UTC+10:00) AEST · Australian Eastern Standard Time · Sydney, Australia");
});

test("half- and quarter-hour zones, and both sides of the date line", () => {
  assert.equal(label("Asia/Kathmandu"), "(UTC+05:45) NPT · Nepal Time · Kathmandu, Nepal");
  assert.equal(label("Asia/Colombo"), "(UTC+05:30) IST · India Standard Time · Colombo, Sri Lanka");
  assert.equal(label("Pacific/Kiritimati"), "(UTC+14:00) LINT · Line Islands Time · Kiritimati, Kiribati");
  // No abbreviation in the data: the offset stands in, the name and place stay.
  assert.equal(label("Pacific/Pago_Pago"), "(UTC−11:00) GMT−11 · American Samoa Standard Time · Pago Pago, American Samoa");
});

test("countries come from the tz database, not the zone's group", () => {
  assert.match(label("Europe/Copenhagen"), /· Copenhagen, Denmark$/);
  assert.match(label("Europe/Oslo"), /· Oslo, Norway$/);
  assert.match(label("America/Detroit"), /^\(UTC−05:00\) EST · .* · Detroit, United States$/);
});

test("a zone missing from the data still shows its offset and id", () => {
  assert.equal(zoneLabel(zoneInfo("Asia/Kolkata", {}, WINTER)), "(UTC+05:30) GMT+5:30 · Asia/Kolkata");
  assert.equal(gmtStyle(180), "GMT+3");
  assert.equal(gmtStyle(-660), "GMT−11");
  assert.equal(gmtStyle(0), "GMT");
});

test("every zone the browser knows is in the list, none dropped, and it's sorted by offset, country, city", () => {
  const list = allZones(WINTER, data);
  const listed = new Set(ids(list));
  for (const z of Intl.supportedValuesOf("timeZone")) assert.ok(listed.has(tidyZone(z)), z);
  assert.ok(listed.has("UTC"));
  for (let i = 1; i < list.length; i++) {
    const a = list[i - 1];
    const b = list[i];
    assert.ok(a.offset <= b.offset, `${a.id} before ${b.id}`);
    if (a.offset === b.offset && a.country && b.country) assert.ok(a.country.localeCompare(b.country) <= 0, `${a.id} before ${b.id}`);
    if (a.offset === b.offset && a.country === b.country && a.country) assert.ok(a.city.localeCompare(b.city) <= 0, `${a.id} before ${b.id}`);
  }
  // Without the data (before it loads), every zone is still there.
  assert.equal(allZones(WINTER, null).length, list.length);
});

test("search: abbreviations come first, and their ambiguity shows", () => {
  const list = allZones(WINTER, data);
  const ist = searchZones(list, "ist");
  assert.equal(ist[0].abbr, "IST");
  const istIds = ids(ist.filter((z) => z.abbrs.includes("IST")));
  for (const id of ["Asia/Kolkata", "Asia/Jerusalem", "Europe/Dublin"]) assert.ok(istIds.includes(id), id);
  assert.ok(ids(ist).indexOf("Asia/Kolkata") < ids(ist).indexOf("Europe/Istanbul"));

  const cst = searchZones(list, "CST");
  const firsts = cst.filter((z) => z.abbrs.includes("CST"));
  assert.deepEqual(cst.slice(0, firsts.length), firsts, "exact matches first");
  const countries = new Set(firsts.map((z) => z.country));
  for (const c of ["China", "United States", "Cuba"]) assert.ok(countries.has(c), c);
  for (const z of firsts) assert.ok(z.label.includes(z.country), z.label);

  assert.equal(searchZones(list, "gmt")[0].abbr, "GMT");
  assert.ok(ids(searchZones(list, "est")).includes("America/New_York"));
  assert.ok(ids(searchZones(list, "bst")).includes("Europe/London"), "BST finds London in winter too");
});

test("search: country, city, name, zone id", () => {
  const list = allZones(WINTER, data);
  assert.equal(searchZones(list, "india")[0].id, "Asia/Kolkata");
  assert.equal(searchZones(list, "India")[0].id, "Asia/Kolkata");
  assert.equal(searchZones(list, "chicago")[0].id, "America/Chicago");
  assert.equal(searchZones(list, "sao paulo")[0].id, "America/Sao_Paulo");
  assert.equal(searchZones(list, "São Paulo")[0].id, "America/Sao_Paulo");
  assert.equal(searchZones(list, "Asia/Kolkata")[0].id, "Asia/Kolkata");
  assert.equal(searchZones(list, "mumbai")[0].id, "Asia/Kolkata", "a main city");
  assert.ok(searchZones(list, "central european").some((z) => z.id === "Europe/Berlin"));
  const us = searchZones(list, "united states");
  assert.ok(us.length > 20 && us.every((z) => z.country === "United States"));
  assert.equal(searchZones(list, "nowhere-at-all").length, 0);
});

test("search: offsets in any common form", () => {
  const list = allZones(WINTER, data);
  for (const q of ["+5:30", "+05:30", "gmt+5:30", "UTC+05:30", " +5 30 "]) {
    const found = searchZones(list, q);
    assert.ok(found.length > 0, q);
    assert.ok(found.every((z) => z.offset === 330), q);
    assert.ok(ids(found).includes("Asia/Kolkata"), q);
  }
  assert.ok(searchZones(list, "utc+5").every((z) => z.offset === 300));
  assert.ok(ids(searchZones(list, "-11")).includes("Pacific/Pago_Pago"));
  assert.ok(ids(searchZones(list, "gmt+14")).includes("Pacific/Kiritimati"));
  assert.equal(parseOffset("+5:45"), 345);
  assert.equal(parseOffset("−3"), -180);
  assert.equal(parseOffset("india"), null);
});
