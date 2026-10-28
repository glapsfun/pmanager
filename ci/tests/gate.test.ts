import { expect, test } from "bun:test";
import { main, runChecks } from "../gate";
import { STAGES } from "../stages";

test("unknown name is usage, exit 2", async () => {
  expect(await main(["nope"])).toBe(2);
});

test("stages run cheap checks first", () => {
  expect(STAGES["pre-push"]).toEqual(["lint", "typecheck", "manifest", "audit", "test", "e2e"]);
  expect(STAGES["pre-commit"]).toEqual(["lint-staged", "typecheck"]);
});

test("a missing install stops with the setup hint", async () => {
  const lines: string[] = [];
  const code = await runChecks(
    ["typecheck"],
    { root: "/nowhere", ci: false, args: [] },
    { missingInstall: async () => ["ci"], err: (s) => lines.push(s) },
  );
  const out = lines.join("\n");
  expect(code).toBe(2);
  expect(out).toContain("run: bun run setup");
  expect(out).not.toContain("tsc");
});
