import { createHash } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { applyRender } from "../../plugins/pmanager/skills/pmanager/scripts/render";
import { loadPmRepo } from "../../plugins/pmanager/skills/pmanager/scripts/repo";
import { buildWebshopRepo } from "../../plugins/pmanager/skills/pmanager/tests/fixtures/build-webshop";
import { type FixtureInfo, gitCommitAll, headSha } from "../fixture";

export const LESSON_EPIC = "deals-newsletter";
export const SUPERSEDING_EPIC = "flags-in-repo";
export const NEAR_MISS_EPIC = "restock-forecast";

export const MEMO_LESSON_LINE =
  "Every new or changed customer-facing email template needs Legal sign-off on consent and unsubscribe wording; file a LEGAL-REVIEW ticket and allow 5 business days. [user, 2026-04-14]";
export const STALE_MEMO_LINE =
  "Feature flags live in LaunchDarkly (project `webshop`); percentage rollouts are set in the LaunchDarkly dashboard. [user, 2026-02-03]";

interface PriorTask {
  title: string;
  what: string;
  criterion: string;
}

interface PriorEpic {
  slug: string;
  title: string;
  type: "bug" | "feature" | "tech-debt";
  created: string;
  updated: string;
  goal: string;
  metric: string;
  problem: string;
  evidence: string;
  hypothesis: string;
  baseline: string;
  target: string;
  nonGoal: string;
  outcome: string;
  tasks: [PriorTask, PriorTask, PriorTask];
}

