import { describe, expect, test } from "bun:test";
import { fileURLToPath } from "node:url";

import { createVerifyTool } from "../../plugin/tools/verify.ts";

const PACKAGE_VERIFY_SCRIPT = fileURLToPath(
  new URL("../../scripts/verify.sh", import.meta.url),
);

// Build a fake spawn we can drive: it captures the args it was called with and
// returns a controllable result so each test can decide stdout/stderr/exit.
function makeFakeSpawn(opts: {
  exitCode: number;
  stdout?: string;
  stderr?: string;
}) {
  const calls: Array<{
    cmd: string[];
    env: Record<string, string>;
  }> = [];

  function streamOf(text: string): ReadableStream<Uint8Array> {
    const bytes = new TextEncoder().encode(text);
    return new ReadableStream<Uint8Array>({
      start(controller) {
        if (bytes.length > 0) controller.enqueue(bytes);
        controller.close();
      },
    });
  }

  const spawn = (
    cmd: string[],
    spawnOpts: { env: Record<string, string> },
  ) => {
    calls.push({ cmd, env: spawnOpts.env });
    return {
      exited: Promise.resolve(opts.exitCode),
      stdout: streamOf(opts.stdout ?? ""),
      stderr: streamOf(opts.stderr ?? ""),
    };
  };

  return { spawn, calls };
}

describe("createVerifyTool", () => {
  test("tool name is exactly 'verify'", () => {
    const { spawn } = makeFakeSpawn({ exitCode: 0 });
    const tool = createVerifyTool({
      projectRoot: "/tmp/proj",
      stack: "python",
      spawn,
    });
    expect(tool.name).toBe("verify");
  });

  test("description is non-empty", () => {
    const { spawn } = makeFakeSpawn({ exitCode: 0 });
    const tool = createVerifyTool({
      projectRoot: "/tmp/proj",
      stack: "python",
      spawn,
    });
    expect(typeof tool.description).toBe("string");
    expect(tool.description.length).toBeGreaterThan(0);
  });

  test("execute({}) returns passed=true and stdout when spawn exits 0", async () => {
    const { spawn } = makeFakeSpawn({
      exitCode: 0,
      stdout: "all checks ok\n",
      stderr: "",
    });
    const tool = createVerifyTool({
      projectRoot: "/tmp/proj",
      stack: "python",
      spawn,
    });
    const result = await tool.execute({});
    expect(result.passed).toBe(true);
    expect(result.output).toBe("all checks ok\n");
  });

  test("execute({}) returns passed=false and combined stdout+stderr when spawn exits non-zero", async () => {
    const { spawn } = makeFakeSpawn({
      exitCode: 1,
      stdout: "ruff: 0 issues\n",
      stderr: "pytest: 1 failure\n",
    });
    const tool = createVerifyTool({
      projectRoot: "/tmp/proj",
      stack: "python",
      spawn,
    });
    const result = await tool.execute({});
    expect(result.passed).toBe(false);
    expect(result.output).toContain("pytest: 1 failure");
    expect(result.output).toContain("ruff: 0 issues");
  });

  test("execute({}) does not throw on non-zero exit", async () => {
    const { spawn } = makeFakeSpawn({
      exitCode: 2,
      stdout: "",
      stderr: "boom\n",
    });
    const tool = createVerifyTool({
      projectRoot: "/tmp/proj",
      stack: "python",
      spawn,
    });
    // Should resolve, not reject.
    const result = await tool.execute({});
    expect(result.passed).toBe(false);
  });

  test("spawns scripts/verify.sh under the configured projectRoot", async () => {
    const { spawn, calls } = makeFakeSpawn({ exitCode: 0 });
    const tool = createVerifyTool({
      projectRoot: "/tmp/proj",
      stack: "python",
      spawn,
    });
    await tool.execute({});
    expect(calls.length).toBe(1);
    // The cmd argument should include the verify.sh path.
    const joined = calls[0]!.cmd.join(" ");
    expect(joined).toContain("scripts/verify.sh");
  });

  test("uses project scripts/verify.sh when it exists", async () => {
    const { spawn, calls } = makeFakeSpawn({ exitCode: 0 });
    const tool = createVerifyTool({
      projectRoot: "/tmp/proj",
      stack: "python",
      spawn,
      scriptExists: () => true,
    });
    await tool.execute({});
    expect(calls[0]!.cmd[1]).toBe("/tmp/proj/scripts/verify.sh");
  });

  test("falls back to package scripts/verify.sh when project script is missing", async () => {
    const { spawn, calls } = makeFakeSpawn({ exitCode: 0 });
    const tool = createVerifyTool({
      projectRoot: "/tmp/proj",
      stack: "python",
      spawn,
      scriptExists: () => false,
    });
    await tool.execute({});
    expect(calls[0]!.cmd[1]).toBe(PACKAGE_VERIFY_SCRIPT);
  });

  test("env passed to spawn includes HERO_PROJECT_ROOT and HERO_STACK", async () => {
    const { spawn, calls } = makeFakeSpawn({ exitCode: 0 });
    const tool = createVerifyTool({
      projectRoot: "/tmp/proj",
      stack: "python",
      spawn,
    });
    await tool.execute({});
    expect(calls[0]!.env.HERO_PROJECT_ROOT).toBe("/tmp/proj");
    expect(calls[0]!.env.HERO_STACK).toBe("python");
  });

  test("output is exactly stdout when stderr is empty (no trailing blank)", async () => {
    const { spawn } = makeFakeSpawn({
      exitCode: 0,
      stdout: "hello\n",
      stderr: "",
    });
    const tool = createVerifyTool({
      projectRoot: "/tmp/proj",
      stack: "python",
      spawn,
    });
    const result = await tool.execute({});
    expect(result.output).toBe("hello\n");
  });

  test("output combines stdout then a blank line then stderr when stderr is non-empty", async () => {
    const { spawn } = makeFakeSpawn({
      exitCode: 1,
      stdout: "out-line\n",
      stderr: "err-line\n",
    });
    const tool = createVerifyTool({
      projectRoot: "/tmp/proj",
      stack: "python",
      spawn,
    });
    const result = await tool.execute({});
    // stdout first, then blank line separator, then stderr.
    expect(result.output).toBe("out-line\n\nerr-line\n");
  });
});
