import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { getString, parseDoc } from "./contract";
import type { LogEntry } from "./repo";

export type LogKind = "spec" | "update" | "claim" | "release" | "takeover";

export interface NewLogEntry {
  date: string;
  epic: string;
  harness: string;
  kind: LogKind;
  message: string;
}

export function randomLogId(): string {
  const bytes = new Uint8Array(3);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
}

export function logFileName(entry: NewLogEntry, id: string): string {
  return `${entry.date}-${entry.epic}-${id}.md`;
}

export function formatLogEntry(entry: NewLogEntry): string {
  return `---\ndate: ${entry.date}\nepic: ${entry.epic}\nharness: ${entry.harness}\nkind: ${entry.kind}\n---\n${entry.message}\n`;
}

export function parseLogEntry(path: string, raw: string): LogEntry {
  const doc = parseDoc(path, raw);
  const fm = doc.frontmatter;
  return {
    path,
    date: getString(fm, "date") ?? "",
    epic: getString(fm, "epic") ?? "",
    harness: getString(fm, "harness") ?? "",
    kind: getString(fm, "kind") ?? "",
    message: doc.body.trim(),
  };
}

export async function writeLogEntry(
  pmDir: string,
  entry: NewLogEntry,
  id = randomLogId(),
): Promise<string> {
  const dir = join(pmDir, "log");
  await mkdir(dir, { recursive: true });
  const path = join(dir, logFileName(entry, id));
  await writeFile(path, formatLogEntry(entry));
  return path;
}
