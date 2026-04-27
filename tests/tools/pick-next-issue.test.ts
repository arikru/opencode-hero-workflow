import { describe, expect, test } from "bun:test";

import {
  createPickNextIssueTool,
  type GhRunner,
} from "../../plugin/tools/pick-next-issue.ts";
import type { HeroConfig } from "../../plugin/config.ts";

// Default labels mirror the Zod defaults in plugin/config.ts so individual
// tests don't have to repeat the full literal each time.
const DEFAULT_LABELS = {
  ready: "hero:ready",
  inProgress: "hero:in-progress",
  blocked: "hero:blocked",
};

function ghConfig(
  overrides: Partial<HeroConfig["github"]> = {},
): HeroConfig["github"] {
  return {
    repo: null,
    labels: DEFAULT_LABELS,
    ...overrides,
  };
}

// Build a GhRunner fake: it captures every call and returns a canned result.
// The result can be a single object reused across calls or a queue keyed by
// invocation index for tests that exercise multiple shell-outs.
function makeFakeRunGh(result: {
  stdout?: string;
  stderr?: string;
  exitCode?: number;
}) {
  const calls: Array<string[]> = [];
  const runGh: GhRunner = async (args) => {
    calls.push(args);
    return {
      stdout: result.stdout ?? "",
      stderr: result.stderr ?? "",
      exitCode: result.exitCode ?? 0,
    };
  };
  return { runGh, calls };
}

describe("createPickNextIssueTool", () => {
  test("tool name is exactly 'pick-next-issue'", () => {
    const { runGh } = makeFakeRunGh({ stdout: "[]" });
    const tool = createPickNextIssueTool({ config: ghConfig(), runGh });
    expect(tool.name).toBe("pick-next-issue");
  });

  test("description is non-empty", () => {
    const { runGh } = makeFakeRunGh({ stdout: "[]" });
    const tool = createPickNextIssueTool({ config: ghConfig(), runGh });
    expect(typeof tool.description).toBe("string");
    expect(tool.description.length).toBeGreaterThan(0);
  });

  test("single ready issue with no blocked label is returned with all fields", async () => {
    const issue = {
      number: 42,
      title: "Implement /grill",
      body: "Body of issue 42",
      url: "https://github.com/o/r/issues/42",
      labels: [{ name: "hero:ready" }],
    };
    const { runGh } = makeFakeRunGh({ stdout: JSON.stringify([issue]) });
    const tool = createPickNextIssueTool({ config: ghConfig(), runGh });
    const result = await tool.execute({});
    expect(result).toEqual({
      found: true,
      number: 42,
      title: "Implement /grill",
      body: "Body of issue 42",
      url: "https://github.com/o/r/issues/42",
    });
  });

  test("two ready issues — lower issue number wins (sort ascending)", async () => {
    const issues = [
      {
        number: 17,
        title: "Higher number",
        body: "b17",
        url: "u17",
        labels: [{ name: "hero:ready" }],
      },
      {
        number: 5,
        title: "Lower number",
        body: "b5",
        url: "u5",
        labels: [{ name: "hero:ready" }],
      },
    ];
    const { runGh } = makeFakeRunGh({ stdout: JSON.stringify(issues) });
    const tool = createPickNextIssueTool({ config: ghConfig(), runGh });
    const result = await tool.execute({});
    expect(result).toMatchObject({ found: true, number: 5, title: "Lower number" });
  });

  test("issue carrying both hero:ready and hero:blocked is filtered out", async () => {
    const issues = [
      {
        number: 9,
        title: "Blocked",
        body: "",
        url: "u9",
        labels: [{ name: "hero:ready" }, { name: "hero:blocked" }],
      },
      {
        number: 12,
        title: "Free",
        body: "",
        url: "u12",
        labels: [{ name: "hero:ready" }],
      },
    ];
    const { runGh } = makeFakeRunGh({ stdout: JSON.stringify(issues) });
    const tool = createPickNextIssueTool({ config: ghConfig(), runGh });
    const result = await tool.execute({});
    expect(result).toMatchObject({ found: true, number: 12 });
  });

  test("no issues found → found:false with reason", async () => {
    const { runGh } = makeFakeRunGh({ stdout: "[]" });
    const tool = createPickNextIssueTool({ config: ghConfig(), runGh });
    const result = await tool.execute({});
    expect(result).toEqual({
      found: false,
      reason: "No unblocked hero:ready issues found.",
    });
  });

  test("all candidates blocked → found:false with reason", async () => {
    const issues = [
      {
        number: 1,
        title: "B1",
        body: "",
        url: "u1",
        labels: [{ name: "hero:ready" }, { name: "hero:blocked" }],
      },
    ];
    const { runGh } = makeFakeRunGh({ stdout: JSON.stringify(issues) });
    const tool = createPickNextIssueTool({ config: ghConfig(), runGh });
    const result = await tool.execute({});
    expect(result.found).toBe(false);
  });

  test("gh non-zero exit → found:false with stderr as reason", async () => {
    const { runGh } = makeFakeRunGh({
      stdout: "",
      stderr: "  gh: not authenticated\n",
      exitCode: 1,
    });
    const tool = createPickNextIssueTool({ config: ghConfig(), runGh });
    const result = await tool.execute({});
    expect(result).toEqual({ found: false, reason: "gh: not authenticated" });
  });

  test("config.repo === 'owner/name' → runGh called with --repo owner/name", async () => {
    const { runGh, calls } = makeFakeRunGh({ stdout: "[]" });
    const tool = createPickNextIssueTool({
      config: ghConfig({ repo: "owner/name" }),
      runGh,
    });
    await tool.execute({});
    expect(calls.length).toBe(1);
    const args = calls[0]!;
    expect(args).toContain("--repo");
    const repoIdx = args.indexOf("--repo");
    expect(args[repoIdx + 1]).toBe("owner/name");
  });

  test("config.repo === null → runGh called WITHOUT --repo", async () => {
    const { runGh, calls } = makeFakeRunGh({ stdout: "[]" });
    const tool = createPickNextIssueTool({
      config: ghConfig({ repo: null }),
      runGh,
    });
    await tool.execute({});
    expect(calls[0]).not.toContain("--repo");
  });

  test("custom ready label is forwarded to gh as --label", async () => {
    const { runGh, calls } = makeFakeRunGh({ stdout: "[]" });
    const tool = createPickNextIssueTool({
      config: ghConfig({
        labels: { ...DEFAULT_LABELS, ready: "needs-impl" },
      }),
      runGh,
    });
    await tool.execute({});
    const args = calls[0]!;
    expect(args).toContain("--label");
    const labelIdx = args.indexOf("--label");
    expect(args[labelIdx + 1]).toBe("needs-impl");
  });

  test("invokes `gh issue list` with --state open and --json fields", async () => {
    const { runGh, calls } = makeFakeRunGh({ stdout: "[]" });
    const tool = createPickNextIssueTool({ config: ghConfig(), runGh });
    await tool.execute({});
    const args = calls[0]!;
    expect(args[0]).toBe("issue");
    expect(args[1]).toBe("list");
    expect(args).toContain("--state");
    const stateIdx = args.indexOf("--state");
    expect(args[stateIdx + 1]).toBe("open");
    expect(args).toContain("--json");
    const jsonIdx = args.indexOf("--json");
    const jsonFields = args[jsonIdx + 1] ?? "";
    expect(jsonFields).toContain("number");
    expect(jsonFields).toContain("title");
    expect(jsonFields).toContain("body");
    expect(jsonFields).toContain("url");
    expect(jsonFields).toContain("labels");
  });
});
