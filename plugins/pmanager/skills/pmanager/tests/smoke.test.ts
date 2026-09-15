import { expect, test } from "bun:test";

test("toolchain runs", () => {
  expect(Bun.version.length).toBeGreaterThan(0);
});
