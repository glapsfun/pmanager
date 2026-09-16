export type Command = "run" | "tool" | "report" | "experiment";
export type ExperimentSub = "new" | "run" | "report";
export type ConditionArg = "with-skill" | "without-skill" | "both";

export interface ParsedArgs {
  command: Command | undefined;
  harness: string | undefined;
  model: string | undefined;
  scenarios: string[];
  runs: number;
  timeoutS: number;
  keep: boolean;
  epics: number;
  tasks: number;
  iterations: number;
  historyPath: string | undefined;
  reportPath: string | undefined;
  rawDir: string | undefined;
  sub: ExperimentSub | undefined;
  id: string | undefined;
  condition: ConditionArg;
  pairs: number;
  reasoning: string | undefined;
  yes: boolean;
  experimentsDir: string | undefined;
}

const COMMANDS = new Set<string>(["run", "tool", "report", "experiment"]);
const SUBS = new Set<string>(["new", "run", "report"]);

function int(name: string, v: string | undefined): number {
  const n = Number.parseInt(v ?? "", 10);
  if (Number.isNaN(n) || n < 1) throw new Error(`${name} needs a positive integer`);
  return n;
}

export function parseArgs(argv: string[]): ParsedArgs {
  const a: ParsedArgs = {
    command: undefined,
    harness: undefined,
    model: undefined,
    scenarios: [],
    runs: 1,
    timeoutS: 900,
    keep: false,
    epics: 50,
    tasks: 20,
    iterations: 5,
    historyPath: undefined,
    reportPath: undefined,
    rawDir: undefined,
    sub: undefined,
    id: undefined,
    condition: "with-skill",
    pairs: 1,
    reasoning: undefined,
    yes: false,
    experimentsDir: undefined,
  };
  const first = argv[0];
  if (first && COMMANDS.has(first)) a.command = first as Command;
  let start = a.command ? 1 : 0;
  if (a.command === "experiment") {
    const sub = argv[1];
    if (!sub || !SUBS.has(sub))
      throw new Error("experiment needs a subcommand: new | run | report");
    a.sub = sub as ExperimentSub;
    start = 2;
  }
  for (let i = start; i < argv.length; i++) {
    const flag = argv[i] ?? "";
    const next = () => argv[++i];
    switch (flag) {
      case "--harness":
        a.harness = next();
        break;
      case "--model":
        a.model = next();
        break;
      case "--scenario": {
        const s = next();
        if (s) a.scenarios.push(s);
        break;
      }
      case "--runs":
        a.runs = int(flag, next());
        break;
      case "--timeout-s":
        a.timeoutS = int(flag, next());
        break;
      case "--keep":
        a.keep = true;
        break;
      case "--epics":
        a.epics = int(flag, next());
        break;
      case "--tasks":
        a.tasks = int(flag, next());
        break;
      case "--iterations":
        a.iterations = int(flag, next());
        break;
      case "--history":
        a.historyPath = next();
        break;
      case "--report":
        a.reportPath = next();
        break;
      case "--raw-dir":
        a.rawDir = next();
        break;
      case "--id":
        a.id = next();
        break;
      case "--condition": {
        const c = next();
        if (c !== "with-skill" && c !== "without-skill" && c !== "both") {
          throw new Error("--condition must be with-skill, without-skill or both");
        }
        a.condition = c;
        break;
      }
      case "--pairs":
        a.pairs = int(flag, next());
        break;
      case "--reasoning":
        a.reasoning = next();
        break;
      case "--yes":
        a.yes = true;
        break;
      case "--experiments-dir":
        a.experimentsDir = next();
        break;
      default:
        throw new Error(`unknown flag: ${flag}`);
    }
  }
  return a;
}