const EPICS: PriorEpic[] = [
  {
    slug: LESSON_EPIC,
    title: "Weekly deals newsletter",
    type: "feature",
    created: "2026-04-01",
    updated: "2026-05-28",
    goal: "Raise repeat purchases",
    metric: "newsletter click-through >= 3%",
    problem:
      "Repeat purchase rate has been flat since January. Shoppers who opted in to news hear nothing from us between orders.",
    evidence:
      "| [analytics, 2026-03] | repeat purchase rate flat at 18% for three months | behavioral |",
    hypothesis:
      "We believe a weekly deals email will bring opted-in shoppers back, measured by click-through of at least 3% over four sends.",
    baseline: "none",
    target: ">= 3%",
    nonGoal: "Personalized recommendations; one deals list for everyone.",
    outcome:
      'Hypothesis failed. The newsletter went out on the default `stream="transactional"` (sender `orders@shop.example`), landed in Gmail spam, and order-confirmation delivery dropped for three days; reverted 2026-05-20. Learned: any email the shopper\'s own order did not trigger (newsletters, alerts, reminders) goes out on `stream="bulk"` (sender `news@shop.example`); the transactional stream is for order mail only. Click-through was 0.4% before the revert.',
    tasks: [
      {
        title: "Design the weekly deals template",
        what: "Build the template in `templates/deals.html` with five deal slots.",
        criterion: "The template renders five deals in the preview tool",
      },
      {
        title: "Schedule the weekly send job",
        what: "Add a Monday 09:00 UTC job that sends the template to opted-in shoppers.",
        criterion: "The job sends to every opted-in shopper in staging within 10 minutes",
      },
      {
        title: "Measure click-through over four sends",
        what: "Report click-through per send on the metrics dashboard.",
        criterion: "Click-through for four sends is recorded on the dashboard",
      },
    ],
  },
  {
    slug: SUPERSEDING_EPIC,
    title: "Move feature flags into the repo",
    type: "tech-debt",
    created: "2026-07-01",
    updated: "2026-08-22",
    goal: "Ship small changes safely",
    metric: "flag change lead time <= 1 day",
    problem:
      "Flag changes wait on the one person with LaunchDarkly admin access, and the contract renewal costs more than the team's tooling budget.",
    evidence: "| [user] | flag changes took 4 days on average in Q2 | stated |",
    hypothesis:
      "We believe flags kept in the repo will cut flag change lead time to a day or less, measured over the first month.",
    baseline: "4 days",
    target: "<= 1 day",
    nonGoal: "A flag admin UI.",
    outcome:
      "Held. Flags live in `config/flags.yaml`, read by `app/flags.py` (`is_enabled(name, user_id)`, per-flag `rollout_percent`). LaunchDarkly was removed on 2026-08-20 and its contract ended. Lead time in August was under a day for all 6 changes.",
    tasks: [
      {
        title: "Add config/flags.yaml and app/flags.py",
        what: "Read flags from `config/flags.yaml` with a stable per-user bucket.",
        criterion: "`is_enabled` returns the same answer for a user across 1,000 calls",
      },
      {
        title: "Move every flag out of LaunchDarkly",
        what: "Copy each live flag and its percentage into `config/flags.yaml`.",
        criterion: "All 2 live flags resolve from `config/flags.yaml` in staging",
      },
      {
        title: "Remove the LaunchDarkly SDK",
        what: "Delete the SDK, its key and its client wrapper.",
        criterion: "`grep -ri launchdarkly app/` returns nothing",
      },
    ],
  },
  {
    slug: NEAR_MISS_EPIC,
    title: "Restock forecasting for supplier orders",
    type: "feature",
    created: "2026-04-06",
    updated: "2026-04-22",
    goal: "Fewer lost sales from empty shelves",
    metric: "stockouts per month <= 5",
    problem:
      "Supplier orders are placed by feel, and best sellers run out for days because reorder points ignore supplier lead times.",
    evidence: "| [admin export, 2026-03] | 14 stockouts in March | behavioral |",
    hypothesis:
      "We believe reorder points computed from supplier lead times will cut stockouts to 5 or fewer per month within two months.",
    baseline: "14",
    target: "<= 5",
    nonGoal: "Automatic purchase orders; staff still place them.",
    outcome:
      "Held. Stockouts fell to 4 in June. Reorder points now come from each supplier's median lead time over the last 90 days.",
    tasks: [
      {
        title: "Record supplier lead times",
        what: "Store the order and delivery date of every supplier order.",
        criterion: "Lead time is stored for 100% of supplier orders placed after release",
      },
      {
        title: "Compute reorder points",
        what: "Nightly job computes a reorder point per product from lead time and sales rate.",
        criterion: "Every active product has a reorder point after the nightly run",
      },
      {
        title: "Show the reorder list in the admin panel",
        what: "List products at or below their reorder point.",
        criterion: "The list matches the nightly job output for 20 sampled products",
      },
    ],
  },
  {
    slug: "app-performance",
    title: "Fix orders page latency",
    type: "bug",
    created: "2026-09-01",
    updated: "2026-09-10",
    goal: "Keep checkout conversion stable",
    metric: "p95 /orders < 500ms",
    problem:
      "The /orders page returned every order since pagination was removed, with one item query per order.",
    evidence: "| [app/app.py:15] | N+1 query per order in /orders | behavioral |",
    hypothesis:
      "We believe restoring pagination and batching item queries will bring p95 /orders under 500ms within a week of ship.",
    baseline: "3.4s",
    target: "< 500ms",
    nonGoal: "A storage-layer rewrite.",
    outcome: "Held. p95 /orders fell to 310ms in the week after ship.",
    tasks: [
      {
        title: "Benchmark orders endpoint",
        what: "Seed 1,000 orders and time GET /orders 20 times.",
        criterion: "A results file records p50 and p95 for /orders",
      },
      {
        title: "Batch item queries",
        what: "Load items for a page of orders in one query.",
        criterion: "GET /orders issues 2 queries per request",
      },
      {
        title: "Restore pagination",
        what: "Return 50 orders per page.",
        criterion: "GET /orders returns at most 50 rows",
      },
    ],
  },
  {
    slug: "checkout-idempotency",
    title: "Prevent duplicate charges on checkout retry",
    type: "bug",
    created: "2026-02-02",
    updated: "2026-02-25",
    goal: "Keep checkout conversion stable",
    metric: "duplicate charges per month = 0",
    problem: "A double click on Pay, or a retried request, charged some shoppers twice.",
    evidence:
      "| [support tickets, 2026-01] | 9 duplicate charge complaints in January | behavioral |",
    hypothesis:
      "We believe an idempotency key on checkout will bring duplicate charges to zero within a month.",
    baseline: "9",
    target: "0",
    nonGoal: "Changing payment providers.",
    outcome: "Held. No duplicate charges in March or April.",
    tasks: [
      {
        title: "Send an idempotency key from the checkout page",
        what: "Generate one key per checkout attempt.",
        criterion: "Every checkout request in staging carries a key",
      },
      {
        title: "Return the first result for a repeated key",
        what: "Store results by key for 24 hours.",
        criterion: "Two requests with one key create 1 charge",
      },
      {
        title: "Verify provider webhooks by signature",
        what: "Reject unsigned webhook calls.",
        criterion: "An unsigned webhook gets HTTP 401",
      },
    ],
  },
  {
    slug: "guest-checkout",
    title: "Guest checkout without an account",
    type: "feature",
    created: "2026-01-26",
    updated: "2026-02-18",
    goal: "Keep checkout conversion stable",
    metric: "checkout completion >= 62%",
    problem: "Shoppers abandon checkout at the sign-up step.",
    evidence: "| [analytics, 2026-01] | 38% of checkouts end at sign-up | behavioral |",
    hypothesis:
      "We believe guest checkout will raise checkout completion from 55% to 62% within a month.",
    baseline: "55%",
    target: ">= 62%",
    nonGoal: "Social login.",
    outcome: "Held. Completion reached 64% in March.",
    tasks: [
      {
        title: "Allow orders without an account",
        what: "Accept checkout with a name, address and phone number.",
        criterion: "A guest order completes in staging",
      },
      {
        title: "Let shoppers claim guest orders later",
        what: "Link an order to an account from its order number and postcode.",
        criterion: "A claimed order appears on the account's /orders page",
      },
      {
        title: "Measure completion for four weeks",
        what: "Add completion rate to the checkout dashboard.",
        criterion: "Completion rate is on the dashboard for 4 weeks",
      },
    ],
  },
  {
    slug: "admin-refunds",
    title: "Refunds from the admin panel",
    type: "feature",
    created: "2026-02-23",
    updated: "2026-03-12",
    goal: "Lower support cost per order",
    metric: "refund handling time <= 10 min",
    problem: "Refunds need a developer to run a script, so they take a day.",
    evidence: "| [support log, 2026-02] | median refund time 26 hours | behavioral |",
    hypothesis:
      "We believe refunds in the admin panel will cut handling time to 10 minutes or less within a month.",
    baseline: "26 hours",
    target: "<= 10 min",
    nonGoal: "Partial refunds per line item.",
    outcome: "Held. Median handling time is 6 minutes.",
    tasks: [
      {
        title: "Add a refund button to the order view",
        what: "Refund the full order through the payment provider.",
        criterion: "A refund in staging reaches the provider sandbox",
      },
      {
        title: "Require a second approver above 500 EUR",
        what: "Hold large refunds until a second admin approves.",
        criterion: "A 600 EUR refund waits for a second approval",
      },
      {
        title: "Log every refund",
        what: "Record who refunded what and when.",
        criterion: "Every refund has a log row with the admin's id",
      },
    ],
  },
  {
    slug: "image-cdn",
    title: "Serve product images from a CDN",
    type: "tech-debt",
    created: "2026-03-09",
    updated: "2026-03-30",
    goal: "Fast pages on mobile",
    metric: "product page LCP p75 <= 2.5s",
    problem: "Product images are served by the app servers at full size.",
    evidence: "| [web vitals, 2026-02] | product page LCP p75 4.1s | behavioral |",
    hypothesis:
      "We believe resized images from a CDN will bring product page LCP p75 to 2.5s or less within two weeks.",
    baseline: "4.1s",
    target: "<= 2.5s",
    nonGoal: "A new image upload flow.",
    outcome: "Held. LCP p75 is 2.2s.",
    tasks: [
      {
        title: "Upload images to the CDN bucket",
        what: "Copy every product image to the bucket behind img.shop.example.",
        criterion: "All product images resolve from img.shop.example",
      },
      {
        title: "Serve resized variants",
        what: "Request width-specific variants from the CDN.",
        criterion: "Product pages load images at most 800px wide on mobile",
      },
      {
        title: "Measure LCP for two weeks",
        what: "Track LCP p75 on the web vitals dashboard.",
        criterion: "LCP p75 is recorded for 14 days",
      },
    ],
  },
  {
    slug: "tax-rounding",
    title: "Exact tax totals in cents",
    type: "bug",
    created: "2026-05-18",
    updated: "2026-06-10",
    goal: "Clean books",
    metric: "rounding mismatches per month = 0",
    problem: "Order totals computed in floats differ from the ledger by a cent on some orders.",
    evidence: "| [finance report, 2026-05] | 31 one-cent mismatches in April | behavioral |",
    hypothesis: "We believe integer-cent totals will bring mismatches to zero within a month.",
    baseline: "31",
    target: "0",
    nonGoal: "Changing VAT rules.",
    outcome: "Held. No mismatches in June.",
    tasks: [
      {
        title: "Store totals as integer cents",
        what: "Add `total_cents` and backfill it.",
        criterion: "Every order has `total_cents` after the backfill",
      },
      {
        title: "Compute tax in cents",
        what: "Round once, at the line level, in integer math.",
        criterion: "1,000 sampled orders match the ledger to the cent",
      },
      {
        title: "Drop float totals from new code paths",
        what: "Read `total_cents` everywhere except display.",
        criterion: "`grep -n 'total *=' app/` finds no float arithmetic",
      },
    ],
  },
  {
    slug: "review-moderation",
    title: "Moderate product reviews before publishing",
    type: "feature",
    created: "2026-06-15",
    updated: "2026-07-15",
    goal: "Trustworthy product pages",
    metric: "abusive reviews published per month = 0",
    problem: "Reviews publish instantly, and abusive ones stay up until someone complains.",
    evidence: "| [support tickets, 2026-05] | 7 abusive reviews reported in May | behavioral |",
    hypothesis:
      "We believe holding reviews for moderation will bring published abusive reviews to zero within a month.",
    baseline: "7",
    target: "0",
    nonGoal: "Automatic sentiment scoring.",
    outcome: "Held. None published in July; median time to publish is 5 hours.",
    tasks: [
      {
        title: "Hold new reviews as pending",
        what: "New reviews start hidden until approved.",
        criterion: "A new review in staging is hidden until approved",
      },
      {
        title: "Add a moderation queue to the admin panel",
        what: "List pending reviews with approve and reject.",
        criterion: "Approving a review publishes it within 1 minute",
      },
      {
        title: "Measure time to publish",
        what: "Track hours from submit to approval.",
        criterion: "Median time to publish is on the dashboard",
      },
    ],
  },
  {
    slug: "session-timeouts",
    title: "Keep carts across session timeouts",
    type: "bug",
    created: "2026-07-20",
    updated: "2026-08-05",
    goal: "Keep checkout conversion stable",
    metric: "carts lost to timeouts per week = 0",
    problem: "Carts are tied to the session, so a timeout empties them.",
    evidence: "| [support tickets, 2026-07] | 12 lost cart complaints in July | behavioral |",
    hypothesis: "We believe storing carts server-side will stop timeouts emptying carts.",
    baseline: "12",
    target: "0",
    nonGoal: "Sharing carts across devices.",
    outcome: "Held. No lost cart complaints since the fix.",
    tasks: [
      {
        title: "Store carts server-side",
        what: "Key carts by a long-lived cookie, not the session.",
        criterion: "A cart survives a session timeout in staging",
      },
      {
        title: "Extend the cart cookie to 30 days",
        what: "Set the cart cookie lifetime to 30 days.",
        criterion: "The cookie's Max-Age is 2592000",
      },
      {
        title: "Clean up abandoned carts",
        what: "Delete carts untouched for 30 days.",
        criterion: "The cleanup job removes carts older than 30 days",
      },
    ],
  },
  {
    slug: "search-relevance",
    title: "Search ranking for catalog queries",
    type: "feature",
    created: "2026-08-10",
    updated: "2026-08-28",
    goal: "Shoppers find what they came for",
    metric: "search exits <= 20%",
    problem: "Search matches words anywhere in descriptions, so exact product names rank low.",
    evidence: "| [analytics, 2026-07] | 34% of searches end without a click | behavioral |",
    hypothesis:
      "We believe weighting names over descriptions will cut search exits to 20% or less within two weeks.",
    baseline: "34%",
    target: "<= 20%",
    nonGoal: "A separate search service.",
    outcome: "Held. Search exits are 18%.",
    tasks: [
      {
        title: "Weight names over descriptions",
        what: "Use Postgres full-text ranks with name weight A.",
        criterion: "An exact name query ranks that item first for 20 sampled names",
      },
      {
        title: "Add a search exit metric",
        what: "Count searches that end without a click.",
        criterion: "Search exit rate is on the dashboard",
      },
      {
        title: "Measure for two weeks",
        what: "Compare exit rate before and after.",
        criterion: "Exit rate is recorded for 14 days",
      },
    ],
  },
];

