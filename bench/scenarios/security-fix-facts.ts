// Placeholders like the example's other targets; nothing fetches them.
export const STOREFRONT_URL = "https://github.com/pm-example/storefront.git";
export const WORKER_URL = "https://github.com/pm-example/worker.git";

export type FindingKey = "npm" | "go" | "python" | "image";

/** One finding of the ticket, copied from its advisory record (read 2026-11-12). */
export interface Finding {
  key: FindingKey;
  advisory: string;
  cve: string;
  url: string;
  ecosystem: string;
  pkg: string;
  /** a Bun.semver range for the fixture test and the grader; the image's is text only */
  affected: string;
  /** as the advisory record writes it, for the ticket */
  affectedText: string;
  fixed: string;
  named: "storefront" | "orders" | "worker";
}

export const FINDINGS: Finding[] = [
  {
    key: "npm",
    advisory: "GHSA-rhx6-c78j-4q9w",
    cve: "CVE-2024-52798",
    url: "https://github.com/advisories/GHSA-rhx6-c78j-4q9w",
    ecosystem: "npm",
    pkg: "path-to-regexp",
    affected: "<0.1.12",
    affectedText: "< 0.1.12",
    fixed: "0.1.12",
    named: "storefront",
  },
  {
    key: "go",
    advisory: "GHSA-qxp5-gwg8-xv66",
    cve: "CVE-2025-22870",
    url: "https://github.com/advisories/GHSA-qxp5-gwg8-xv66",
    ecosystem: "Go",
    pkg: "golang.org/x/net",
    affected: "<0.36.0",
    affectedText: "< 0.36.0",
    fixed: "0.36.0",
    named: "orders",
  },
  {
    key: "python",
    advisory: "GHSA-9hjg-9r4m-mvj7",
    cve: "CVE-2024-47081",
    url: "https://github.com/advisories/GHSA-9hjg-9r4m-mvj7",
    ecosystem: "PyPI",
    pkg: "requests",
    affected: "<2.32.4",
    affectedText: "< 2.32.4",
    fixed: "2.32.4",
    named: "worker",
  },
  {
    key: "image",
    advisory: "ALPINE-CVE-2024-12797",
    cve: "CVE-2024-12797",
    url: "https://osv.dev/vulnerability/ALPINE-CVE-2024-12797",
    ecosystem: "Alpine:v3.20",
    pkg: "libssl3",
    affected: "<3.3.3-r0",
    affectedText: "< 3.3.3-r0",
    fixed: "3.3.3-r0",
    named: "storefront",
  },
];

export function finding(key: FindingKey): Finding {
  const f = FINDINGS.find((x) => x.key === key);
  if (!f) throw new Error(`no finding ${key}`);
  return f;
}

/** The direct dependency that pulls a flagged package in, with what its real releases resolve it to. */
export interface Parent {
  repo: "storefront" | "orders" | "webshop";
  finding: "npm" | "go";
  pkg: string;
  current: string;
  /** the first release whose resolution is fixed, or no longer needs the package */
  firstFixing: string;
  /** null: that release no longer requires the flagged package */
  versions: { version: string; resolves: string | null }[];
}

// From the npm registry and the Go module proxy, 2026-11-12.
export const PARENTS: Parent[] = [
  {
    repo: "storefront",
    finding: "npm",
    pkg: "express",
    current: "4.21.1",
    firstFixing: "4.21.2",
    versions: [
      { version: "4.21.1", resolves: "0.1.10" },
      { version: "4.21.2", resolves: "0.1.12" },
      { version: "4.22.3", resolves: "0.1.13" },
    ],
  },
  {
    repo: "orders",
    finding: "go",
    pkg: "github.com/gorilla/websocket",
    current: "v1.5.1",
    firstFixing: "v1.5.3",
    versions: [
      { version: "v1.5.1", resolves: "v0.17.0" },
      { version: "v1.5.2", resolves: "v0.23.0" },
      { version: "v1.5.3", resolves: null },
    ],
  },
  {
    repo: "webshop",
    finding: "go",
    pkg: "github.com/gorilla/websocket",
    current: "v1.5.2",
    firstFixing: "v1.5.3",
    versions: [
      { version: "v1.5.2", resolves: "v0.23.0" },
      { version: "v1.5.3", resolves: null },
    ],
  },
];

/** What the scanner read in storefront's base image (linux/amd64, Alpine 3.20.5). */
export const BASE_IMAGE = {
  image: "node:20.18.1-alpine3.20",
  osPackage: "libssl3",
  installed: "3.3.2-r1",
  fixed: "3.3.3-r0",
};
