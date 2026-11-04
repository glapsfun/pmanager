const DAY_MS = 86_400_000;
const DATE = /\b(\d{4})-(\d{2})-(\d{2})\b/g;

function utc(year: number, month: number, day: number): number | null {
  const t = Date.UTC(year, month - 1, day);
  const d = new Date(t);
  // Date.UTC rolls 2026-02-30 over to March; a rollover means it was never a date.
  const same =
    d.getUTCFullYear() === year && d.getUTCMonth() === month - 1 && d.getUTCDate() === day;
  return same ? t : null;
}

function parse(date: string): number {
  const [y, m, d] = date.split("-").map(Number);
  const t = utc(y ?? 0, m ?? 0, d ?? 0);
  if (t === null) throw new Error(`not a date: ${date}`);
  return t;
}

/** Moves every YYYY-MM-DD calendar date in text by `days`; everything else stays as written. */
export function shiftDates(text: string, days: number): string {
  if (days === 0) return text;
  return text.replace(DATE, (whole, y: string, m: string, d: string) => {
    const t = utc(Number(y), Number(m), Number(d));
    return t === null ? whole : new Date(t + days * DAY_MS).toISOString().slice(0, 10);
  });
}

export function daysBetween(from: string, to: string): number {
  return Math.round((parse(to) - parse(from)) / DAY_MS);
}
