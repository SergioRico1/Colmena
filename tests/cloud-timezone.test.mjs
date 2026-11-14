// Phase 4 (docs/CLOUD.md): routines in the company's time zone, DST-correct, and the desktop's
// local-time arithmetic unchanged when there is no zone.
import { test } from "node:test";
import assert from "node:assert/strict";
import { zoned, offsetAt, validTimeZone, cleanTimeZone, clockOf } from "../server/timezone.mjs";
import { nextRun, isHoliday, subtitle } from "../server/triggers.mjs";

const MAD = "Europe/Madrid";
const NY = "America/New_York";
const iso = (d) => new Date(d).toISOString();

test("zones: names are checked, empty means local time", () => {
  assert.equal(validTimeZone(MAD), true);
  assert.equal(validTimeZone("UTC"), true);
  assert.equal(validTimeZone("Mars/Olympus"), false);
  assert.equal(validTimeZone(""), false);
  assert.equal(cleanTimeZone("local"), null);
  assert.equal(cleanTimeZone("Nowhere/Here"), null);
  assert.equal(zoned(null).tz, null);
  assert.equal(zoned(MAD).tz, MAD);
});

test("zones: offsets of Madrid in winter and summer", () => {
  assert.equal(offsetAt(MAD, Date.parse("2026-01-15T12:00:00Z")), 3600000);
  assert.equal(offsetAt(MAD, Date.parse("2026-07-15T12:00:00Z")), 7200000);
  assert.equal(offsetAt("UTC", Date.parse("2026-07-15T12:00:00Z")), 0);
});

test("zones: wall-clock times resolve to the right instant, also on DST days", () => {
  const Z = zoned(MAD);
  assert.equal(iso(Z.make(2026, 0, 15, 9, 0)), "2026-01-15T08:00:00.000Z");
  assert.equal(iso(Z.make(2026, 6, 15, 9, 0)), "2026-07-15T07:00:00.000Z");
  // Spring forward, 2026-03-29: 02:00 → 03:00. 01:30 is still winter; 02:30 does not exist and moves forward to 03:30.
  assert.equal(iso(Z.make(2026, 2, 29, 1, 30)), "2026-03-29T00:30:00.000Z");
  assert.equal(iso(Z.make(2026, 2, 29, 2, 30)), "2026-03-29T01:30:00.000Z");
  assert.equal(clockOf(Z.make(2026, 2, 29, 2, 30), MAD), "03:30");
  assert.equal(iso(Z.make(2026, 2, 29, 9, 0)), "2026-03-29T07:00:00.000Z");
  // Fall back, 2026-10-25: 03:00 → 02:00. 02:30 happens twice: the first one (summer time) wins.
  assert.equal(iso(Z.make(2026, 9, 25, 2, 30)), "2026-10-25T00:30:00.000Z");
  assert.equal(iso(Z.make(2026, 9, 25, 9, 0)), "2026-10-25T08:00:00.000Z");
  // Overflowing fields behave like Date's: the 32nd of January is the 1st of February.
  assert.equal(iso(Z.make(2026, 0, 32, 9, 0)), "2026-02-01T08:00:00.000Z");
  const p = Z.parts(new Date("2026-03-29T01:30:00Z"));
  assert.deepEqual([p.year, p.month, p.day, p.hours, p.minutes, p.weekday], [2026, 2, 29, 3, 30, 0]);
});

const daily = (hora, dias = [0, 1, 2, 3, 4, 5, 6], extra = {}) => ({ type: "dia", config: { hora, dias, festivo: "igual", ...extra } });

test("routines: 9:00 every day in Madrid fires at 08:00Z in winter and 07:00Z in summer, across both DST changes", () => {
  const spring = [];
  let at = new Date("2026-03-27T12:00:00Z");
  for (let i = 0; i < 4; i++) { const n = nextRun(daily("09:00"), at, { tz: MAD }); spring.push(n); at = new Date(n); }
  assert.deepEqual(spring, ["2026-03-28T08:00:00.000Z", "2026-03-29T07:00:00.000Z", "2026-03-30T07:00:00.000Z", "2026-03-31T07:00:00.000Z"]);
  const autumn = [];
  at = new Date("2026-10-23T12:00:00Z");
  for (let i = 0; i < 4; i++) { const n = nextRun(daily("09:00"), at, { tz: MAD }); autumn.push(n); at = new Date(n); }
  assert.deepEqual(autumn, ["2026-10-24T07:00:00.000Z", "2026-10-25T08:00:00.000Z", "2026-10-26T08:00:00.000Z", "2026-10-27T08:00:00.000Z"]);
});

