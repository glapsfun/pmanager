export interface Version {
  major: number;
  minor: number;
  patch: number;
}

export type Bump = "major" | "minor" | "patch";

const VERSION = /^v?(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/;

/** "1.2.3" or "v1.2.3"; prerelease and build versions are not releases here, so they are null. */
export function parseVersion(s: string): Version | null {
  const m = VERSION.exec(s);
  if (!m) return null;
  return { major: Number(m[1]), minor: Number(m[2]), patch: Number(m[3]) };
}

export function formatVersion(v: Version): string {
  return `${v.major}.${v.minor}.${v.patch}`;
}

export function compareVersions(a: Version, b: Version): number {
  return a.major - b.major || a.minor - b.minor || a.patch - b.patch;
}

/** Below 1.0 a breaking change bumps minor, as features do. */
export function bumpFor(v: Version, k: { breaking: boolean; feature: boolean }): Bump {
  if (k.breaking) return v.major === 0 ? "minor" : "major";
  return k.feature ? "minor" : "patch";
}

export function bumpVersion(v: Version, b: Bump): Version {
  if (b === "major") return { major: v.major + 1, minor: 0, patch: 0 };
  if (b === "minor") return { major: v.major, minor: v.minor + 1, patch: 0 };
  return { major: v.major, minor: v.minor, patch: v.patch + 1 };
}

/** The highest vX.Y.Z tag; other names are not release tags. */
export function highestTag(tags: string[]): { tag: string; version: Version } | null {
  let best: { tag: string; version: Version } | null = null;
  for (const tag of tags) {
    if (!tag.startsWith("v")) continue;
    const version = parseVersion(tag);
    if (version && (!best || compareVersions(version, best.version) > 0)) best = { tag, version };
  }
  return best;
}
