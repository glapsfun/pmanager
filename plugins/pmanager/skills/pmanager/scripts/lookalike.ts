import type { Session } from "./contract";

const STOPWORDS = new Set([
  "the",
  "and",
  "for",
  "with",
  "from",
  "into",
  "fix",
  "add",
  "improve",
  "support",
  "make",
  "update",
]);
const CLOSED = new Set(["done", "abandoned"]);

export interface EpicSummary {
  slug: string;
  title: string;
  status: string;
  session: Session | null;
}

/** The words that say what an epic is about: from slug and title, 3+ characters, no stopwords. */
export function epicWords(slug: string, title: string): Set<string> {
  const words = `${slug.replaceAll("-", " ")} ${title}`.toLowerCase().split(/[^a-z0-9]+/);
  return new Set(words.filter((w) => w.length >= 3 && !STOPWORDS.has(w)));
}

export function isLookAlike(a: Set<string>, b: Set<string>): boolean {
  let shared = 0;
  for (const w of a) if (b.has(w)) shared++;
  if (shared >= 2) return true;
  return shared === 1 && (a.size === 1 || b.size === 1);
}

export function findLookAlikes(slug: string, title: string, epics: EpicSummary[]): EpicSummary[] {
  const mine = epicWords(slug, title);
  return epics.filter(
    (e) =>
      e.slug !== slug && !CLOSED.has(e.status) && isLookAlike(mine, epicWords(e.slug, e.title)),
  );
}

export function formatLookAlike(e: EpicSummary): string {
  const owner = e.session ? `${e.session.harness} · ${e.session.claimed}` : "unclaimed";
  return `  ${e.slug}  ${e.status}  ${e.title}  (owner: ${owner})`;
}