export const PRIOR_EPICS: readonly string[] = EPICS.map((e) => e.slug);

const CONVENTIONS = [
  "Deploys go out Tuesday and Thursday before 11:00; no deploys on Fridays or during the December freeze. [user, 2026-01-12]",
  "All schema changes need DBA review. [user, 2026-01-12]",
  "Production runs Postgres 16; local development uses SQLite. [app/app.py, 2026-01-15]",
  "Money is stored as integer cents; floats appear only in display code. [tax-rounding, 2026-06-10]",
  "Every PR needs one approval from the web team before merge. [user, 2026-01-12]",
  "Python code targets 3.12 and is formatted with ruff. [user, 2026-01-20]",
  "API responses use snake_case keys. [app/app.py, 2026-01-20]",
  "Prices shown to shoppers include VAT; the admin panel shows net prices. [user, 2026-02-11]",
  "Product images are served from the CDN at img.shop.example, never from the app servers. [image-cdn, 2026-03-30]",
  "Checkout requests carry an idempotency key; a retried key returns the first result. [checkout-idempotency, 2026-02-25]",
  "Refunds above 500 EUR need a second approver in the admin panel. [admin-refunds, 2026-03-12]",
  "Guest orders can be claimed into an account later from the order number and postcode. [guest-checkout, 2026-02-18]",
  "Cart cookies last 30 days; carts survive a session timeout. [session-timeouts, 2026-08-05]",
  "Search runs on Postgres full-text search; there is no separate search service. [search-relevance, 2026-08-28]",
  "Product reviews are held for moderation and published within 24 hours. [review-moderation, 2026-07-15]",
  "Background jobs run on the `worker` queue (RQ on Redis); every job must be safe to retry. [user, 2026-03-02]",
  "Scheduled jobs live in `deploy/cron.yaml` and run in UTC. [user, 2026-03-02]",
  "Load tests run against staging only, never production. [user, 2026-01-28]",
  "Staging is refreshed from an anonymized production snapshot every Monday. [user, 2026-01-28]",
  "Support works 08:00 to 20:00 CET on weekdays; incidents outside those hours page the on-call developer. [user, 2026-02-04]",
  MEMO_LESSON_LINE,
  "Translations ship in English and German; every shopper-facing string goes through `i18n/`. [user, 2026-02-20]",
  "Accessibility target is WCAG 2.1 AA for every shopper-facing page. [user, 2026-02-20]",
  "Analytics events are defined in `analytics/events.yaml`; ad hoc events are rejected in review. [user, 2026-03-18]",
  "Personal data is kept for 24 months after the last order, then removed by the retention job. [user, 2026-03-18]",
  "Payment provider webhooks are verified by signature before any order changes state. [checkout-idempotency, 2026-02-25]",
  "The admin panel is internal only and sits behind the office VPN. [user, 2026-03-12]",
  "Supplier orders are placed from the admin panel; the warehouse confirms stock counts nightly. [restock-forecast, 2026-04-22]",
  "Stock counts in the database are the source of truth; the warehouse sheet is advisory. [restock-forecast, 2026-04-22]",
  "Errors go to Sentry; every new endpoint reports there. [user, 2026-01-15]",
  "Dashboards live in Grafana; every epic's primary metric gets a panel before ship. [user, 2026-02-04]",
  "The orders page is paginated at 50 rows; no endpoint returns an unbounded list. [app-performance, 2026-09-10]",
  STALE_MEMO_LINE,
  "Third-party scripts on shopper pages need the web team lead's approval for page weight. [user, 2026-05-06]",
  "Page weight budget for product pages is 1.5 MB on first load. [image-cdn, 2026-03-30]",
  "Breaking API changes keep the old field for one release before removal. [user, 2026-05-06]",
  "Database migrations are numbered SQL files applied by `scripts/migrate.py` before the app starts. [user, 2026-01-12]",
  "Shopper-facing copy changes go through the content editor, not straight to code. [user, 2026-05-12]",
  "Each epic's validation window is at least one week of production traffic. [user, 2026-06-01]",
  "Work in an area nobody has touched for six months starts with a spike task. [user, 2026-06-01]",
];

