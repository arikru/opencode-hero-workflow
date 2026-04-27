import { join } from "node:path";
import { z } from "zod";

export const HeroConfigSchema = z.object({
  version: z.string(),
  models: z.object({
    implementer: z.string(),
    reviewer: z.string(),
    planner: z.string(),
  }),
  stack: z.enum(["python", "node", "auto"]).default("auto"),
  verify: z
    .object({
      enabled: z.boolean().default(true),
      debounceMs: z.number().default(5000),
      commands: z.array(z.string()).default([]),
    })
    .default({}),
  tokenBudget: z
    .object({
      warnAt: z.number().default(80000),
      alarmAt: z.number().default(100000),
    })
    .default({}),
  guardrails: z
    .object({
      blockEnvReads: z.boolean().default(true),
      blockForcePush: z.boolean().default(true),
    })
    .default({}),
  github: z
    .object({
      repo: z.string().nullable().default(null),
      labels: z
        .object({
          ready: z.string().default("hero:ready"),
          inProgress: z.string().default("hero:in-progress"),
          blocked: z.string().default("hero:blocked"),
        })
        .default({}),
    })
    .default({}),
  sandcastle: z
    .object({
      enabled: z.boolean().default(false),
      sandboxProvider: z.string().default("sandcastle"),
      imageName: z.string().default("ubuntu:24.04"),
      mountOpencodeAuth: z.boolean().default(true),
      maxIterations: z.number().default(50),
      idleTimeoutSeconds: z.number().default(600),
    })
    .default({}),
});

export type HeroConfig = z.infer<typeof HeroConfigSchema>;

export class HeroConfigError extends Error {
  readonly issues: readonly z.ZodIssue[];
  constructor(message: string, issues: readonly z.ZodIssue[] = []) {
    super(message);
    this.name = "HeroConfigError";
    this.issues = issues;
  }
}

function formatIssue(issue: z.ZodIssue): string {
  const path = issue.path.length === 0 ? "<root>" : issue.path.join(".");
  if (issue.code === "invalid_type" && issue.received === "undefined") {
    return `${path} is required`;
  }
  return `${path}: ${issue.message}`;
}

export async function loadHeroConfig(projectRoot: string): Promise<HeroConfig> {
  const path = join(projectRoot, ".hero", "config.jsonc");
  let text: string;
  try {
    text = await Bun.file(path).text();
  } catch (err) {
    const reason = err instanceof Error ? err.message : String(err);
    throw new HeroConfigError(`hero config: cannot read ${path}: ${reason}`);
  }

  let raw: unknown;
  try {
    raw = Bun.JSONC.parse(text);
  } catch (err) {
    const reason = err instanceof Error ? err.message : String(err);
    throw new HeroConfigError(`hero config: invalid JSONC at ${path}: ${reason}`);
  }

  const parsed = HeroConfigSchema.safeParse(raw);
  if (!parsed.success) {
    // Zod issues collected, not first-throw, because users want to fix all problems in one pass.
    const lines = parsed.error.issues.map(formatIssue);
    const message =
      lines.length === 1
        ? `hero config: ${lines[0]}`
        : `hero config: ${lines.length} issues:\n${lines.map((l) => `  - ${l}`).join("\n")}`;
    throw new HeroConfigError(message, parsed.error.issues);
  }

  return parsed.data;
}
