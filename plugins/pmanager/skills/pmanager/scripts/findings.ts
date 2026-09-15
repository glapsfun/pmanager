export interface Finding {
  file: string;
  line?: number;
  rule: string;
  severity: "error" | "warning";
  message: string;
  fix: string;
}

export function countBySeverity(findings: Finding[]): { errors: number; warnings: number } {
  let errors = 0;
  let warnings = 0;
  for (const f of findings) {
    if (f.severity === "error") errors++;
    else warnings++;
  }
  return { errors, warnings };
}

export function formatFindings(findings: Finding[]): string {
  if (findings.length === 0) return "OK: no findings\n";
  const lines = findings.map((f) => {
    const loc = f.line ? `${f.file}:${f.line}` : f.file;
    const tag = f.severity === "error" ? "ERROR" : "WARN ";
    return `${tag} ${f.rule} ${loc}\n      ${f.message}\n      fix: ${f.fix}`;
  });
  const { errors, warnings } = countBySeverity(findings);
  lines.push(`${errors} error(s), ${warnings} warning(s)`);
  return `${lines.join("\n")}\n`;
}
