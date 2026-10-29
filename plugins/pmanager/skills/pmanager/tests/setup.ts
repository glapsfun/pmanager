import { afterAll } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { clearGitEnv } from "./git-env";

// A test run started from a git hook must not touch the hook's repository.
clearGitEnv();

// Every fixture, clone and sibling worktree a test run makes lands here, and goes with it.
const runDir = mkdtempSync(join(tmpdir(), "pm-test-run-"));
process.env.TMPDIR = runDir;

afterAll(() => {
  if (process.env.PM_KEEP_TEST_TMP === "1") {
    console.error(`PM_KEEP_TEST_TMP: test fixtures kept in ${runDir}`);
    return;
  }
  rmSync(runDir, { recursive: true, force: true });
});
