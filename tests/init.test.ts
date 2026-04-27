import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { spawnSync } from "node:child_process";
import {
  existsSync,
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
const PINNED_PLUGIN_REF = "github:arikru/opencode-hero-workflow#v0.1.0";

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

  test("creates opencode.json with default_agent plan and pinned plugin ref", () => {
    runInit(tempDir);

    const opencodePath = join(tempDir, "opencode.json");
    expect(existsSync(opencodePath)).toBe(true);

    const parsed = JSON.parse(readFileSync(opencodePath, "utf8"));
    expect(parsed.default_agent).toBe("plan");
    expect(Array.isArray(parsed.plugin)).toBe(true);
    expect(parsed.plugin).toContain(PINNED_PLUGIN_REF);
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
    expect(parsed.default_agent).toBe("plan");
    expect(parsed.plugin).toContain(PINNED_PLUGIN_REF);
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

describe("hero-init idempotency and conflict detection", () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), "hero-init-idem-"));
  });

  afterEach(() => {
    rmSync(tempDir, { recursive: true, force: true });
  });

  test("writes a manifest covering managed files but not opencode.json", () => {
    runInit(tempDir);

    const manifestPath = join(tempDir, ".hero", ".manifest.json");
    expect(existsSync(manifestPath)).toBe(true);

    const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
    expect(manifest.version).toBe(PACKAGE_VERSION);
    expect(typeof manifest.files).toBe("object");
    expect(manifest.files[".hero/config.jsonc"]).toMatch(/^[a-f0-9]{64}$/);
    expect(manifest.files[".hero/.hero-version"]).toMatch(/^[a-f0-9]{64}$/);
    expect(manifest.files["opencode.json"]).toBeUndefined();
  });

  test("second run on a clean scaffold does not rewrite managed files", () => {
    runInit(tempDir);

    const configPath = join(tempDir, ".hero", "config.jsonc");
    const versionPath = join(tempDir, ".hero", ".hero-version");
    const beforeConfig = statSync(configPath).mtimeMs;
    const beforeVersion = statSync(versionPath).mtimeMs;

    const result = runInit(tempDir);

    expect(statSync(configPath).mtimeMs).toBe(beforeConfig);
    expect(statSync(versionPath).mtimeMs).toBe(beforeVersion);
    expect(result.stdout).not.toMatch(/wrote \.hero\/config\.jsonc/);
    expect(result.stdout).not.toMatch(/wrote \.hero\/\.hero-version/);
  });

  test("refuses to overwrite a user-modified .hero/config.jsonc without --force", () => {
    runInit(tempDir);

    const configPath = join(tempDir, ".hero", "config.jsonc");
    const customised = JSON.parse(readFileSync(configPath, "utf8"));
    customised.models.implementer = "user-pinned/some-model";
    writeFileSync(configPath, `${JSON.stringify(customised, null, 2)}\n`, "utf8");

    const result = runInitRaw([tempDir, ...modelFlags()]);
    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain(".hero/config.jsonc");
    expect(result.stderr).toContain("--force");

    const onDisk = JSON.parse(readFileSync(configPath, "utf8"));
    expect(onDisk.models.implementer).toBe("user-pinned/some-model");
  });

  test("--force overwrites user modifications", () => {
    runInit(tempDir);

    const configPath = join(tempDir, ".hero", "config.jsonc");
    const customised = JSON.parse(readFileSync(configPath, "utf8"));
    customised.models.implementer = "user-pinned/some-model";
    writeFileSync(configPath, `${JSON.stringify(customised, null, 2)}\n`, "utf8");

    runInit(tempDir, ["--force"]);

    const onDisk = JSON.parse(readFileSync(configPath, "utf8"));
    expect(onDisk.models.implementer).toBe(DEFAULT_MODELS.implementer);
  });

  test("--migrate succeeds against a manifest with the current major", () => {
    runInit(tempDir);

    const manifestPath = join(tempDir, ".hero", ".manifest.json");
    const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
    manifest.version = "0.0.1";
    writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, "utf8");

    const result = runInitRaw([tempDir, ...modelFlags(), "--migrate"]);
    expect(result.status).toBe(0);

    const updated = JSON.parse(readFileSync(manifestPath, "utf8"));
    expect(updated.version).toBe(PACKAGE_VERSION);
  });

  test("--migrate refuses against a fabricated v999 manifest", () => {
    runInit(tempDir);

    const manifestPath = join(tempDir, ".hero", ".manifest.json");
    const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
    manifest.version = "999.0.0";
    writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, "utf8");

    const result = runInitRaw([tempDir, ...modelFlags(), "--migrate"]);
    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain("Major version mismatch");
  });

  test("a manifest entry whose file was deleted by the user is dropped, not recreated", () => {
    runInit(tempDir);

    const gitkeep = join(tempDir, ".opencode", "skills", ".gitkeep");
    expect(existsSync(gitkeep)).toBe(true);
    rmSync(gitkeep);

    runInit(tempDir);

    expect(existsSync(gitkeep)).toBe(false);
    const manifest = JSON.parse(
      readFileSync(join(tempDir, ".hero", ".manifest.json"), "utf8"),
    );
    expect(manifest.files[".opencode/skills/.gitkeep"]).toBeUndefined();
  });
});

