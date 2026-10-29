export type CheckName =
  | "lint"
  | "lint-staged"
  | "typecheck"
  | "test"
  | "manifest"
  | "audit"
  | "e2e"
  | "commit-msg"
  | "commits";

export type StageName = "pre-commit" | "pre-push";

export const STAGES: Record<StageName, CheckName[]> = {
  "pre-commit": ["lint-staged", "typecheck"],
  "pre-push": ["lint", "typecheck", "manifest", "audit", "test", "e2e"],
};