test("routines: a time inside the spring gap runs once that day, an hour later", () => {
  const n = nextRun(daily("02:30"), new Date("2026-03-28T12:00:00Z"), { tz: MAD });
  assert.equal(n, "2026-03-29T01:30:00.000Z");
  assert.equal(nextRun(daily("02:30"), new Date(n), { tz: MAD }), "2026-03-30T00:30:00.000Z");
  // The repeated hour in autumn also runs once.
  const a = nextRun(daily("02:30"), new Date("2026-10-24T12:00:00Z"), { tz: MAD });
  assert.equal(a, "2026-10-25T00:30:00.000Z");
  assert.equal(nextRun(daily("02:30"), new Date(a), { tz: MAD }), "2026-10-26T01:30:00.000Z");
});

test("routines: weekdays and holidays are judged by the day in the zone, not in UTC", () => {
  // 00:30 on Monday in Madrid is still Sunday in UTC: Monday-to-Friday must include it.
  const n = nextRun(daily("00:30", [1, 2, 3, 4, 5]), new Date("2026-01-10T12:00:00Z"), { tz: MAD });
  assert.equal(n, "2026-01-11T23:30:00.000Z");
  // New Year's Day in Madrid starts at 23:00Z on the 31st.
  assert.equal(isHoliday(new Date("2025-12-31T23:30:00Z"), [], MAD), true);
  assert.equal(isHoliday(new Date("2025-12-31T23:30:00Z"), [], "UTC"), false);
  const skip = nextRun(daily("09:00", [0, 1, 2, 3, 4, 5, 6], { festivo: "saltar" }), new Date("2025-12-31T12:00:00Z"), { tz: MAD });
  assert.equal(skip, "2026-01-02T08:00:00.000Z");
});

test("routines: weekly and one-off triggers in a zone; other zones too", () => {
  const weekly = { type: "semana", config: { semDia: 1, semHora: "09:00", semCada: 1 } };
  assert.equal(nextRun(weekly, new Date("2026-03-25T12:00:00Z"), { tz: MAD, anchor: "2026-03-01T00:00:00Z" }), "2026-03-30T07:00:00.000Z");
  const once = { type: "vez", config: { vezFecha: "2026-11-02", vezHora: "09:00" } };
  assert.equal(nextRun(once, new Date("2026-11-01T00:00:00Z"), { tz: MAD }), "2026-11-02T08:00:00.000Z");
  assert.equal(nextRun(once, new Date("2026-11-01T00:00:00Z"), { tz: NY }), "2026-11-02T14:00:00.000Z");
  // New York changes on 2026-11-01: 9:00 that Sunday is already winter time.
  assert.equal(nextRun(daily("09:00"), new Date("2026-10-31T14:00:00Z"), { tz: NY }), "2026-11-01T14:00:00.000Z");
});

test("routines: with no zone the arithmetic is the machine's local time, as before", () => {
  const from = new Date(2026, 5, 10, 12, 0);
  const expected = new Date(2026, 5, 11, 9, 0).toISOString();
  assert.equal(nextRun(daily("09:00"), from), expected);
  assert.equal(nextRun(daily("09:00"), from, { tz: null }), expected);
  const once = { type: "vez", config: { vezFecha: "2026-06-20", vezHora: "08:15" } };
  assert.equal(nextRun(once, from), new Date(2026, 5, 20, 8, 15).toISOString());
});

test("routines: the subtitle says the next time in the company's zone", () => {
  const rule = { enabled: true, trigger: daily("09:00"), nextRun: "2026-07-15T07:00:00.000Z" };
  assert.match(subtitle(rule, new Date("2026-07-14T10:00:00Z"), { tz: MAD }), /09:00$/);
  assert.match(subtitle(rule, new Date("2026-07-14T10:00:00Z"), { tz: "UTC" }), /07:00$/);
});