describe("hero-init .hero/state.json placeholder", () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), "hero-init-state-"));
  });

  afterEach(() => {
    rmSync(tempDir, { recursive: true, force: true });
  });

  test("scaffolds an empty .hero/state.json on a fresh init", () => {
    runInit(tempDir);

    const statePath = join(tempDir, ".hero", "state.json");
    expect(existsSync(statePath)).toBe(true);

    const parsed = JSON.parse(readFileSync(statePath, "utf8"));
    expect(parsed).toEqual({});
  });

  test("manifest tracks .hero/state.json after init", () => {
    runInit(tempDir);

    const manifestPath = join(tempDir, ".hero", ".manifest.json");
    const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
    expect(manifest.files[".hero/state.json"]).toMatch(/^[a-f0-9]{64}$/);
  });

  test("refuses to overwrite a user-modified .hero/state.json without --force", () => {
    runInit(tempDir);

    const statePath = join(tempDir, ".hero", "state.json");
    writeFileSync(statePath, `${JSON.stringify({ activeIssueId: "42" })}\n`, "utf8");

    const result = runInitRaw([tempDir, ...modelFlags()]);
    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain(".hero/state.json");
    expect(result.stderr).toContain("--force");

    const onDisk = JSON.parse(readFileSync(statePath, "utf8"));
    expect(onDisk).toEqual({ activeIssueId: "42" });
  });

  test("--force overwrites a user-modified .hero/state.json back to empty", () => {
    runInit(tempDir);

    const statePath = join(tempDir, ".hero", "state.json");
    writeFileSync(statePath, `${JSON.stringify({ activeIssueId: "42" })}\n`, "utf8");

    runInit(tempDir, ["--force"]);

    const onDisk = JSON.parse(readFileSync(statePath, "utf8"));
    expect(onDisk).toEqual({});
  });
});

describe("hero-init sandcastle scaffolding", () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), "hero-init-sandcastle-"));
  });

  afterEach(() => {
    rmSync(tempDir, { recursive: true, force: true });
  });

  test("does not scaffold .sandcastle/ when sandcastle is disabled by default", () => {
    runInit(tempDir);

    expect(existsSync(join(tempDir, ".sandcastle"))).toBe(false);
    expect(existsSync(join(tempDir, ".sandcastle", "package.json"))).toBe(false);
  });

  test("scaffolds .sandcastle/package.json when --sandcastle-enabled is passed", () => {
    runInit(tempDir, ["--sandcastle-enabled"]);

    const pkgPath = join(tempDir, ".sandcastle", "package.json");
    expect(existsSync(pkgPath)).toBe(true);

    const parsed = JSON.parse(readFileSync(pkgPath, "utf8"));
    expect(parsed.dependencies).toBeDefined();
    expect(parsed.dependencies.sandcastle).toBeDefined();

    const configPath = join(tempDir, ".hero", "config.jsonc");
    const config = JSON.parse(readFileSync(configPath, "utf8"));
    expect(config.sandcastle).toBeDefined();
    expect(config.sandcastle.enabled).toBe(true);
  });

  test("retains .sandcastle/package.json on a re-run without the flag if config still has enabled: true", () => {
    runInit(tempDir, ["--sandcastle-enabled"]);

    const pkgPath = join(tempDir, ".sandcastle", "package.json");
    expect(existsSync(pkgPath)).toBe(true);

    runInit(tempDir);

    expect(existsSync(pkgPath)).toBe(true);
  });

  test("manifest covers .sandcastle/package.json when sandcastle is enabled", () => {
    runInit(tempDir, ["--sandcastle-enabled"]);

    const manifestPath = join(tempDir, ".hero", ".manifest.json");
    const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
    expect(manifest.files[".sandcastle/package.json"]).toMatch(/^[a-f0-9]{64}$/);
  });
});
