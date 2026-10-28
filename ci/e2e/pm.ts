import { readFile } from "node:fs/promises";
import { join } from "node:path";

const TOOL = join(import.meta.dir, "..", "..", "plugins", "pmanager", "skills", "pmanager");
const PM = join(TOOL, "scripts", "pm.ts");
const WEBSHOP_EPIC = join(TOOL, "tests", "fixtures", "webshop", "docs", "pm", "app-performance");

const FIXTURE_SESSION =
  "session:\n  harness: claude-code\n  claimed: 2026-09-10\n  branch: pm/app-performance\n";

/** Runs pm as a real subprocess, the way an agent does, and captures its output. */
export async function pmProcess(
  cwd: string,
  args: string[],
  opts: { harness?: string; stdin?: string; env?: Record<string, string> } = {},
): Promise<{ code: number; stdout: string; stderr: string }> {
  const proc = Bun.spawn(["bun", "run", PM, ...args], {
    cwd,
    stdin: opts.stdin === undefined ? "ignore" : new Blob([opts.stdin]),
    stdout: "pipe",
    stderr: "pipe",
    env: {
      ...process.env,
      PM_TODAY: "2026-09-28",
      PM_GH: "/nonexistent",
      ...opts.env,
      PM_HARNESS: opts.harness ?? "e2e",
    },
  });
  const [stdout, stderr, code] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
    proc.exited,
  ]);
  return { code, stdout, stderr };
}

/** Bundle for `pm record`: the webshop app-performance files under another slug, carrying the caller's own session block. */
export async function epicBundle(
  slug: string,
  files: string[],
  session: { harness: string; id: string },
): Promise<string> {
  const claimed = `session:\n  harness: ${session.harness}\n  claimed: 2026-09-28\n  branch: pm/${slug}\n  id: ${session.id}\n`;
  const parts: string[] = [];
  for (const file of files) {
    const text = (await readFile(join(WEBSHOP_EPIC, file), "utf8")).replace(
      FIXTURE_SESSION,
      claimed,
    );
    parts.push(`<!-- pm:file ${slug}/${file} -->\n${text.replaceAll("app-performance", slug)}`);
  }
  return `${parts.join("\n")}\n`;
}
