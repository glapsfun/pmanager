import { gitOk, initGitRepo, writeTree } from "../helpers";

const INVOICE = [
  'import { retry } from "../lib/retry";',
  'import type { Invoice } from "./types";',
  "export function retryInvoice(invoice: Invoice) {",
  "  return retry(() => send(invoice), { attempts: 3 });",
  "}",
  "// invoice export retries once more on timeout",
  "",
].join("\n");

function job(n: number): string {
  const id = String(n).padStart(2, "0");
  return [
    `// job ${id}: retry the invoice batch when the upstream ledger is busy, with backoff and jitter`,
    `export const job${id} = { name: "invoice-retry-${id}", retries: 5, backoffMs: 250, jitter: true };`,
    `// the invoice queue retry budget for job ${id} is shared with the nightly reconciliation run`,
    "",
  ].join("\n");
}

/**
 * A repo where `pm research invoice retry` is dominated by noise: a jsonl data file, a lockfile
 * and a minified bundle rank high, one file holds only imports, and one real definition sits
 * behind two import lines. Fifteen similar job files push the output past the default budget.
 */
export async function buildNoisyRepo(dest: string): Promise<void> {
  await initGitRepo(dest);
  const rows = Array.from({ length: 200 }, (_, i) => `{"invoice": ${i}, "retry": ${i % 3}}`);
  const lock = {
    packages: {
      "node_modules/retry": { version: "0.13.1" },
      "node_modules/invoice-pdf": { version: "2.0.0" },
    },
  };
  const files: Record<string, string> = {
    "src/billing/invoice.ts": INVOICE,
    "src/billing/imports-only.ts":
      'import { invoice } from "./invoice";\nimport { retry } from "../lib/retry";\nexport const wired = true;\n',
    "data/invoices.jsonl": `${rows.join("\n")}\n`,
    "package-lock.json": `${JSON.stringify(lock, null, 2)}\n`,
    "dist/billing.min.js": "function retryInvoice(i){return retry(function(){return send(i)})}\n",
    "README.md": "# Billing\n\nFailed invoice exports retry three times before paging.\n",
    "tests/invoice.test.ts":
      'import { retryInvoice } from "../src/billing/invoice";\ntest("invoice retry", () => retryInvoice);\n',
  };
  for (let n = 1; n <= 15; n++) files[`src/jobs/job-${String(n).padStart(2, "0")}.ts`] = job(n);
  await writeTree(dest, files);
  await gitOk(["add", "-A"], dest);
  await gitOk(["commit", "-q", "-m", "seed billing"], dest);
  await writeTree(dest, {
    "src/billing/invoice.ts": `${INVOICE}// export timeout raised to 30s\n`,
  });
  await gitOk(["commit", "-q", "-am", "fix: retry invoice export on timeout"], dest);
}
