import { join } from "node:path";

/** Env for a CLI run that can never see the developer's real config or credentials. */
export function isolatedEnv(
  tmp: string,
  base: NodeJS.ProcessEnv = process.env,
): Record<string, string> {
  const env: Record<string, string> = {};
  for (const [k, v] of Object.entries(base)) if (v !== undefined) env[k] = v;
  delete env.ANTHROPIC_API_KEY;
  delete env.OPENAI_API_KEY;
  env.HOME = join(tmp, "home");
  env.CLAUDE_CONFIG_DIR = join(tmp, "claude");
  env.CODEX_HOME = join(tmp, "codex");
  return env;
}
