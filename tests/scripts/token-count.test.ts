import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const PACKAGE_ROOT = new URL("../..", import.meta.url).pathname;
const TOKEN_COUNT_SCRIPT = join(PACKAGE_ROOT, "scripts", "token-count.sh");

function runWithStdin(input: string) {
  return spawnSync("bash", [TOKEN_COUNT_SCRIPT], {
    input,
    encoding: "utf8",
  });
}

function runWithArgs(...args: string[]) {
  return spawnSync("bash", [TOKEN_COUNT_SCRIPT, ...args], {
    encoding: "utf8",
  });
}

function parseCount(stdout: string): number {
  const m = stdout.match(/Approximate token count:\s*(\d+)/);
  if (!m) throw new Error(`no count in stdout: ${stdout}`);
  return Number(m[1]);
}

describe("scripts/token-count.sh", () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), "hero-token-count-test-"));
  });

  afterEach(() => {
    rmSync(tempDir, { recursive: true, force: true });
  });

  test("empty stdin reports 0", () => {
    const result = runWithStdin("");
    expect(result.status).toBe(0);
    expect(parseCount(result.stdout)).toBe(0);
  });

  test("4 chars on stdin reports 1", () => {
    const result = runWithStdin("abcd");
    expect(result.status).toBe(0);
    expect(parseCount(result.stdout)).toBe(1);
  });

  test("7 chars on stdin reports 2 (rounded)", () => {
    const result = runWithStdin("abcdefg");
    expect(result.status).toBe(0);
    expect(parseCount(result.stdout)).toBe(2);
  });

  test("100 chars reports 25", () => {
    const result = runWithStdin("a".repeat(100));
    expect(result.status).toBe(0);
    expect(parseCount(result.stdout)).toBe(25);
  });

  test("file arg with 8 chars reports 2", () => {
    const file = join(tempDir, "in.txt");
    writeFileSync(file, "abcdefgh", "utf8");
    const result = runWithArgs(file);
    expect(result.status).toBe(0);
    expect(parseCount(result.stdout)).toBe(2);
  });

  test("two file args sum character counts", () => {
    const a = join(tempDir, "a.txt");
    const b = join(tempDir, "b.txt");
    writeFileSync(a, "abcdefgh", "utf8"); // 8
    writeFileSync(b, "ijklmnop", "utf8"); // 8 → total 16 → 4
    const result = runWithArgs(a, b);
    expect(result.status).toBe(0);
    expect(parseCount(result.stdout)).toBe(4);
  });

  test("output always contains the literal 'Approximate'", () => {
    const result = runWithStdin("hello");
    expect(result.status).toBe(0);
    expect(result.stdout).toContain("Approximate");
  });
});