const MEMO = `# PManager memo

_Last updated: 2026-09-10_

## 1. Product context

A web shop selling home goods in Germany and Austria. Shoppers browse the catalog, check out as guests or with an account, and view order history on /orders. Revenue comes from product sales.

## 2. Business goals & north star

| Goal | Metric / north star | Source |
| :--- | :--- | :--- |
| Keep checkout conversion stable | conversion rate | [user, 2026-01-12] |
| Raise repeat purchases | repeat purchase rate | [user, 2026-03-02] |

## 3. Stakeholders

| Who | Cares about | Consulted via |
| :--- | :--- | :--- |
| web team | shopper-facing pages, API | PR review |
| support | refunds, complaints | weekly sync |
| finance | totals, refunds | monthly report |

## 4. Conventions & constraints

${CONVENTIONS.map((c) => `- ${c}`).join("\n")}

## 5. Changelog

<!-- pm:log:start -->
<!-- pm:log:end -->
`;

export const CODE_FILES: Record<string, string> = {
  "app/mailer.py": `STREAMS = ("transactional", "bulk")
SENDERS = {"transactional": "orders@shop.example", "bulk": "news@shop.example"}


def send(to, template, *, stream="transactional", **context):
    if stream not in STREAMS:
        raise ValueError(f"unknown stream {stream}")
    _deliver(SENDERS[stream], to, template, context)


def _deliver(sender, to, template, context):
    # the provider client is configured per environment
    raise NotImplementedError
`,
  "app/checkout.py": `from app import mailer


def confirm_order(order_id, shopper_email):
    mailer.send(shopper_email, "order-confirmation", order_id=order_id)
`,
  "app/catalog.py": `import sqlite3

from flask import Blueprint, jsonify

catalog = Blueprint("catalog", __name__)


def db():
    return sqlite3.connect("webshop.db")


@catalog.get("/products/<int:product_id>")
def product(product_id):
    row = db().execute(
        "SELECT id, name, price_cents, stock FROM products WHERE id = ?", (product_id,)
    ).fetchone()
    if row is None:
        return jsonify({"error": "not found"}), 404
    pid, name, price_cents, stock = row
    return jsonify(
        {"id": pid, "name": name, "price_cents": price_cents, "stock": stock, "sold_out": stock == 0}
    )
`,
  "app/catalog.sql": `CREATE TABLE products (
  id INTEGER PRIMARY KEY,
  name TEXT NOT NULL,
  price_cents INTEGER NOT NULL,
  stock INTEGER NOT NULL
);
`,
  "app/flags.py": `import hashlib
import pathlib

import yaml

FLAGS_FILE = pathlib.Path(__file__).resolve().parent.parent / "config" / "flags.yaml"


def _load():
    return yaml.safe_load(FLAGS_FILE.read_text()) or {}


def is_enabled(name, user_id):
    flag = _load().get(name)
    if not flag or not flag.get("enabled", False):
        return False
    # a stable bucket keeps each shopper on the same side as the percentage grows
    bucket = int(hashlib.sha256(f"{name}:{user_id}".encode()).hexdigest(), 16) % 100
    return bucket < flag.get("rollout_percent", 100)
`,
  "config/flags.yaml": `guest_checkout:
  enabled: true
  rollout_percent: 100
review_moderation:
  enabled: true
  rollout_percent: 25
`,
};

