import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { spawnSync } from "node:child_process";
import {
  existsSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const PACKAGE_ROOT = new URL("..", import.meta.url).pathname;
const INIT_SCRIPT = join(PACKAGE_ROOT, "bin", "init.js");
const PINNED_PLUGIN_REF = "github:org/opencode-hero-workflow#v0.1.0";

const PACKAGE_VERSION = JSON.parse(
  readFileSync(join(PACKAGE_ROOT, "package.json"), "utf8"),
).version as string;

const DEFAULT_MODELS = {
  implementer: "github-copilot/claude-sonnet-4.5",
  reviewer: "github-copilot/claude-opus-4-7",
  planner: "github-copilot/claude-sonnet-4.5",
};

function modelFlags(overrides: Partial<typeof DEFAULT_MODELS> = {}) {
  const merged = { ...DEFAULT_MODELS, ...overrides };
  return [
    `--implementer=${merged.implementer}`,
    `--reviewer=${merged.reviewer}`,
    `--planner=${merged.planner}`,
  ];
}

function runInit(targetDir: string, extraArgs: string[] = []) {
  const result = spawnSync("bun", [INIT_SCRIPT, targetDir, ...modelFlags(), ...extraArgs], {
    encoding: "utf8",
  });
  if (result.status !== 0) {
    throw new Error(
      `init failed (status ${result.status}): ${result.stderr}\n${result.stdout}`,
    );
  }
  return result;
}

function runInitRaw(args: string[]) {
  return spawnSync("bun", [INIT_SCRIPT, ...args], { encoding: "utf8" });
}

describe("hero-init baseline scaffold", () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), "hero-init-test-"));
  });

  afterEach(() => {
    rmSync(tempDir, { recursive: true, force: true });
  });

  test("creates baseline files in a fresh directory", () => {
    runInit(tempDir);

    expect(existsSync(join(tempDir, ".hero", "config.jsonc"))).toBe(true);

    const versionFile = join(tempDir, ".hero", ".hero-version");
    expect(existsSync(versionFile)).toBe(true);
    expect(readFileSync(versionFile, "utf8").trim()).toBe(PACKAGE_VERSION);

    expect(existsSync(join(tempDir, ".opencode", "skills"))).toBe(true);
    expect(existsSync(join(tempDir, ".opencode", "commands"))).toBe(true);
  });

  test("creates opencode.json with defaultMode plan and pinned plugin ref", () => {
    runInit(tempDir);

    const opencodePath = join(tempDir, "opencode.json");
    expect(existsSync(opencodePath)).toBe(true);

    const parsed = JSON.parse(readFileSync(opencodePath, "utf8"));
    expect(parsed.defaultMode).toBe("plan");
    expect(Array.isArray(parsed.plugins)).toBe(true);
    expect(parsed.plugins).toContain(PINNED_PLUGIN_REF);
  });

  test("merges into an existing opencode.json without dropping unrelated keys", () => {
    const opencodePath = join(tempDir, "opencode.json");
    writeFileSync(
      opencodePath,
      JSON.stringify({ theme: "tokyonight" }, null, 2),
      "utf8",
    );

    runInit(tempDir);

    const parsed = JSON.parse(readFileSync(opencodePath, "utf8"));
    expect(parsed.theme).toBe("tokyonight");
    expect(parsed.defaultMode).toBe("plan");
    expect(parsed.plugins).toContain(PINNED_PLUGIN_REF);
  });
});

describe("hero-init model-role prompts", () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), "hero-init-models-"));
  });

  afterEach(() => {
    rmSync(tempDir, { recursive: true, force: true });
  });

  test("writes model values from flags into .hero/config.jsonc and preserves version", () => {
    runInit(tempDir);

    const configPath = join(tempDir, ".hero", "config.jsonc");
    const parsed = JSON.parse(readFileSync(configPath, "utf8"));

    expect(parsed.version).toBe("0.1.0");
    expect(parsed.models).toEqual(DEFAULT_MODELS);
  });

  test("uses exactly implementer, reviewer, planner under models", () => {
    runInit(tempDir);

    const parsed = JSON.parse(
      readFileSync(join(tempDir, ".hero", "config.jsonc"), "utf8"),
    );

    expect(Object.keys(parsed.models).sort()).toEqual([
      "implementer",
      "planner",
      "reviewer",
    ]);
  });

  test("fails non-zero when a model flag is empty", () => {
    const result = runInitRaw([
      tempDir,
      "--implementer=foo/bar",
      "--reviewer=",
      "--planner=baz/qux",
    ]);
    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain("reviewer");
  });
});
