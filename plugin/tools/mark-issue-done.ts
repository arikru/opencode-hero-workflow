import type { CustomTool } from "../types.ts";
import type { HeroConfig } from "../config.ts";

// Local GhRunner shape — kept as a structural contract so tests inject a fake
// without depending on Bun's spawn type. Defined locally (not imported from
// pick-next-issue) to keep this tool decoupled from sibling tools.
export type GhRunner = (
  args: string[],
) => Promise<{ stdout: string; stderr: string; exitCode: number }>;

export type MarkIssueDoneResult =
  | { closed: true; issueNumber: number }
  | { closed: false; reason: string };

export interface CreateMarkIssueDoneToolOptions {
  config: HeroConfig["github"];
  runGh?: GhRunner;
}

const DEFAULT_COMMENT = "Completed by Hero workflow";

// Default gh runner: spawns the gh CLI and collects stdout/stderr/exit code.
// Kept inline so the only consumer is this module; tests inject a fake instead.
const defaultRunGh: GhRunner = async (args) => {
  const proc = Bun.spawn(["gh", ...args], { stdout: "pipe", stderr: "pipe" });
  const [exitCode, stdout, stderr] = await Promise.all([
    proc.exited,
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
  ]);
  return { stdout, stderr, exitCode };
};

/**
 * Build the `mark-issue-done` custom tool. It runs `gh issue close <n> --comment <text>`
 * (and `--repo <repo>` if configured) and returns a structured result the AI can
 * interpret. Non-zero exit is reported via `closed: false`, never thrown.
 */
export function createMarkIssueDoneTool(
  opts: CreateMarkIssueDoneToolOptions,
): CustomTool<{ issueNumber: number; comment?: string }, MarkIssueDoneResult> {
  const runGh = opts.runGh ?? defaultRunGh;
  const repo = opts.config.repo;

  return {
    name: "mark-issue-done",
    description: "Close a Hero issue with a completion comment.",
    async execute(input) {
      const { issueNumber } = input;
      if (
        typeof issueNumber !== "number" ||
        !Number.isFinite(issueNumber) ||
        !Number.isInteger(issueNumber) ||
        issueNumber <= 0
      ) {
        return {
          closed: false,
          reason: "issueNumber must be a positive integer",
        };
      }

      const comment = input.comment ?? DEFAULT_COMMENT;
      const args = ["issue", "close", String(issueNumber), "--comment", comment];
      if (repo !== null) args.push("--repo", repo);

      const { stderr, exitCode } = await runGh(args);
      if (exitCode === 0) return { closed: true, issueNumber };
      return { closed: false, reason: stderr.trim() };
    },
  };
}
