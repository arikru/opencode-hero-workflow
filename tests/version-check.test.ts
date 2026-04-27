import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  checkVersionDrift,
  readScaffoldVersion,
} from "../plugin/version-check.ts";
import type { ToastApi } from "../plugin/types.ts";

interface ToastCall {
  message: string;
  severity?: "info" | "warn" | "error";
}

function createToastSpy(): { toast: ToastApi; calls: ToastCall[] } {
  const calls: ToastCall[] = [];
  const toast: ToastApi = {
    show(opts) {
      calls.push({ message: opts.message, severity: opts.severity });
    },
  };
  return { toast, calls };
}

describe("readScaffoldVersion", () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), "hero-version-helper-"));
  });

  afterEach(() => {
    rmSync(tempDir, { recursive: true, force: true });
  });

  test("returns null when file is missing", async () => {
    const result = await readScaffoldVersion(join(tempDir, "missing"));
    expect(result).toBeNull();
  });

  test("returns trimmed contents when file exists", async () => {
    const path = join(tempDir, ".hero-version");
    writeFileSync(path, "0.1.0\n", "utf8");
    const result = await readScaffoldVersion(path);
    expect(result).toBe("0.1.0");
  });
});

describe("checkVersionDrift", () => {
  let tempDir: string;
  let scaffoldedVersionPath: string;

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), "hero-version-drift-"));
    mkdirSync(join(tempDir, ".hero"), { recursive: true });
    scaffoldedVersionPath = join(tempDir, ".hero", ".hero-version");
  });

  afterEach(() => {
    rmSync(tempDir, { recursive: true, force: true });
  });

  test("does not toast when scaffold version file is missing", async () => {
    const { toast, calls } = createToastSpy();

    await checkVersionDrift({
      packageVersion: "0.1.0",
      scaffoldedVersionPath,
      toast,
    });

    expect(calls).toHaveLength(0);
  });

  test("does not toast when versions match", async () => {
    writeFileSync(scaffoldedVersionPath, "0.1.0\n", "utf8");
    const { toast, calls } = createToastSpy();

    await checkVersionDrift({
      packageVersion: "0.1.0",
      scaffoldedVersionPath,
      toast,
    });

    expect(calls).toHaveLength(0);
  });

  test("tolerates trailing whitespace in the scaffold file", async () => {
    writeFileSync(scaffoldedVersionPath, "0.1.0\n", "utf8");
    const { toast, calls } = createToastSpy();

    await checkVersionDrift({
      packageVersion: "0.1.0",
      scaffoldedVersionPath,
      toast,
    });

    expect(calls).toHaveLength(0);
  });

  test("toasts exactly once when versions differ, mentioning both", async () => {
    writeFileSync(scaffoldedVersionPath, "0.1.0\n", "utf8");
    const { toast, calls } = createToastSpy();

    await checkVersionDrift({
      packageVersion: "0.2.0",
      scaffoldedVersionPath,
      toast,
    });

    expect(calls).toHaveLength(1);
    expect(calls[0].message).toContain("0.1.0");
    expect(calls[0].message).toContain("0.2.0");
    expect(calls[0].severity).toBe("warn");
  });
});
