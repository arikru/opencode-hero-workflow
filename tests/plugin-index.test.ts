import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import heroPlugin, {
  type PluginContext,
  type PluginRegistration,
} from "../plugin/index.ts";
import type { AppLogApi, ToastApi } from "../plugin/types.ts";

interface ToastCall {
  message: string;
  severity?: "info" | "warn" | "error";
}

interface LogCall {
  level: "info" | "warn" | "error";
  message: string;
  detail?: string;
}

function createSpies(): {
  toast: ToastApi;
  toastCalls: ToastCall[];
  log: AppLogApi;
  logCalls: LogCall[];
} {
  const toastCalls: ToastCall[] = [];
  const logCalls: LogCall[] = [];
  const toast: ToastApi = {
    show(opts) {
      toastCalls.push({ message: opts.message, severity: opts.severity });
    },
  };
  const log: AppLogApi = {
    log(opts) {
      logCalls.push({
        level: opts.level,
        message: opts.message,
        detail: opts.detail,
      });
    },
  };
  return { toast, toastCalls, log, logCalls };
}

function makeContext(opts: {
  projectRoot: string;
  packageVersion?: string;
}): { ctx: PluginContext; toastCalls: ToastCall[]; logCalls: LogCall[] } {
  const { toast, toastCalls, log, logCalls } = createSpies();
  const ctx: PluginContext = {
    projectRoot: opts.projectRoot,
    packageVersion: opts.packageVersion ?? "0.1.2",
    toast,
    log,
  };
  return { ctx, toastCalls, logCalls };
}

const MINIMAL_CONFIG = JSON.stringify({
  version: "0.1.2",
  models: {
    implementer: "github-copilot/claude-sonnet-4.5",
    reviewer: "github-copilot/claude-opus-4-7",
    planner: "github-copilot/claude-sonnet-4.5",
  },
});

function writeMinimalConfig(root: string): void {
  mkdirSync(join(root, ".hero"), { recursive: true });
  writeFileSync(join(root, ".hero", "config.jsonc"), MINIMAL_CONFIG, "utf8");
}

async function flushMicrotasks(): Promise<void> {
  await new Promise((r) => setImmediate(r));
}

describe("heroPlugin", () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), "hero-plugin-index-"));
  });

  afterEach(() => {
    rmSync(tempDir, { recursive: true, force: true });
  });

  test("happy path: returns full registration with all hooks, tools, and shellEnv", async () => {
    writeMinimalConfig(tempDir);
    const { ctx } = makeContext({ projectRoot: tempDir });

    const reg: PluginRegistration = await heroPlugin(ctx);

    // All 6 hook keys populated.
    expect(typeof reg.hooks["tool.execute.before"]).toBe("function");
    expect(typeof reg.hooks["tool.execute.after"]).toBe("function");
    expect(typeof reg.hooks["session.updated"]).toBe("function");
    expect(typeof reg.hooks["message.updated"]).toBe("function");
    expect(typeof reg.hooks["session.compacted"]).toBe("function");
    expect(typeof reg.hooks["experimental.session.compacting"]).toBe("function");

    // 3 custom tools with the expected names.
    expect(Array.isArray(reg.tools)).toBe(true);
    expect(reg.tools).toHaveLength(3);
    const toolNames = reg.tools.map((t) => t.name).sort();
    expect(toolNames).toEqual(
      ["mark-issue-done", "pick-next-issue", "verify"].sort(),
    );

    // shellEnv is a function returning HERO_PROJECT_ROOT and HERO_STACK.
    expect(typeof reg.shellEnv).toBe("function");
    const env = reg.shellEnv!();
    expect(env.HERO_PROJECT_ROOT).toBe(tempDir);
    expect(env.HERO_STACK).toBe("auto");
  });

  test("malformed config: toasts an error and returns an empty registration", async () => {
    mkdirSync(join(tempDir, ".hero"), { recursive: true });
    writeFileSync(
      join(tempDir, ".hero", "config.jsonc"),
      "{ this is not valid json",
      "utf8",
    );
    const { ctx, toastCalls } = makeContext({ projectRoot: tempDir });

    const reg = await heroPlugin(ctx);

    expect(toastCalls.length).toBeGreaterThanOrEqual(1);
    const errorToasts = toastCalls.filter((c) => c.severity === "error");
    expect(errorToasts).toHaveLength(1);
    expect(errorToasts[0].message).toMatch(/hero config/i);

    expect(reg.hooks).toEqual({});
    expect(reg.tools).toEqual([]);
  });

  test("missing config file: toasts an error and returns an empty registration", async () => {
    // No .hero/config.jsonc written at all.
    const { ctx, toastCalls } = makeContext({ projectRoot: tempDir });

    const reg = await heroPlugin(ctx);

    const errorToasts = toastCalls.filter((c) => c.severity === "error");
    expect(errorToasts).toHaveLength(1);
    expect(errorToasts[0].message).toMatch(/hero config/i);

    expect(reg.hooks).toEqual({});
    expect(reg.tools).toEqual([]);
  });

  test("version drift: toasts a warn-level message mentioning both versions", async () => {
    writeMinimalConfig(tempDir);
    writeFileSync(join(tempDir, ".hero", ".hero-version"), "0.0.9\n", "utf8");
    const { ctx, toastCalls } = makeContext({
      projectRoot: tempDir,
      packageVersion: "0.1.2",
    });

    await heroPlugin(ctx);
    // checkVersionDrift is fire-and-forget — wait for any pending microtasks.
    await flushMicrotasks();
    await flushMicrotasks();

    const driftToasts = toastCalls.filter(
      (c) =>
        c.severity === "warn" &&
        c.message.includes("0.0.9") &&
        c.message.includes("0.1.2"),
    );
    expect(driftToasts.length).toBeGreaterThanOrEqual(1);
  });
});
