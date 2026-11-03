import { expect } from "bun:test";
import type { Run } from "../scripts/git";

export type Reply = { code?: number; stdout?: string; stderr?: string };

/** A Run that expects exactly these commands, in order, and answers each with its reply. */
export function scripted(steps: [string[], Reply][]): Run & { left: () => number } {
  const queue = [...steps];
  const run: Run = async (cmd) => {
    const step = queue.shift();
    if (!step) throw new Error(`unexpected command: ${cmd.join(" ")}`);
    expect(cmd).toEqual(step[0]);
    return { code: step[1].code ?? 0, stdout: step[1].stdout ?? "", stderr: step[1].stderr ?? "" };
  };
  return Object.assign(run, { left: () => queue.length });
}
