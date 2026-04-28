import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { spawnSync } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const PACKAGE_ROOT = new URL("..", import.meta.url).pathname;
const INIT_SCRIPT = join(PACKAGE_ROOT, "bin", "init.js");
const PLUGIN_REF = "opencode-hero-workflow";

const PACKAGE_VERSION = JSON.parse(
  readFileSync(join(PACKAGE_ROOT, "package.json"), "utf8"),
).version as string;

const DEFAULT_MODELS = {
  implementer: "github-copilot/claude-sonnet-4.5",
  reviewer: "github-copilot/claude-opus-4-7",
  planner: "github-copilot/claude-sonnet-4.5",
};

const HERO_COMMAND_KEYS = [
  "hero:hero-grill",
  "hero:hero-tdd-loop",
  "hero:hero-kanban",
  "hero:hero-improve-architecture",
  "hero:hero-reviewer-standards",
  "hero:hero-dogfood",
  "hero:hero-to-prd",
];

function modelFlags(overrides: Partial<typeof DEFAULT_MODELS> = {}) {
  const merged = { ...DEFAULT_MODELS, ...overrides };
  return [
    `--implementer=${merged.implementer}`,
    `--reviewer=${merged.reviewer}`,
    `--planner=${merged.planner}`,
  ];
}

function runInitRaw(
  args: string[],
  opts: { homeDir: string; cwd?: string } = { homeDir: process.env.HOME ?? "/tmp" },
) {
  return spawnSync("bun", [INIT_SCRIPT, ...args], {
    encoding: "utf8",
    cwd: opts.cwd,
    env: { ...process.env, HOME: opts.homeDir },
  });
}

function runInit(args: string[], opts: { homeDir: string; cwd?: string }) {
  const result = runInitRaw(args, opts);
  if (result.status !== 0) {
    throw new Error(
      `init failed (status ${result.status}): ${result.stderr}\n${result.stdout}`,
    );
  }
  return result;
}

function readJson(path: string) {
  return JSON.parse(readFileSync(path, "utf8"));
}

