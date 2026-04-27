import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { HeroConfigError, loadHeroConfig } from "../plugin/config.ts";

function writeConfig(root: string, body: string) {
  mkdirSync(join(root, ".hero"), { recursive: true });
  writeFileSync(join(root, ".hero", "config.jsonc"), body, "utf8");
}

describe("loadHeroConfig", () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), "hero-config-test-"));
  });

  afterEach(() => {
    rmSync(tempDir, { recursive: true, force: true });
  });

  test("minimal config fills all defaults", async () => {
    writeConfig(
      tempDir,
      JSON.stringify({
        version: "0.1.1",
        models: {
          implementer: "github-copilot/claude-sonnet-4.5",
          reviewer: "github-copilot/claude-opus-4-7",
          planner: "github-copilot/claude-sonnet-4.5",
        },
      }),
    );

    const cfg = await loadHeroConfig(tempDir);

    expect(cfg.version).toBe("0.1.1");
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
    writeConfig(
      tempDir,
      `// top comment
{
  /* block comment */
  "version": "0.1.1",
  "models": {
    "implementer": "x/y", // line trailing
    "reviewer": "x/y",
    "planner": "x/y"
  }
}
`,
    );

    const cfg = await loadHeroConfig(tempDir);
    expect(cfg.version).toBe("0.1.1");
    expect(cfg.models.reviewer).toBe("x/y");
  });

  test("missing models.implementer throws HeroConfigError mentioning the path", async () => {
    writeConfig(
      tempDir,
      JSON.stringify({
        version: "0.1.1",
        models: {
          reviewer: "x/y",
          planner: "x/y",
        },
      }),
    );

    await expect(loadHeroConfig(tempDir)).rejects.toBeInstanceOf(
      HeroConfigError,
    );
    await expect(loadHeroConfig(tempDir)).rejects.toThrow(/models\.implementer/);
  });

  test("unknown top-level fields are ignored", async () => {
    writeConfig(
      tempDir,
      JSON.stringify({
        version: "0.1.1",
        models: { implementer: "a/b", reviewer: "a/b", planner: "a/b" },
        nonsense: { whatever: true },
      }),
    );

    const cfg = await loadHeroConfig(tempDir);
    expect(cfg.version).toBe("0.1.1");
    expect((cfg as Record<string, unknown>).nonsense).toBeUndefined();
  });

  test("wrong type on tokenBudget.warnAt names the path", async () => {
    writeConfig(
      tempDir,
      JSON.stringify({
        version: "0.1.1",
        models: { implementer: "a/b", reviewer: "a/b", planner: "a/b" },
        tokenBudget: { warnAt: "lots" },
      }),
    );

    await expect(loadHeroConfig(tempDir)).rejects.toThrow(
      /tokenBudget\.warnAt/,
    );
  });
});
