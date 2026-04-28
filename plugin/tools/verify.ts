import type { HeroConfig } from "../config.ts";
import type { CustomTool } from "../types.ts";
import {
  resolveVerifyScriptPath,
  toVerifyResult,
  type ScriptExistsFn,
  type VerifyResult,
} from "../verify/shared.ts";

// Local SpawnFn shape — kept as a structural contract so tests inject a fake
// without depending on Bun's spawn type. The default in createVerifyTool maps
// Bun.spawn onto this shape.
export type SpawnFn = (
  cmd: string[],
  opts: { env: Record<string, string> },
) => {
  exited: Promise<number>;
  stdout: ReadableStream<Uint8Array>;
  stderr: ReadableStream<Uint8Array>;
};

export interface CreateVerifyToolOptions {
  projectRoot: string;
  stack: HeroConfig["stack"];
  spawn?: SpawnFn;
  scriptExists?: ScriptExistsFn;
}

export type VerifyToolResult = VerifyResult;

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

// Default spawn: thin adapter from Bun.spawn onto our local SpawnFn shape.
// Kept inline to avoid a separate file when the only consumer is this module.
const defaultSpawn: SpawnFn = (cmd, opts) => {
  const proc = Bun.spawn(cmd, {
    env: opts.env,
    stdout: "pipe",
    stderr: "pipe",
  });
  return {
    exited: proc.exited,
    stdout: proc.stdout as ReadableStream<Uint8Array>,
    stderr: proc.stderr as ReadableStream<Uint8Array>,
  };
};

/**
 * Build the `verify` custom tool. It spawns scripts/verify.sh under the
 * project root, awaits completion, and returns a structured result the AI
 * can interpret. Non-zero exit is reported via `passed: false`, never thrown.
 */
export function createVerifyTool(
  opts: CreateVerifyToolOptions,
): CustomTool<Record<string, never>, VerifyToolResult> {
  const spawn = opts.spawn ?? defaultSpawn;
  const scriptPath = resolveVerifyScriptPath(opts.projectRoot, opts.scriptExists);

  return {
    name: "verify",
    description:
      "Run the project's verify suite (lint, typecheck, tests) and return structured pass/fail output.",
    async execute(_input: Record<string, never>): Promise<VerifyToolResult> {
      const proc = spawn(["bash", scriptPath], {
        env: {
          HERO_PROJECT_ROOT: opts.projectRoot,
          HERO_STACK: opts.stack,
        },
      });
      const [exitCode, stdoutText, stderrText] = await Promise.all([
        proc.exited,
        readAll(proc.stdout),
        readAll(proc.stderr),
      ]);
      return toVerifyResult(exitCode, stdoutText, stderrText);
    },
  };
}
