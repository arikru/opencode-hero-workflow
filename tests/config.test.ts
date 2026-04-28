import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { HeroConfigError, loadHeroConfig } from "../plugin/config.ts";

function writeProjectConfig(root: string, body: string) {
  mkdirSync(join(root, ".hero"), { recursive: true });
  writeFileSync(join(root, ".hero", "config.jsonc"), body, "utf8");
}

function writeGlobalConfig(homeRoot: string, body: string) {
  const dir = join(homeRoot, ".config", "opencode", "hero");
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, "config.jsonc"), body, "utf8");
}

function getGlobalConfigPath(homeRoot: string): string {
  return join(homeRoot, ".config", "opencode", "hero", "config.jsonc");
}

const MINIMAL_CONFIG = JSON.stringify({
  version: "0.1.2",
  models: {
    implementer: "github-copilot/claude-sonnet-4.5",
    reviewer: "github-copilot/claude-opus-4-7",
    planner: "github-copilot/claude-sonnet-4.5",
  },
});

describe("loadHeroConfig", () => {
  let projectDir: string;
  let homeDir: string;
  let previousHome: string | undefined;

  beforeEach(() => {
    projectDir = mkdtempSync(join(tmpdir(), "hero-config-test-project-"));
    homeDir = mkdtempSync(join(tmpdir(), "hero-config-test-home-"));
    previousHome = process.env.HOME;
    process.env.HOME = homeDir;
  });

  afterEach(() => {
    if (previousHome === undefined) {
      delete process.env.HOME;
    } else {
      process.env.HOME = previousHome;
    }
    rmSync(projectDir, { recursive: true, force: true });
    rmSync(homeDir, { recursive: true, force: true });
  });

  test("global-only config fills all defaults", async () => {
    writeGlobalConfig(homeDir, MINIMAL_CONFIG);

    const cfg = await loadHeroConfig(projectDir);

    expect(cfg.version).toBe("0.1.2");
    expect(cfg.models.implementer).toBe("github-copilot/claude-sonnet-4.5");
    expect(cfg.stack).toBe("auto");
    expect(cfg.verify.enabled).toBe(true);
    expect(cfg.verify.debounceMs).toBe(5000);
    expect(cfg.verify.commands).toEqual([]);
    expect(cfg.tokenBudget.warnAt).toBe(80000);
    expect(cfg.tokenBudget.alarmAt).toBe(100000);
    expect(cfg.guardrails.blockEnvReads).toBe(true);
    expect(cfg.guardrails.blockForcePush).toBe(true);
    expect(cfg.github.repo).toBeNull();
    expect(cfg.github.labels.ready).toBe("hero:ready");
    expect(cfg.github.labels.inProgress).toBe("hero:in-progress");
    expect(cfg.github.labels.blocked).toBe("hero:blocked");
    expect(cfg.sandcastle.enabled).toBe(false);
    expect(cfg.sandcastle.sandboxProvider).toBe("sandcastle");
    expect(cfg.sandcastle.imageName).toBe("ubuntu:24.04");
    expect(cfg.sandcastle.mountOpencodeAuth).toBe(true);
    expect(cfg.sandcastle.maxIterations).toBe(50);
    expect(cfg.sandcastle.idleTimeoutSeconds).toBe(600);
  });

  test("parses JSONC comments", async () => {
    writeGlobalConfig(
      homeDir,
      `// top comment
{
  /* block comment */
  "version": "0.1.2",
  "models": {
    "implementer": "x/y", // line trailing
    "reviewer": "x/y",
    "planner": "x/y"
  }
}
`,
    );

    const cfg = await loadHeroConfig(projectDir);
    expect(cfg.version).toBe("0.1.2");
    expect(cfg.models.reviewer).toBe("x/y");
  });

  test("project override updates top-level fields", async () => {
    writeGlobalConfig(homeDir, MINIMAL_CONFIG);
    writeProjectConfig(
      projectDir,
      JSON.stringify({
        stack: "node",
      }),
    );

    const cfg = await loadHeroConfig(projectDir);
    expect(cfg.stack).toBe("node");
    expect(cfg.models.implementer).toBe("github-copilot/claude-sonnet-4.5");
  });

  test("project values win in deep merge", async () => {
    writeGlobalConfig(
      homeDir,
      JSON.stringify({
        version: "0.1.2",
        models: {
          implementer: "a/b",
          reviewer: "a/b",
          planner: "a/b",
        },
        github: {
          labels: {
            ready: "global:ready",
            inProgress: "global:in-progress",
          },
        },
      }),
    );
    writeProjectConfig(
      projectDir,
      JSON.stringify({
        github: {
          labels: {
            ready: "project:ready",
          },
        },
      }),
    );

    const cfg = await loadHeroConfig(projectDir);
    expect(cfg.github.labels.ready).toBe("project:ready");
    expect(cfg.github.labels.inProgress).toBe("global:in-progress");
    expect(cfg.github.labels.blocked).toBe("hero:blocked");
  });

  test("missing global config throws HeroConfigError mentioning the global path", async () => {
    await expect(loadHeroConfig(projectDir)).rejects.toBeInstanceOf(HeroConfigError);
    await expect(loadHeroConfig(projectDir)).rejects.toThrow(
      new RegExp(getGlobalConfigPath(homeDir).replace(/[.*+?^${}()|[\]\\]/g, "\\$&")),
    );
  });

  test("unknown top-level fields are ignored", async () => {
    writeGlobalConfig(
      homeDir,
      JSON.stringify({
        version: "0.1.2",
        models: { implementer: "a/b", reviewer: "a/b", planner: "a/b" },
        nonsense: { whatever: true },
      }),
    );

    const cfg = await loadHeroConfig(projectDir);
    expect(cfg.version).toBe("0.1.2");
    expect((cfg as Record<string, unknown>).nonsense).toBeUndefined();
  });

  test("wrong type on tokenBudget.warnAt names the path", async () => {
    writeGlobalConfig(
      homeDir,
      JSON.stringify({
        version: "0.1.2",
        models: { implementer: "a/b", reviewer: "a/b", planner: "a/b" },
        tokenBudget: { warnAt: "lots" },
      }),
    );

    await expect(loadHeroConfig(projectDir)).rejects.toThrow(
      /tokenBudget\.warnAt/,
    );
  });

  test("missing models.implementer throws HeroConfigError mentioning the path", async () => {
    writeGlobalConfig(
      homeDir,
      JSON.stringify({
        version: "0.1.2",
        models: {
          reviewer: "x/y",
          planner: "x/y",
        },
      }),
    );

    await expect(loadHeroConfig(projectDir)).rejects.toBeInstanceOf(HeroConfigError);
    await expect(loadHeroConfig(projectDir)).rejects.toThrow(/models\.implementer/);
  });
});
