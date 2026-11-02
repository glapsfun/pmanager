import { capture } from "../../../../ci/proc";
import type { Ctx, Route } from "../scripts/context";
import { gitClient } from "../scripts/git";
import { FakeGitHub } from "./fake-github";
import type { Fixture } from "./fixture";

/** Verify routes that pass without touching any CLI or network. */
export const OK_ROUTES: Route[] = (["github", "claude-code", "codex", "gskill"] as const).map(
  (route) => async () => ({ route, ok: true, detail: "stubbed" }),
);

export function testCtx(f: Fixture, gh: FakeGitHub = new FakeGitHub(f)): Ctx & { gh: FakeGitHub } {
  return {
    cfg: f.cfg,
    git: gitClient(f.root),
    gh,
    run: capture,
    now: () => new Date(),
    spawnDetached: () => {
      throw new Error("spawnDetached is not scripted in this test");
    },
    routes: OK_ROUTES,
  };
}