describe("hero-init global mode (default)", () => {
  let tempDir: string;
  let homeDir: string;
  let projectDir: string;

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), "hero-init-global-"));
    homeDir = join(tempDir, "home");
    projectDir = join(tempDir, "project");
    mkdirSync(homeDir, { recursive: true });
    mkdirSync(projectDir, { recursive: true });
  });

  afterEach(() => {
    rmSync(tempDir, { recursive: true, force: true });
  });

  test("installs under ~/.config/opencode and does not write project files", () => {
    runInit([...modelFlags()], { homeDir, cwd: projectDir });

    const globalRoot = join(homeDir, ".config", "opencode");
    expect(existsSync(join(globalRoot, "hero", "config.jsonc"))).toBe(true);
    expect(existsSync(join(globalRoot, "skills", "hero-grill", "SKILL.md"))).toBe(true);
    expect(existsSync(join(projectDir, ".hero"))).toBe(false);
    expect(existsSync(join(projectDir, ".opencode"))).toBe(false);
    expect(existsSync(join(projectDir, "opencode.json"))).toBe(false);
  });

  test("writes hero config with prompted models and tracks manifest in hero/.manifest.json", () => {
    runInit([...modelFlags()], { homeDir, cwd: projectDir });

    const globalRoot = join(homeDir, ".config", "opencode");
    const config = readJson(join(globalRoot, "hero", "config.jsonc"));
    expect(config.version).toBe(PACKAGE_VERSION);
    expect(config.models).toEqual(DEFAULT_MODELS);

    const manifest = readJson(join(globalRoot, "hero", ".manifest.json"));
    expect(manifest.version).toBe(PACKAGE_VERSION);
    expect(manifest.files["hero/config.jsonc"]).toMatch(/^[a-f0-9]{64}$/);
    expect(manifest.files["skills/hero-grill/SKILL.md"]).toMatch(/^[a-f0-9]{64}$/);
  });

  test("registers hero:* commands in opencode.json command map and adds plugin", () => {
    runInit([...modelFlags()], { homeDir, cwd: projectDir });

    const globalRoot = join(homeDir, ".config", "opencode");
    const parsed = readJson(join(globalRoot, "opencode.json"));

    expect(Array.isArray(parsed.plugin)).toBe(true);
    expect(parsed.plugin).toContain(PLUGIN_REF);
    expect(parsed.default_agent).toBeUndefined();
    for (const key of HERO_COMMAND_KEYS) {
      expect(parsed.command[key]).toEqual(expect.any(String));
    }

    expect(existsSync(join(globalRoot, ".opencode", "commands"))).toBe(false);
    expect(existsSync(join(globalRoot, ".opencode", "commands", "grill.md"))).toBe(false);
  });

  test("merges opencode.json without clobbering unrelated keys or default_agent", () => {
    const globalRoot = join(homeDir, ".config", "opencode");
    const opencodePath = join(globalRoot, "opencode.json");
    mkdirSync(globalRoot, { recursive: true });
    writeFileSync(
      opencodePath,
      JSON.stringify(
        {
          theme: "tokyonight",
          default_agent: "code",
          command: { "custom:hello": "say hi" },
          plugin: ["other-plugin"],
        },
        null,
        2,
      ),
      "utf8",
    );

    runInit([...modelFlags()], { homeDir, cwd: projectDir });

    const parsed = readJson(opencodePath);
    expect(parsed.theme).toBe("tokyonight");
    expect(parsed.default_agent).toBe("code");
    expect(parsed.command["custom:hello"]).toBe("say hi");
    for (const key of HERO_COMMAND_KEYS) {
      expect(parsed.command[key]).toEqual(expect.any(String));
    }
    expect(parsed.plugin).toContain("other-plugin");
    expect(parsed.plugin).toContain(PLUGIN_REF);
  });

  test("is idempotent and refuses to overwrite user-edited global files", () => {
    runInit([...modelFlags()], { homeDir, cwd: projectDir });

    const globalRoot = join(homeDir, ".config", "opencode");
    const configPath = join(globalRoot, "hero", "config.jsonc");
    const beforeMtime = statSync(configPath).mtimeMs;

    const second = runInit([...modelFlags()], { homeDir, cwd: projectDir });
    expect(statSync(configPath).mtimeMs).toBe(beforeMtime);
    expect(second.stdout).not.toMatch(/wrote hero\/config\.jsonc/);

    const customised = readJson(configPath);
    customised.models.implementer = "user-pinned/some-model";
    writeFileSync(configPath, `${JSON.stringify(customised, null, 2)}\n`, "utf8");

    const conflict = runInitRaw([...modelFlags()], { homeDir, cwd: projectDir });
    expect(conflict.status).not.toBe(0);
    expect(conflict.stderr).toContain("hero/config.jsonc");
    expect(conflict.stderr).toContain("--force");
  });
});

describe("hero-init local mode (--local)", () => {
  let tempDir: string;
  let homeDir: string;
  let projectDir: string;

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), "hero-init-local-"));
    homeDir = join(tempDir, "home");
    projectDir = join(tempDir, "project");
    mkdirSync(homeDir, { recursive: true });
    mkdirSync(projectDir, { recursive: true });
  });

  afterEach(() => {
    rmSync(tempDir, { recursive: true, force: true });
  });

  test("preserves prior project-local scaffold behavior when --local is passed", () => {
    runInit([projectDir, "--local", ...modelFlags()], { homeDir });

    expect(existsSync(join(projectDir, ".hero", "config.jsonc"))).toBe(true);
    expect(existsSync(join(projectDir, ".opencode", "skills", "hero-grill", "SKILL.md"))).toBe(
      true,
    );
    expect(existsSync(join(projectDir, ".opencode", "commands", "grill.md"))).toBe(true);

    const parsed = readJson(join(projectDir, "opencode.json"));
    expect(parsed.default_agent).toBe("plan");
    expect(parsed.plugin).toContain(PLUGIN_REF);
    expect(parsed.command).toBeUndefined();
  });

  test("continues to track local manifest at .hero/.manifest.json", () => {
    runInit([projectDir, "--local", ...modelFlags()], { homeDir });

    const manifest = readJson(join(projectDir, ".hero", ".manifest.json"));
    expect(manifest.version).toBe(PACKAGE_VERSION);
    expect(manifest.files[".hero/config.jsonc"]).toMatch(/^[a-f0-9]{64}$/);
    expect(manifest.files[".opencode/commands/grill.md"]).toMatch(/^[a-f0-9]{64}$/);
    expect(manifest.files["opencode.json"]).toBeUndefined();
  });
});
