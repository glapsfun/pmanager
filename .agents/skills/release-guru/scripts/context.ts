import type { Config } from "./config";
import type { Git, Run } from "./git";
import type { GitHub } from "./github";
import type { Phase, ReleaseState, RouteResult } from "./state";

export interface Ctx {
  cfg: Config;
  git: Git;
  gh: GitHub;
  run: Run;
  now: () => Date;
  spawnDetached: (cmd: string[], cwd: string, logFile: string) => number;
  routes?: Route[];
}

export type Route = (ctx: Ctx, s: ReleaseState, tmp: string) => Promise<RouteResult>;

export interface Result {
  code: 0 | 1 | 2 | 3;
  phase: Phase | "none";
  message: string;
  next?: string;
  blockers?: string[];
  data?: Record<string, unknown>;
}
