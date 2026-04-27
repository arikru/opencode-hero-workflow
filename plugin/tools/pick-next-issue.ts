import type { HeroConfig } from "../config.ts";
import type { CustomTool } from "../types.ts";

// GhRunner is the structural shape we depend on for invoking `gh`. Tests pass
// a fake; production wires this to a Bun.spawn-based default. Keeping it
// injectable means the tool unit-tests don't need a real `gh` binary.
export type GhRunner = (
  args: string[],
) => Promise<{ stdout: string; stderr: string; exitCode: number }>;

export type PickNextIssueResult =
  | { found: true; number: number; title: string; body: string; url: string }
  | { found: false; reason: string };

export interface CreatePickNextIssueToolOptions {
  config: HeroConfig["github"];
  runGh?: GhRunner;
}

interface RawIssue {
  number: number;
  title: string;
  body: string;
  url: string;
  labels: Array<{ name: string }>;
}

async function readAll(stream: ReadableStream<Uint8Array>): Promise<string> {
  const reader = stream.getReader();
  const decoder = new TextDecoder();
  let out = "";
  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    if (value) out += decoder.decode(value, { stream: true });
  }
  out += decoder.decode();
  return out;
}

// Default GhRunner: thin Bun.spawn adapter. Kept inline so the module stays
// single-file, mirroring the convention in plugin/tools/verify.ts.
const defaultRunGh: GhRunner = async (args) => {
  const proc = Bun.spawn(["gh", ...args], {
    stdout: "pipe",
    stderr: "pipe",
  });
  const [exitCode, stdout, stderr] = await Promise.all([
    proc.exited,
    readAll(proc.stdout as ReadableStream<Uint8Array>),
    readAll(proc.stderr as ReadableStream<Uint8Array>),
  ]);
  return { stdout, stderr, exitCode };
};

/**
 * Build the `pick-next-issue` custom tool. It runs `gh issue list` filtered
 * to the configured "ready" label, drops anything also carrying the "blocked"
 * label, sorts ascending by issue number (vertical-slice priority), and
 * returns the first match — or a structured `found:false` reason. Failures
 * from `gh` come back as data, never as thrown errors.
 */
export function createPickNextIssueTool(
  opts: CreatePickNextIssueToolOptions,
): CustomTool<Record<string, never>, PickNextIssueResult> {
  const runGh = opts.runGh ?? defaultRunGh;
  const { config } = opts;

  return {
    name: "pick-next-issue",
    description:
      "Select the highest-priority unblocked Hero issue from the GitHub board.",
    async execute(_input: Record<string, never>): Promise<PickNextIssueResult> {
      const args = [
        "issue",
        "list",
        "--label",
        config.labels.ready,
        "--state",
        "open",
        "--json",
        "number,title,body,url,labels",
        "--limit",
        "100",
      ];
      if (config.repo !== null) {
        args.push("--repo", config.repo);
      }

      const { stdout, stderr, exitCode } = await runGh(args);
      if (exitCode !== 0) {
        return { found: false, reason: stderr.trim() };
      }

      let parsed: RawIssue[];
      try {
        parsed = JSON.parse(stdout) as RawIssue[];
      } catch (err) {
        const reason = err instanceof Error ? err.message : String(err);
        return { found: false, reason: `failed to parse gh output: ${reason}` };
      }

      const blockedLabel = config.labels.blocked;
      const candidates = parsed
        .filter((i) => !i.labels.some((l) => l.name === blockedLabel))
        .sort((a, b) => a.number - b.number);

      const top = candidates[0];
      if (!top) {
        return { found: false, reason: "No unblocked hero:ready issues found." };
      }
      return {
        found: true,
        number: top.number,
        title: top.title,
        body: top.body,
        url: top.url,
      };
    },
  };
}
