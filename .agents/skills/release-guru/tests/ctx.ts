import { capture } from "../../../../ci/proc";
import type { Ctx } from "../scripts/context";
import { gitClient } from "../scripts/git";
import { FakeGitHub } from "./fake-github";
import type { Fixture } from "./fixture";

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
  };
}