const REPO_URL = "git@github.com:glapsfun/webshop.git";

function epicDoc(e: PriorEpic): string {
  return `---
id: ${e.slug}
title: ${e.title}
type: ${e.type}
status: done
business-goal: ${e.goal}
owner: unassigned
created: ${e.created}
updated: ${e.updated}
contract: 1
repos:
  - ${REPO_URL}
primary-metric: ${e.metric}
---

# ${e.title}

## Problem statement

${e.problem}

## Evidence

| Source | Finding | Kind |
| :--- | :--- | :--- |
${e.evidence}

**Confidence:** medium.

## Hypothesis

${e.hypothesis}

## Success metrics

| Metric | Role | Current | Target | Window | Measured via |
| :--- | :--- | :--- | :--- | :--- | :--- |
| ${e.metric.split(/\s+(?:>=|<=|<|=)\s+/)[0]} | primary | ${e.baseline} | ${e.target} | 4 weeks post-ship | dashboard |

## Scope

- ${e.tasks.map((t) => t.title).join("\n- ")}

## Non-goals

- ${e.nonGoal}

## Related prior work

none

## Outcome

${e.outcome}
`;
}

function planDoc(e: PriorEpic): string {
  return `---
epic: ${e.slug}
status: done
updated: ${e.updated}
contract: 1
---

# Plan: ${e.title}

## Approach

${e.tasks.map((t) => t.what).join(" ")}

## Milestones

### M1: Shipped and measured
Exit criteria:
- [x] ${e.metric} measured over the validation window

## Task breakdown & traceability

<!-- pm:tasks:start -->
<!-- pm:tasks:end -->

## Prioritization

- Must: T01, T02, T03
- Should: none
- Could: none
- Won't (this epic): ${e.nonGoal}

## Risk register

| Risk | Likelihood | Impact | Mitigation | Trigger / early signal |
| :--- | :--- | :--- | :--- | :--- |
| Metric moves for unrelated reasons | med | med | compare with the prior month | change in traffic mix |

## Changelog

| Date | Change | Why |
| :--- | :--- | :--- |
| ${e.created} | Plan created | spec |
| ${e.updated} | Epic done | outcome recorded |
`;
}

