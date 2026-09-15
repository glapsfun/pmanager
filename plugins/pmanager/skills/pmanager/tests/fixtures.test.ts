import { expect, test } from "bun:test";
import { loadPmRepo } from "../scripts/repo";
import { buildWebshopRepo } from "./fixtures/build-webshop";
import { gitOk, makeTempDir } from "./helpers";

test("buildWebshopRepo produces history and a loadable docs/pm", async () => {
  const dest = await makeTempDir("webshop");
  await buildWebshopRepo(dest);
  const log = await gitOk(["log", "--format=%s", "main"], dest);
  expect(log).toContain("remove pagination from /orders");
  const repo = await loadPmRepo(dest);
  expect(repo.epics.map((e) => e.slug)).toEqual(["app-performance"]);
  expect(repo.epics[0]?.tasks).toHaveLength(4);
  expect(repo.logs).toHaveLength(1);
});
