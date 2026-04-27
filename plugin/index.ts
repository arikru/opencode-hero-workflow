import { join } from "node:path";

import { HeroConfigError, loadHeroConfig } from "./config.ts";
import { createCompactionHook } from "./hooks/compaction.ts";
import { createGuardrailsHook } from "./hooks/guardrails.ts";
import { createShellEnvHook } from "./hooks/shell-env.ts";
import { createTokenBudgetHook } from "./hooks/token-budget.ts";
import { createVerifyHook } from "./hooks/verify.ts";
import { createMarkIssueDoneTool } from "./tools/mark-issue-done.ts";
import { createPickNextIssueTool } from "./tools/pick-next-issue.ts";
import { createVerifyTool } from "./tools/verify.ts";
import type {
  AppLogApi,
  CustomTool,
  MessageUpdatedHook,
  SessionCompactedHook,
  SessionCompactingHook,
  SessionUpdatedHook,
  ToastApi,
  ToolExecuteAfterHook,
  ToolExecuteBeforeHook,
} from "./types.ts";
import { checkVersionDrift } from "./version-check.ts";

export interface PluginContext {
  projectRoot: string;
  toast: ToastApi;
  log: AppLogApi;
  packageVersion: string;
}

export interface PluginRegistration {
  hooks: {
    "tool.execute.before"?: ToolExecuteBeforeHook;
    "tool.execute.after"?: ToolExecuteAfterHook;
    "session.updated"?: SessionUpdatedHook;
    "message.updated"?: MessageUpdatedHook;
    "session.compacted"?: SessionCompactedHook;
    "experimental.session.compacting"?: SessionCompactingHook;
  };
  tools: CustomTool[];
  shellEnv?: () => Record<string, string>;
}

const EMPTY_REGISTRATION: PluginRegistration = { hooks: {}, tools: [] };

/**
 * OpenCode plugin entry point. Loads `.hero/config.jsonc`, builds every hook
 * and tool factory with its config slice, and returns a single registration
 * object the runtime adapter can wire into its event bus.
 *
 * Failure modes:
 * - `HeroConfigError` (missing/malformed config): error toast + empty registration.
 *   The plugin must never crash OpenCode; an unrecoverable config issue degrades
 *   to a no-op and surfaces a single user-visible message.
 * - Version drift: surfaced via `checkVersionDrift` as a warn toast (fire-and-forget).
 */
export default async function heroPlugin(
  ctx: PluginContext,
): Promise<PluginRegistration> {
  let cfg;
  try {
    cfg = await loadHeroConfig(ctx.projectRoot);
  } catch (err) {
    if (err instanceof HeroConfigError) {
      await ctx.toast.show({ severity: "error", message: err.message });
      return EMPTY_REGISTRATION;
    }
    throw err;
  }

  // Fire-and-forget: never await; never let a version-check failure block init.
  void checkVersionDrift({
    packageVersion: ctx.packageVersion,
    scaffoldedVersionPath: join(ctx.projectRoot, ".hero", ".hero-version"),
    toast: ctx.toast,
  });

  const guardrails = createGuardrailsHook(cfg.guardrails);
  const verify = createVerifyHook({
    config: cfg.verify,
    projectRoot: ctx.projectRoot,
    stack: cfg.stack,
    log: ctx.log,
  });
  const tokenBudget = createTokenBudgetHook({
    config: cfg.tokenBudget,
    toast: ctx.toast,
  });
  const compaction = createCompactionHook({
    toast: ctx.toast,
    projectRoot: ctx.projectRoot,
  });

  const tools: CustomTool[] = [
    createVerifyTool({ projectRoot: ctx.projectRoot, stack: cfg.stack }),
    createPickNextIssueTool({ config: cfg.github }),
    createMarkIssueDoneTool({ config: cfg.github }),
  ];

  const shellEnv = createShellEnvHook({
    projectRoot: ctx.projectRoot,
    stack: cfg.stack,
  });

  return {
    hooks: {
      "tool.execute.before": guardrails,
      "tool.execute.after": verify,
      "session.updated": tokenBudget.onSessionUpdated,
      "message.updated": tokenBudget.onMessageUpdated,
      "session.compacted": compaction.onCompacted,
      "experimental.session.compacting": compaction.onCompacting,
    },
    tools,
    shellEnv,
  };
}
