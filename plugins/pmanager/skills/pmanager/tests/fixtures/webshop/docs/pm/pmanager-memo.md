# PManager memo

_Last updated: 2026-09-10_

## 1. Product context

A small web shop. Customers view order history on /orders.

## 2. Business goals & north star

| Goal | Metric / north star | Source |
| :--- | :--- | :--- |
| Keep checkout conversion stable | conversion rate | [user, 2026-09-01] |

## 3. Stakeholders

| Who | Cares about | Consulted via |
| :--- | :--- | :--- |
| web team | /orders latency | PR review |

## 4. Conventions & constraints

All schema changes need DBA review.

## 5. Changelog

<!-- pm:log:start -->
- 2026-09-10 — `app-performance` · spec · spec'd app-performance; learned order history is trust-critical
<!-- pm:log:end -->
