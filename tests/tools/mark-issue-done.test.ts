import { describe, expect, test } from "bun:test";

import { createMarkIssueDoneTool } from "../../plugin/tools/mark-issue-done.ts";
import type { HeroConfig } from "../../plugin/config.ts";

// Build a fake gh runner that captures invocation args and returns a
// pre-programmed result. Keeps tests synchronous and free of process spawning.
function makeFakeGh(opts: {
  exitCode: number;
  stdout?: string;
  stderr?: string;
}) {
  const calls: Array<string[]> = [];
  const runGh = async (args: string[]) => {
    calls.push(args);
    return {
      stdout: opts.stdout ?? "",
      stderr: opts.stderr ?? "",
      exitCode: opts.exitCode,
    };
  };
  return { runGh, calls };
}

const githubWithRepo: HeroConfig["github"] = {
  repo: "owner/name",
  labels: {
    ready: "hero:ready",
    inProgress: "hero:in-progress",
    blocked: "hero:blocked",
  },
};

const githubNoRepo: HeroConfig["github"] = {
  repo: null,
  labels: {
    ready: "hero:ready",
    inProgress: "hero:in-progress",
    blocked: "hero:blocked",
  },
};

describe("createMarkIssueDoneTool", () => {
  test("tool name is exactly 'mark-issue-done'", () => {
    const { runGh } = makeFakeGh({ exitCode: 0 });
    const tool = createMarkIssueDoneTool({ config: githubNoRepo, runGh });
    expect(tool.name).toBe("mark-issue-done");
  });

  test("description is non-empty", () => {
    const { runGh } = makeFakeGh({ exitCode: 0 });
    const tool = createMarkIssueDoneTool({ config: githubNoRepo, runGh });
    expect(typeof tool.description).toBe("string");
    expect(tool.description.length).toBeGreaterThan(0);
  });

  test("successful close returns { closed: true, issueNumber }", async () => {
    const { runGh } = makeFakeGh({ exitCode: 0, stdout: "closed" });
    const tool = createMarkIssueDoneTool({ config: githubNoRepo, runGh });
    const result = await tool.execute({ issueNumber: 42 });
    expect(result).toEqual({ closed: true, issueNumber: 42 });
  });

  test("non-zero exit returns { closed: false, reason: <stderr trimmed> }", async () => {
    const { runGh } = makeFakeGh({
      exitCode: 1,
      stderr: "  could not close issue: not found\n",
    });
    const tool = createMarkIssueDoneTool({ config: githubNoRepo, runGh });
    const result = await tool.execute({ issueNumber: 99 });
    expect(result).toEqual({
      closed: false,
      reason: "could not close issue: not found",
    });
  });

  test("default comment is 'Completed by Hero workflow'", async () => {
    const { runGh, calls } = makeFakeGh({ exitCode: 0 });
    const tool = createMarkIssueDoneTool({ config: githubNoRepo, runGh });
    await tool.execute({ issueNumber: 7 });
    expect(calls.length).toBe(1);
    expect(calls[0]).toContain("Completed by Hero workflow");
  });

  test("custom comment 'Closed via Sandcastle' is forwarded to gh", async () => {
    const { runGh, calls } = makeFakeGh({ exitCode: 0 });
    const tool = createMarkIssueDoneTool({ config: githubNoRepo, runGh });
    await tool.execute({ issueNumber: 7, comment: "Closed via Sandcastle" });
    expect(calls.length).toBe(1);
    expect(calls[0]).toContain("Closed via Sandcastle");
    expect(calls[0]).not.toContain("Completed by Hero workflow");
  });

  test("config.repo === 'owner/name' adds --repo owner/name to gh args", async () => {
    const { runGh, calls } = makeFakeGh({ exitCode: 0 });
    const tool = createMarkIssueDoneTool({ config: githubWithRepo, runGh });
    await tool.execute({ issueNumber: 1 });
    expect(calls.length).toBe(1);
    const args = calls[0]!;
    const repoIdx = args.indexOf("--repo");
    expect(repoIdx).toBeGreaterThanOrEqual(0);
    expect(args[repoIdx + 1]).toBe("owner/name");
  });

  test("config.repo === null does not add --repo to gh args", async () => {
    const { runGh, calls } = makeFakeGh({ exitCode: 0 });
    const tool = createMarkIssueDoneTool({ config: githubNoRepo, runGh });
    await tool.execute({ issueNumber: 1 });
    expect(calls.length).toBe(1);
    expect(calls[0]).not.toContain("--repo");
  });

  test("gh args invoke 'issue close <number> --comment <text>'", async () => {
    const { runGh, calls } = makeFakeGh({ exitCode: 0 });
    const tool = createMarkIssueDoneTool({ config: githubNoRepo, runGh });
    await tool.execute({ issueNumber: 5 });
    expect(calls.length).toBe(1);
    const args = calls[0]!;
    expect(args[0]).toBe("issue");
    expect(args[1]).toBe("close");
    expect(args[2]).toBe("5");
    const commentIdx = args.indexOf("--comment");
    expect(commentIdx).toBeGreaterThan(2);
    expect(args[commentIdx + 1]).toBe("Completed by Hero workflow");
  });

  test("invalid issueNumber: zero returns failure and does NOT call gh", async () => {
    const { runGh, calls } = makeFakeGh({ exitCode: 0 });
    const tool = createMarkIssueDoneTool({ config: githubNoRepo, runGh });
    const result = await tool.execute({ issueNumber: 0 });
    expect(result.closed).toBe(false);
    if (result.closed === false) {
      expect(result.reason).toBe("issueNumber must be a positive integer");
    }
    expect(calls.length).toBe(0);
  });

  test("invalid issueNumber: negative returns failure and does NOT call gh", async () => {
    const { runGh, calls } = makeFakeGh({ exitCode: 0 });
    const tool = createMarkIssueDoneTool({ config: githubNoRepo, runGh });
    const result = await tool.execute({ issueNumber: -3 });
    expect(result.closed).toBe(false);
    if (result.closed === false) {
      expect(result.reason).toBe("issueNumber must be a positive integer");
    }
    expect(calls.length).toBe(0);
  });

  test("invalid issueNumber: NaN returns failure and does NOT call gh", async () => {
    const { runGh, calls } = makeFakeGh({ exitCode: 0 });
    const tool = createMarkIssueDoneTool({ config: githubNoRepo, runGh });
    const result = await tool.execute({ issueNumber: Number.NaN });
    expect(result.closed).toBe(false);
    if (result.closed === false) {
      expect(result.reason).toBe("issueNumber must be a positive integer");
    }
    expect(calls.length).toBe(0);
  });

  test("invalid issueNumber: non-integer (1.5) returns failure and does NOT call gh", async () => {
    const { runGh, calls } = makeFakeGh({ exitCode: 0 });
    const tool = createMarkIssueDoneTool({ config: githubNoRepo, runGh });
    const result = await tool.execute({ issueNumber: 1.5 });
    expect(result.closed).toBe(false);
    if (result.closed === false) {
      expect(result.reason).toBe("issueNumber must be a positive integer");
    }
    expect(calls.length).toBe(0);
  });
});
