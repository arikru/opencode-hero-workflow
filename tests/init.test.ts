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
const LEGACY_PLUGIN_REF = "github:arikru/opencode-hero-workflow#v0.1.2";

const PACKAGE_VERSION = JSON.parse(
  readFileSync(join(PACKAGE_ROOT, "package.json"), "utf8"),
).version as string;

const DEFAULT_MODELS = {
  implementer: "github-copilot/claude-sonnet-4.5",
  reviewer: "github-copilot/claude-opus-4-7",
  planner: "github-copilot/claude-sonnet-4.5",
};

const HERO_COMMAND_KEYS = [
  "hero:grill-me",
  "hero:tdd-loop",
  "hero:kanban",
  "hero:improve-architecture",
  "hero:reviewer-standards",
  "hero:dogfood",
  "hero:to-prd",
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
      const entry = parsed.command[key];
      expect(entry).toEqual(expect.any(Object));
      expect(typeof entry.template).toBe("string");
      expect(entry.template.length).toBeGreaterThan(0);
    }

    expect(existsSync(join(globalRoot, ".opencode", "commands"))).toBe(false);
    expect(existsSync(join(globalRoot, ".opencode", "commands", "grill.md"))).toBe(false);
  });

  test("upgrades legacy string-form hero:* command entries to object form", () => {
    const globalRoot = join(homeDir, ".config", "opencode");
    const opencodePath = join(globalRoot, "opencode.json");
    mkdirSync(globalRoot, { recursive: true });
    writeFileSync(
      opencodePath,
      JSON.stringify(
        {
          command: {
            "hero:grill-me": "old string-form prompt that broke the schema",
            "custom:hello": "say hi",
          },
        },
        null,
        2,
      ),
      "utf8",
    );

    runInit([...modelFlags()], { homeDir, cwd: projectDir });

    const parsed = readJson(opencodePath);
    // Legacy string entry should be replaced with the proper object form.
    expect(typeof parsed.command["hero:grill-me"]).toBe("object");
    expect(typeof parsed.command["hero:grill-me"].template).toBe("string");
    // Unrelated user entries are preserved as-is, even if they are strings.
    expect(parsed.command["custom:hello"]).toBe("say hi");
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
      const entry = parsed.command[key];
      expect(entry).toEqual(expect.any(Object));
      expect(typeof entry.template).toBe("string");
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

  test("uninstalls cleanly and prunes empty managed directories", () => {
    runInit([...modelFlags()], { homeDir, cwd: projectDir });

    const globalRoot = join(homeDir, ".config", "opencode");
    const opencodePath = join(globalRoot, "opencode.json");
    writeFileSync(
      opencodePath,
      JSON.stringify(
        {
          default_agent: "code",
          command: {
            "custom:hello": "say hi",
            "hero:grill-me": "old hero command",
          },
          plugin: ["other-plugin", PLUGIN_REF, LEGACY_PLUGIN_REF],
        },
        null,
        2,
      ),
      "utf8",
    );

    const result = runInit(["--uninstall"], { homeDir, cwd: projectDir });
    expect(result.stdout).toContain("Uninstall removed");
    expect(result.stdout).toContain("Uninstall skipped 0 modified file(s).");

    expect(existsSync(join(globalRoot, "hero", "config.jsonc"))).toBe(false);
    expect(existsSync(join(globalRoot, "skills", "hero-grill", "SKILL.md"))).toBe(false);
    expect(existsSync(join(globalRoot, "skills"))).toBe(false);
    expect(existsSync(join(globalRoot, "hero", ".manifest.json"))).toBe(true);

    const parsed = readJson(opencodePath);
    expect(parsed.default_agent).toBe("code");
    expect(parsed.command["custom:hello"]).toBe("say hi");
    expect(parsed.command["hero:grill-me"]).toBeUndefined();
    expect(parsed.plugin).toContain("other-plugin");
    expect(parsed.plugin).not.toContain(PLUGIN_REF);
    expect(parsed.plugin).not.toContain(LEGACY_PLUGIN_REF);
  });

  test("uninstall skips modified files and reports them", () => {
    runInit([...modelFlags()], { homeDir, cwd: projectDir });

    const globalRoot = join(homeDir, ".config", "opencode");
    const configPath = join(globalRoot, "hero", "config.jsonc");
    writeFileSync(configPath, "{\n  \"version\": \"custom\"\n}\n", "utf8");

    const result = runInit(["--uninstall"], { homeDir, cwd: projectDir });
    expect(result.stdout).toContain("Uninstall skipped 1 modified file(s).");
    expect(result.stdout).toContain("skipped-modified: hero/config.jsonc");
    expect(result.stdout).toContain("Some files were skipped because they were modified");
    expect(result.stderr).toContain("skipped modified file: hero/config.jsonc");
    expect(existsSync(configPath)).toBe(true);
  });

  test("uninstall ignores already absent files", () => {
    runInit([...modelFlags()], { homeDir, cwd: projectDir });

    const globalRoot = join(homeDir, ".config", "opencode");
    const removedAlready = join(globalRoot, "skills", "hero-grill", "SKILL.md");
    rmSync(removedAlready, { force: true });

    const result = runInit(["--uninstall"], { homeDir, cwd: projectDir });
    expect(result.stdout).toContain("Uninstall removed");
    expect(result.stdout).toContain("Uninstall skipped 0 modified file(s).");
    expect(result.stdout).not.toContain("skipped-modified:");
    expect(result.stderr).toBe("");
  });

  test("uninstall aborts clearly when manifest is missing", () => {
    const result = runInitRaw(["--uninstall"], { homeDir, cwd: projectDir });
    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain("Cannot uninstall: missing manifest");
    expect(result.stderr).toContain(join(homeDir, ".config", "opencode", "hero", ".manifest.json"));
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
