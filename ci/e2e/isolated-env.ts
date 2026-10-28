import { join } from "node:path";

/** The only variables a CLI under test inherits; credentials, config paths and session vars stay out. */
const PASSED = [
  "PATH",
  "LANG",
  "LC_ALL",
  "LC_CTYPE",
  "TERM",
  "TMPDIR",
  "TZ",
  "USER",
  "LOGNAME",
  "SHELL",
  "CI",
];

/** Env for a CLI run that can never see the developer's real config or credentials. */
export function isolatedEnv(
  tmp: string,
  base: NodeJS.ProcessEnv = process.env,
): Record<string, string> {
  const env: Record<string, string> = {};
  for (const k of PASSED) {
    const v = base[k];
    if (v !== undefined) env[k] = v;
  }
  env.HOME = join(tmp, "home");
  env.CLAUDE_CONFIG_DIR = join(tmp, "claude");
  env.CODEX_HOME = join(tmp, "codex");
  return env;
}
