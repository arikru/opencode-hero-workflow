import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { spawnSync } from "node:child_process";
import {
  chmodSync,
  mkdirSync,
  mkdtempSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const PACKAGE_ROOT = new URL("../..", import.meta.url).pathname;
const VERIFY_SCRIPT = join(PACKAGE_ROOT, "scripts", "verify.sh");

/** Install a tiny stub verify dir into the temp project so we can assert routing. */
function installStubVerifiers(projectRoot: string) {
  const verifyDir = join(projectRoot, "scripts", "verify");
  mkdirSync(verifyDir, { recursive: true });
  const stub = (name: string) =>
    `#!/usr/bin/env bash\necho "ROUTED:${name}"\nexit 0\n`;
  writeFileSync(join(verifyDir, "python.sh"), stub("python"), "utf8");
  writeFileSync(join(verifyDir, "node.sh"), stub("node"), "utf8");
  chmodSync(join(verifyDir, "python.sh"), 0o755);
  chmodSync(join(verifyDir, "node.sh"), 0o755);
}

function runDispatcher(
  projectRoot: string,
  env: Record<string, string> = {},
) {
  return spawnSync("bash", [VERIFY_SCRIPT], {
    cwd: projectRoot,
    encoding: "utf8",
    env: {
      PATH: process.env.PATH ?? "",
      HERO_PROJECT_ROOT: projectRoot,
      ...env,
    },
  });
}

describe("scripts/verify.sh dispatcher", () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), "hero-verify-test-"));
    installStubVerifiers(tempDir);
  });

  afterEach(() => {
    rmSync(tempDir, { recursive: true, force: true });
  });

  test("pyproject.toml + HERO_STACK=auto routes to python", () => {
    writeFileSync(join(tempDir, "pyproject.toml"), "[project]\n", "utf8");
    const result = runDispatcher(tempDir, { HERO_STACK: "auto" });
    expect(result.status).toBe(0);
    expect(result.stdout).toContain("ROUTED:python");
  });

  test("requirements.txt only routes to python", () => {
    writeFileSync(join(tempDir, "requirements.txt"), "pytest\n", "utf8");
    const result = runDispatcher(tempDir, { HERO_STACK: "auto" });
    expect(result.status).toBe(0);
    expect(result.stdout).toContain("ROUTED:python");
  });

  test("package.json only routes to node stub and exits 0", () => {
    writeFileSync(join(tempDir, "package.json"), "{}\n", "utf8");
    const result = runDispatcher(tempDir, { HERO_STACK: "auto" });
    expect(result.status).toBe(0);
    expect(result.stdout).toContain("ROUTED:node");
  });

  test("neither python nor node markers prints unknown stack to stderr and exits 0", () => {
    const result = runDispatcher(tempDir, { HERO_STACK: "auto" });
    expect(result.status).toBe(0);
    expect(result.stderr).toContain("unknown stack");
    expect(result.stderr).toContain("HERO_STACK");
  });

  test("HERO_STACK=python overrides auto-detection (no python markers present)", () => {
    writeFileSync(join(tempDir, "package.json"), "{}\n", "utf8");
    const result = runDispatcher(tempDir, { HERO_STACK: "python" });
    expect(result.status).toBe(0);
    expect(result.stdout).toContain("ROUTED:python");
    expect(result.stdout).not.toContain("ROUTED:node");
  });

  test("python markers win over package.json when both present", () => {
    writeFileSync(join(tempDir, "pyproject.toml"), "[project]\n", "utf8");
    writeFileSync(join(tempDir, "package.json"), "{}\n", "utf8");
    const result = runDispatcher(tempDir, { HERO_STACK: "auto" });
    expect(result.status).toBe(0);
    expect(result.stdout).toContain("ROUTED:python");
  });
});
