import { expect, test } from "bun:test";
import {
  bumpFor,
  bumpVersion,
  compareVersions,
  formatVersion,
  highestTag,
  parseVersion,
} from "../scripts/semver";

test("parseVersion accepts plain and v-prefixed, rejects prerelease and junk", () => {
  expect(parseVersion("0.10.0")).toEqual({ major: 0, minor: 10, patch: 0 });
  expect(parseVersion("v1.2.3")).toEqual({ major: 1, minor: 2, patch: 3 });
  for (const bad of ["0.11.0-rc.1", "1.2.3+b", "1.2", "v01.2.3", "x", ""]) {
    expect(parseVersion(bad)).toBeNull();
  }
});

test("compareVersions orders by major, minor, then patch", () => {
  const v = (s: string) => parseVersion(s) ?? { major: -1, minor: 0, patch: 0 };
  expect(compareVersions(v("0.10.0"), v("0.9.9"))).toBeGreaterThan(0);
  expect(compareVersions(v("1.0.0"), v("0.99.0"))).toBeGreaterThan(0);
  expect(compareVersions(v("0.10.1"), v("0.10.1"))).toBe(0);
  expect(compareVersions(v("0.10.0"), v("0.10.1"))).toBeLessThan(0);
});

test("bumpFor below 1.0: breaking or feature is minor, else patch", () => {
  const v = { major: 0, minor: 10, patch: 0 };
  expect(bumpFor(v, { breaking: true, feature: false })).toBe("minor");
  expect(bumpFor(v, { breaking: false, feature: true })).toBe("minor");
  expect(bumpFor(v, { breaking: false, feature: false })).toBe("patch");
});

test("bumpFor from 1.0: breaking major, feature minor, else patch", () => {
  const v = { major: 1, minor: 0, patch: 0 };
  expect(bumpFor(v, { breaking: true, feature: true })).toBe("major");
  expect(bumpFor(v, { breaking: false, feature: true })).toBe("minor");
  expect(bumpFor(v, { breaking: false, feature: false })).toBe("patch");
});

test("bumpVersion resets lower parts", () => {
  expect(formatVersion(bumpVersion({ major: 0, minor: 10, patch: 3 }, "minor"))).toBe("0.11.0");
  expect(formatVersion(bumpVersion({ major: 0, minor: 10, patch: 3 }, "patch"))).toBe("0.10.4");
  expect(formatVersion(bumpVersion({ major: 1, minor: 2, patch: 3 }, "major"))).toBe("2.0.0");
});

test("highestTag sorts by semver and ignores non-v and prerelease tags", () => {
  const tags = ["v0.9.0", "v0.10.0", "0.12.0", "v0.11.0-rc.1", "pmanager@1.0.0"];
  expect(highestTag(tags)).toEqual({ tag: "v0.10.0", version: { major: 0, minor: 10, patch: 0 } });
  expect(highestTag([])).toBeNull();
});
