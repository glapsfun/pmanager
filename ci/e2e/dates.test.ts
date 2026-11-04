import { expect, test } from "bun:test";
import { daysBetween, shiftDates } from "./dates";

test("shiftDates by zero leaves text unchanged", () => {
  expect(shiftDates("updated: 2026-10-30", 0)).toBe("updated: 2026-10-30");
});

test("shiftDates crosses month and year boundaries", () => {
  expect(shiftDates("2026-12-25", 10)).toBe("2027-01-04");
});

test("shiftDates leaves versions, addresses, durations and invalid dates alone", () => {
  const text = "tag 1.4.2, chart 4.11.3, ~> 1.48, v1.4.2, 10.0.1.0/24, 86s, 2026-02-30";
  expect(shiftDates(text, 5)).toBe(text);
});

test("shiftDates moves History dates backwards", () => {
  expect(shiftDates("- 2026-11-03 status todo -> in-progress", -3)).toBe(
    "- 2026-10-31 status todo -> in-progress",
  );
});

test("daysBetween counts calendar days", () => {
  expect(daysBetween("2026-11-21", "2026-12-01")).toBe(10);
});

test("shiftDates moves dates next to underscores and a time", () => {
  expect(shiftDates("_Last updated: 2026-10-20_", 1)).toBe("_Last updated: 2026-10-21_");
  expect(shiftDates("2026-11-10T12:00:00", 1)).toBe("2026-11-11T12:00:00");
});
