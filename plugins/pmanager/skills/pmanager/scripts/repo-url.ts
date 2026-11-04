/**
 * host/owner/repo for scp-style (git@host:o/r.git), ssh:// and https:// remotes,
 * so two spellings of one repository compare equal; anything else is returned trimmed.
 */
export function normalizeRepoUrl(url: string): string {
  const u = url.trim();
  const scp = /^[\w.-]+@([\w.-]+):(.+?)(?:\.git)?\/*$/.exec(u);
  if (scp?.[1] && scp[2]) return `${scp[1].toLowerCase()}/${scp[2]}`;
  const full = /^(?:ssh|https?|git):\/\/(?:[^@/]+@)?([^/:]+)(?::\d+)?\/(.+?)(?:\.git)?\/*$/.exec(u);
  if (full?.[1] && full[2]) return `${full[1].toLowerCase()}/${full[2]}`;
  return u;
}

/** A remote in one of the forms normalizeRepoUrl understands, so a mistyped path is not taken for a URL. */
export function isRemoteUrl(url: string): boolean {
  return normalizeRepoUrl(url) !== url.trim();
}

export function sameRepo(a: string, b: string): boolean {
  return normalizeRepoUrl(a) === normalizeRepoUrl(b);
}

/** The mapped checkout for a URL: the exact key first, so existing maps keep their meaning. */
export function lookupMapped(map: Record<string, string>, url: string): string | undefined {
  if (Object.hasOwn(map, url)) return map[url];
  return Object.entries(map).find(([key]) => sameRepo(key, url))?.[1];
}
