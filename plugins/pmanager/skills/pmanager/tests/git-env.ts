/** Git's repo-local env vars, as `git rev-parse --local-env-vars` prints them; a hook inherits them and they point every child git at the hook's repository. */
export const GIT_LOCAL_ENV: readonly string[] = [
  "GIT_ALTERNATE_OBJECT_DIRECTORIES",
  "GIT_CONFIG",
  "GIT_CONFIG_PARAMETERS",
  "GIT_CONFIG_COUNT",
  "GIT_OBJECT_DIRECTORY",
  "GIT_DIR",
  "GIT_WORK_TREE",
  "GIT_IMPLICIT_WORK_TREE",
  "GIT_GRAFT_FILE",
  "GIT_INDEX_FILE",
  "GIT_NO_REPLACE_OBJECTS",
  "GIT_REPLACE_REF_BASE",
  "GIT_PREFIX",
  "GIT_SHALLOW_FILE",
  "GIT_COMMON_DIR",
];

/** Removes git's repo-local vars from env and returns the ones that were set. */
export function clearGitEnv(env: NodeJS.ProcessEnv = process.env): Record<string, string> {
  const saved: Record<string, string> = {};
  for (const name of GIT_LOCAL_ENV) {
    const value = env[name];
    if (value !== undefined) saved[name] = value;
    delete env[name];
  }
  return saved;
}
