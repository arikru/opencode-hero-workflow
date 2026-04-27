import type { HeroConfig } from "../config.ts";

export interface ShellEnvHookOptions {
  projectRoot: string;
  stack: HeroConfig["stack"];
}

/**
 * Build a shell.env hook factory. The returned function produces the env-var map
 * injected into shell calls; it is a pure function returning a fresh object on
 * each invocation so the OpenCode runtime can merge without mutating shared state.
 *
 * Note: when stack is "auto", we do NOT resolve the literal stack here. The bash
 * dispatcher (scripts/verify.sh) handles auto-detection — keeping this module
 * dumb avoids duplicating filesystem detection logic across TS and bash.
 */
export function createShellEnvHook(
  opts: ShellEnvHookOptions,
): () => Record<string, string> {
  const { projectRoot, stack } = opts;
  return () => ({
    HERO_PROJECT_ROOT: projectRoot,
    HERO_STACK: stack,
  });
}
