import { mkdir, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { buildWebshopRepo } from "../../plugins/pmanager/skills/pmanager/tests/fixtures/build-webshop";
import { type FixtureInfo, gitCommitAll, headSha } from "../fixture";
import { commonChecks } from "../graders/common";
import { binaryAcceptance, draftAwaitsApproval, epicAndPlan, tasksMin3 } from "../graders/new-epic";
import { planningTrapChecks } from "../graders/planning-traps";
import { CONTRACT_SENTENCE, type Scenario } from "./types";

/** Each file hides one fact a sound plan must act on; none of them names the trap. */
export const TRAP_FILES: Record<string, string> = {
  "migrations/README.md": `# Migrations

Every schema change is a numbered SQL file in this directory
(\`002_<name>.sql\`). \`scripts/migrate.py\` applies pending files in order;
the deploy runs it before the new app version starts.

Rules:

- A backfill of existing rows is its own migration and runs after the
  column exists. Until it has run in production, old rows hold NULL, so no
  reader may rely on the new column before then.
- Never change a column's type in place. Add the new column, backfill it,
  move every reader (including external clients, see docs/clients.md), then
  drop the old column in a later release.
`,
  "migrations/001_init.sql": `CREATE TABLE orders (
  id INTEGER PRIMARY KEY,
  user_id INTEGER NOT NULL,
  total REAL NOT NULL
);

CREATE TABLE order_items (
  id INTEGER PRIMARY KEY,
  order_id INTEGER NOT NULL,
  sku TEXT NOT NULL,
  qty INTEGER NOT NULL
);
`,
  "scripts/migrate.py": `import pathlib
import sqlite3

MIGRATIONS = pathlib.Path(__file__).resolve().parent.parent / "migrations"


def migrate(db_path="webshop.db"):
    conn = sqlite3.connect(db_path)
    conn.execute("CREATE TABLE IF NOT EXISTS schema_migrations (name TEXT PRIMARY KEY)")
    done = {row[0] for row in conn.execute("SELECT name FROM schema_migrations")}
    for path in sorted(MIGRATIONS.glob("*.sql")):
        if path.name in done:
            continue
        conn.executescript(path.read_text())
        conn.execute("INSERT INTO schema_migrations (name) VALUES (?)", (path.name,))
        conn.commit()


if __name__ == "__main__":
    migrate()
`,
  "docs/clients.md": `# API clients

\`GET /orders\` has two readers.

| Client | Repo | Owner |
| :--- | :--- | :--- |
| Web orders page | this repo | web team |
| iOS app | https://github.com/acme/shop-ios | iOS team |

The iOS app decodes \`GET /orders\` with a strict \`Codable\` model:
\`Order { id: Int, user: Int, total: Double, items: [[String, Int]] }\`.
Unknown fields are ignored, but a removed or renamed field or a changed type
makes the order list fail to load. Every shipped app version uses this
model; as of 2026-09-01, 38% of active iOS users run a version older than
the latest. App changes ship from shop-ios through App Store review, about
one week, and the iOS team plans its own sprints.
`,
  "docs/integrations.md": `# Integrations

## ShipFast (carrier)

Shipment events (shipped, delivered) will come from ShipFast webhooks.
Nothing is set up yet: no endpoint, no credentials. Credentials and sandbox
access were requested in OPS-112; ShipFast expects to grant them by
2026-10-20. No webhook work can be tested before then.
`,
};

export async function buildPlanningTrapsFixture(dir: string): Promise<FixtureInfo> {
  await buildWebshopRepo(dir, { withPmDocs: false });
  for (const [rel, body] of Object.entries(TRAP_FILES)) {
    await mkdir(dirname(join(dir, rel)), { recursive: true });
    await writeFile(join(dir, rel), body);
  }
  await gitCommitAll(dir, "docs: migrations, API clients and integrations");
  return {
    baselineSha: await headSha(dir),
    originBare: null,
    originRefs: {},
    epicSlugsBefore: [],
    initialDirty: {},
  };
}

export const planningTraps: Scenario = {
  name: "planning-traps",
  task: `Customers keep asking where their orders are, so we want order status (placed, shipped, delivered) on the orders page and in the iOS app. Finance also keeps flagging rounding errors in order totals; totals have to be exact to the cent. And make the orders page feel nicer while we're at it. Plan this as one epic with a plan and tasks the team can start next sprint. I won't be around for questions, note your assumptions. ${CONTRACT_SENTENCE}`,
  graderVersion: 1,
  buildFixture: buildPlanningTrapsFixture,
  checks: [
    ...commonChecks("spec"),
    epicAndPlan,
    tasksMin3,
    binaryAcceptance,
    draftAwaitsApproval,
    ...planningTrapChecks(),
  ],
};
