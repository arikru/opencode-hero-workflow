import type { HeroConfig } from "../config.ts";
import type { AppLogApi, ToolExecuteAfterHook } from "../types.ts";
import {
  resolveVerifyScriptPath,
  toVerifyResult,
  type ScriptExistsFn,
} from "../verify/shared.ts";

export interface Disposable {
  dispose(): void;
}

export interface SpawnResult {
  exited: Promise<number>;
  stdoutText: Promise<string>;
  stderrText: Promise<string>;
}

export type SpawnFn = (
  cmd: string[],
  opts?: { env?: Record<string, string>; cwd?: string },
) => SpawnResult;

export interface VerifyHookOptions {
  config: HeroConfig["verify"];
  projectRoot: string;
  stack: HeroConfig["stack"];
  log: AppLogApi;
  spawn?: SpawnFn;
  scriptExists?: ScriptExistsFn;
  now?: () => number;
  schedule?: (fn: () => void, ms: number) => Disposable;
}

const TRIGGER_TOOLS = new Set(["edit", "write"]);

function defaultSchedule(fn: () => void, ms: number): Disposable {
  const id = setTimeout(fn, ms);
  return {
    dispose: () => clearTimeout(id),
  };
}

const defaultSpawn: SpawnFn = (cmd, opts) => {
  // Lazy import via globalThis so this module stays unit-testable in
  // non-Bun runtimes (the default is only used at runtime, never in tests).
  const bun = (globalThis as { Bun?: typeof Bun }).Bun;
  if (!bun) {
    throw new Error("verify hook: default spawn requires Bun runtime");
  }
  const proc = bun.spawn(cmd, {
    env: opts?.env,
    cwd: opts?.cwd,
    stdout: "pipe",
    stderr: "pipe",
  });
  const stdoutText = new Response(proc.stdout as ReadableStream).text();
  const stderrText = new Response(proc.stderr as ReadableStream).text();
  return { exited: proc.exited, stdoutText, stderrText };
};

export function createVerifyHook(opts: VerifyHookOptions): ToolExecuteAfterHook {
  const {
    config,
    projectRoot,
    stack,
    log,
    spawn = defaultSpawn,
    scriptExists,
    schedule = defaultSchedule,
  } = opts;

  let pendingTimer: Disposable | null = null;
  let inFlight = false;
  let triggerWhileInFlight = false;

  const env: Record<string, string> = {
    ...process.env as Record<string, string>,
    HERO_PROJECT_ROOT: projectRoot,
    HERO_STACK: stack,
  };

  const verifyScript = resolveVerifyScriptPath(projectRoot, scriptExists);

  const runVerify = () => {
    pendingTimer = null;
    inFlight = true;
    const result = spawn(["bash", verifyScript], { env, cwd: projectRoot });
    void Promise.all([result.exited, result.stdoutText, result.stderrText])
      .then(async ([exitCode, stdout, stderr]) => {
        const result = toVerifyResult(exitCode, stdout, stderr);
        await log.log({
          level: result.passed ? "info" : "error",
          message:
            result.passed
              ? "hero verify: passed"
              : `hero verify: failed (exit ${exitCode})`,
          detail: result.output,
        });
      })
      .catch(async (err) => {
        await log.log({
          level: "error",
          message: "hero verify: spawn error",
          detail: err instanceof Error ? err.message : String(err),
        });
      })
      .finally(() => {
        inFlight = false;
        if (triggerWhileInFlight) {
          triggerWhileInFlight = false;
          scheduleVerify();
        }
      });
  };

  const scheduleVerify = () => {
    if (pendingTimer) {
      pendingTimer.dispose();
    }
    pendingTimer = schedule(runVerify, config.debounceMs);
  };

  return (event) => {
    if (!config.enabled) return;
    if (!TRIGGER_TOOLS.has(event.tool)) return;
    if (inFlight) {
      triggerWhileInFlight = true;
      return;
    }
    scheduleVerify();
  };
}