function taskDoc(e: PriorEpic, i: number): string {
  const t = e.tasks[i] as PriorTask;
  const id = `T0${i + 1}`;
  const deps = i === 0 ? "[]" : `[T0${i}]`;
  return `---
id: ${id}
epic: ${e.slug}
milestone: M1
title: ${t.title}
status: done
priority: must
depends-on: ${deps}
estimate: S
owner: unassigned
updated: ${e.updated}
contract: 1
---

# ${id}: ${t.title}

## Context

Part of ${e.title} (../epic.md).

## What to do

${t.what}

## Acceptance criteria

- [x] ${t.criterion}

## Out of scope

- ${e.nonGoal}

## Notes
`;
}

function slugName(title: string): string {
  return title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .split("-")
    .slice(0, 4)
    .join("-");
}

async function put(dir: string, rel: string, body: string): Promise<void> {
  const path = join(dir, rel);
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, body);
}

async function writePmDocs(dir: string): Promise<void> {
  await put(dir, "docs/pm/pmanager-memo.md", MEMO);
  for (const e of EPICS) {
    const base = `docs/pm/${e.slug}`;
    await put(dir, `${base}/epic.md`, epicDoc(e));
    await put(dir, `${base}/plan.md`, planDoc(e));
    for (let i = 0; i < e.tasks.length; i++) {
      const t = e.tasks[i] as PriorTask;
      await put(dir, `${base}/tasks/T0${i + 1}-${slugName(t.title)}.md`, taskDoc(e, i));
    }
    // log ids are random in real runs; a hash keeps the fixture byte-identical between builds
    const id = createHash("sha256").update(e.slug).digest("hex").slice(0, 6);
    await put(
      dir,
      `docs/pm/log/${e.created}-${e.slug}-${id}.md`,
      `---\ndate: ${e.created}\nepic: ${e.slug}\nharness: claude-code\nkind: spec\n---\nspec'd ${e.slug}\n`,
    );
  }
}

export async function buildMemoryRecallFixture(dir: string): Promise<FixtureInfo> {
  await buildWebshopRepo(dir, { withPmDocs: false });
  for (const [rel, body] of Object.entries(CODE_FILES)) await put(dir, rel, body);
  await gitCommitAll(dir, "feat: catalog, mailer and in-repo feature flags");
  await writePmDocs(dir);
  await applyRender(await loadPmRepo(dir));
  await gitCommitAll(dir, "docs(pm): twelve epics and the product memo");
  return {
    baselineSha: await headSha(dir),
    originBare: null,
    originRefs: {},
    epicSlugsBefore: [...PRIOR_EPICS],
    initialDirty: {},
  };
}
