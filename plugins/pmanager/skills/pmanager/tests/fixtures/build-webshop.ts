import { readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { copyFixture, gitOk, initGitRepo } from "../helpers";

const PAGINATED = `    page = int(request.args.get("page", 1))
    rows = conn.execute("SELECT id, user_id, total FROM orders ORDER BY id DESC LIMIT 50 OFFSET ?", ((page - 1) * 50,)).fetchall()
`;
const UNPAGINATED = `    rows = conn.execute("SELECT id, user_id, total FROM orders ORDER BY id DESC").fetchall()
`;

/** Build a git repo from the static fixture with the history the evals describe. */
export async function buildWebshopRepo(dest: string): Promise<void> {
  await copyFixture(dest);
  await initGitRepo(dest);
  const pmDir = join(dest, "docs", "pm");
  const appPath = join(dest, "app", "app.py");
  const finalApp = await readFile(appPath, "utf8");
  // commit 1: app with pagination, no docs/pm yet
  await rm(pmDir, { recursive: true, force: true });
  await writeFile(
    appPath,
    finalApp
      .replace(UNPAGINATED, PAGINATED)
      .replace("from flask import Flask, jsonify", "from flask import Flask, jsonify, request"),
  );
  await gitOk(["add", "-A"], dest);
  await gitOk(["commit", "-q", "-m", "feat: orders listing with pagination"], dest);
  // commit 2: pagination removed, dated July
  await writeFile(appPath, finalApp);
  await gitOk(["add", "-A"], dest);
  await gitOk(
    [
      "-c",
      "user.name=dev",
      "-c",
      "user.email=dev@example.com",
      "commit",
      "-q",
      "-m",
      "remove pagination from /orders",
      "--date",
      "2026-07-02T10:00:00",
    ],
    dest,
  );
  // commit 3: docs/pm restored from the fixture
  await copyFixture(dest);
  await gitOk(["add", "-A"], dest);
  await gitOk(["commit", "-q", "-m", "docs(pm): spec app-performance"], dest);
}

if (import.meta.main) {
  const dest = Bun.argv[2];
  if (!dest) {
    console.error("usage: bun run tests/fixtures/build-webshop.ts <dest-dir>");
    process.exit(2);
  }
  await buildWebshopRepo(dest);
  console.log(`built webshop fixture repo at ${dest}`);
}
