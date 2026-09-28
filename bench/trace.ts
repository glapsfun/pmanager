import { isExploration, isFramingWrite, isResearchCall, type ToolCall } from "./boundary";

export type TraceEvent =
  | { kind: "call"; context: number }
  | ({ kind: "tool" } & ToolCall)
  | { kind: "result"; bytes: number };

export interface TraceMetrics {
  /** context tokens of the call that issued the first docs/pm write, minus the first call's */
  preFramingContext: number | null;
  /** characters of tool output received before that write */
  preFramingToolBytes: number | null;
  /** tool calls on the fixture before the first pm research */
  preResearchCommands: number | null;
}

type ToolEvent = Extract<TraceEvent, { kind: "tool" }>;

const isTool = (e: TraceEvent): e is ToolEvent => e.kind === "tool";

export function traceMetrics(events: TraceEvent[]): TraceMetrics {
  const boundary = events.findIndex((e) => isTool(e) && isFramingWrite(e));
  const research = events.findIndex((e) => isTool(e) && isResearchCall(e));
  const before = boundary < 0 ? [] : events.slice(0, boundary);
  const contexts = before.flatMap((e) => (e.kind === "call" ? [e.context] : []));
  const first = contexts[0];
  const last = contexts[contexts.length - 1];
  return {
    preFramingContext: first !== undefined && last !== undefined ? last - first : null,
    preFramingToolBytes:
      boundary < 0 ? null : before.reduce((n, e) => n + (e.kind === "result" ? e.bytes : 0), 0),
    preResearchCommands:
      research < 0
        ? null
        : events.slice(0, research).filter((e) => isTool(e) && isExploration(e)).length,
  };
}
