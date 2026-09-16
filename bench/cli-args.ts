export type Command = "run" | "tool" | "report";

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
}

const COMMANDS = new Set<string>(["run", "tool", "report"]);

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
  };
  const first = argv[0];
  if (first && COMMANDS.has(first)) a.command = first as Command;
  for (let i = a.command ? 1 : 0; i < argv.length; i++) {
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
      default:
        throw new Error(`unknown flag: ${flag}`);
    }
  }
  return a;
}
