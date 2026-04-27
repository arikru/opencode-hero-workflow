import { describe, expect, test } from "bun:test";

import { createVerifyHook } from "../../plugin/hooks/verify.ts";
import type { HeroConfig } from "../../plugin/config.ts";
import type { AppLogApi, ToolExecuteAfterEvent } from "../../plugin/types.ts";

type LogCall = {
  level: "info" | "warn" | "error";
  message: string;
  detail?: string;
};

interface PendingTimer {
  fn: () => void;
  dueAt: number;
  cancelled: boolean;
}

function createFakeSchedule() {
  let now = 0;
  const timers: PendingTimer[] = [];
  return {
    schedule: (fn: () => void, ms: number) => {
      const t: PendingTimer = { fn, dueAt: now + ms, cancelled: false };
      timers.push(t);
      return { dispose: () => (t.cancelled = true) };
    },
    tick: (ms: number) => {
      now += ms;
      // Loop because a fired callback may schedule another due timer; sort
      // by dueAt so chronological order is preserved.
      while (true) {
        const due = timers
          .filter((t) => !t.cancelled && t.dueAt <= now)
          .sort((a, b) => a.dueAt - b.dueAt)[0];
        if (!due) break;
        due.cancelled = true;
        due.fn();
      }
    },
    now: () => now,
  };
}

function createFakeSpawn() {
  const calls: { cmd: string[]; env?: Record<string, string> }[] = [];
  const handles: {
    resolve(opts: { exitCode: number; stdout?: string; stderr?: string }): void;
  }[] = [];
  return {
    calls,
    handles,
    spawn: (cmd: string[], opts?: { env?: Record<string, string> }) => {
      calls.push({ cmd, env: opts?.env });
      let resolveExit!: (n: number) => void;
      let resolveOut!: (s: string) => void;
      let resolveErr!: (s: string) => void;
      const exited = new Promise<number>((r) => (resolveExit = r));
      const stdoutText = new Promise<string>((r) => (resolveOut = r));
      const stderrText = new Promise<string>((r) => (resolveErr = r));
      handles.push({
        resolve: ({ exitCode, stdout = "", stderr = "" }) => {
          resolveOut(stdout);
          resolveErr(stderr);
          resolveExit(exitCode);
        },
      });
      return { exited, stdoutText, stderrText };
    },
  };
}

const baseCfg: HeroConfig["verify"] = {
  enabled: true,
  debounceMs: 5000,
  commands: [],
};

const editEvent: ToolExecuteAfterEvent = {
  tool: "edit",
  input: { path: "src/foo.ts" },
  output: { success: true },
};
const writeEvent: ToolExecuteAfterEvent = { ...editEvent, tool: "write" };
const readEvent: ToolExecuteAfterEvent = { ...editEvent, tool: "read" };

function build(cfg: HeroConfig["verify"] = baseCfg) {
  const sched = createFakeSchedule();
  const sp = createFakeSpawn();
  const calls: LogCall[] = [];
  const log: AppLogApi = { log: (o) => void calls.push(o) };
  const hook = createVerifyHook({
    config: cfg,
    projectRoot: "/p",
    stack: "python",
    log,
    spawn: sp.spawn,
    schedule: sched.schedule,
    now: sched.now,
  });
  return { sched, sp, log, calls, hook };
}

// Microtask drain: spawn completion runs through Promise chains, so tests
// must yield after resolving a fake handle to let then/finally handlers run.
async function flush() {
  for (let i = 0; i < 5; i++) await Promise.resolve();
}

describe("createVerifyHook", () => {
  test("single edit: spawn called exactly once after debounceMs", async () => {
    const { sched, sp, hook } = build();
    await hook(editEvent);
    expect(sp.calls.length).toBe(0);
    sched.tick(4999);
    expect(sp.calls.length).toBe(0);
    sched.tick(1);
    expect(sp.calls.length).toBe(1);
  });

  test("two rapid edits within debounceMs coalesce into one spawn", async () => {
    const { sched, sp, hook } = build();
    await hook(editEvent);
    sched.tick(2000);
    await hook(writeEvent);
    sched.tick(4999);
    expect(sp.calls.length).toBe(0);
    sched.tick(1);
    expect(sp.calls.length).toBe(1);
  });

  test("edit while in-flight defers; new debounce starts on completion", async () => {
    const { sched, sp, hook } = build();
    await hook(editEvent);
    sched.tick(5000);
    expect(sp.calls.length).toBe(1);

    await hook(editEvent);
    sched.tick(10000);
    expect(sp.calls.length).toBe(1);

    sp.handles[0].resolve({ exitCode: 0, stdout: "ok" });
    await flush();

    sched.tick(4999);
    expect(sp.calls.length).toBe(1);
    sched.tick(1);
    expect(sp.calls.length).toBe(2);
  });

  test("enabled=false: spawn never called even on edit", async () => {
    const { sched, sp, hook } = build({ ...baseCfg, enabled: false });
    await hook(editEvent);
    sched.tick(60000);
    expect(sp.calls.length).toBe(0);
  });

  test("tool name 'read' is ignored", async () => {
    const { sched, sp, hook } = build();
    await hook(readEvent);
    sched.tick(60000);
    expect(sp.calls.length).toBe(0);
  });

  test("spawn exit 0: log.log called with level info", async () => {
    const { sched, sp, calls, hook } = build();
    await hook(editEvent);
    sched.tick(5000);
    sp.handles[0].resolve({ exitCode: 0, stdout: "all good" });
    await flush();

    expect(calls.length).toBe(1);
    expect(calls[0].level).toBe("info");
    expect(calls[0].detail ?? "").toContain("all good");
  });

  test("spawn exit non-zero: error level and stderr in detail", async () => {
    const { sched, sp, calls, hook } = build();
    await hook(editEvent);
    sched.tick(5000);
    sp.handles[0].resolve({
      exitCode: 1,
      stdout: "ran",
      stderr: "boom: type error",
    });
    await flush();

    expect(calls.length).toBe(1);
    expect(calls[0].level).toBe("error");
    expect(calls[0].detail ?? "").toContain("boom: type error");
  });

  test("hook returns immediately (does not block on spawn completion)", async () => {
    const { sched, sp, hook } = build();
    await hook(editEvent);
    sched.tick(5000);
    // Spawn fired but unresolved; if the hook awaited, this test would hang.
    expect(sp.calls.length).toBe(1);
  });
});
