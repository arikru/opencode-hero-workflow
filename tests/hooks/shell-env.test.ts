import { describe, expect, test } from "bun:test";

import { createShellEnvHook } from "../../plugin/hooks/shell-env.ts";

describe("createShellEnvHook", () => {
  test("returns env map with HERO_PROJECT_ROOT and HERO_STACK", () => {
    const hook = createShellEnvHook({
      projectRoot: "/tmp/proj",
      stack: "python",
    });
    const env = hook();
    expect(env.HERO_PROJECT_ROOT).toBe("/tmp/proj");
    expect(env.HERO_STACK).toBe("python");
  });

  test("HERO_STACK is the literal config value (no auto-resolution in TS)", () => {
    const hook = createShellEnvHook({
      projectRoot: "/tmp/proj",
      stack: "auto",
    });
    expect(hook().HERO_STACK).toBe("auto");
  });

  test("preserves node stack literal", () => {
    const hook = createShellEnvHook({
      projectRoot: "/tmp/proj",
      stack: "node",
    });
    expect(hook().HERO_STACK).toBe("node");
  });

  test("returns a fresh object on each call", () => {
    const hook = createShellEnvHook({
      projectRoot: "/tmp/proj",
      stack: "python",
    });
    const a = hook();
    const b = hook();
    expect(a).not.toBe(b);
    a.HERO_STACK = "mutated";
    expect(b.HERO_STACK).toBe("python");
  });

  test("contains exactly the two expected keys", () => {
    const hook = createShellEnvHook({
      projectRoot: "/tmp/proj",
      stack: "python",
    });
    expect(Object.keys(hook()).sort()).toEqual([
      "HERO_PROJECT_ROOT",
      "HERO_STACK",
    ]);
  });
});
