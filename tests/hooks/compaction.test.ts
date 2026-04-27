import { describe, expect, test } from "bun:test";
import { mkdir, mkdtemp, rm, utimes, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { createCompactionHook } from "../../plugin/hooks/compaction.ts";
import type {
  SessionCompactedEvent,
  SessionCompactingEvent,
  ToastApi,
} from "../../plugin/types.ts";

type ToastCall = { message: string; severity?: "info" | "warn" | "error" };

function createFakeToast(): { toast: ToastApi; calls: ToastCall[] } {
  const calls: ToastCall[] = [];
  const toast: ToastApi = {
    show(opts) {
      calls.push(opts);
    },
  };
  return { toast, calls };
}

async function makeTempProject(): Promise<string> {
  return await mkdtemp(join(tmpdir(), "hero-compaction-"));
}

const compactedEvent: SessionCompactedEvent = {
  sessionId: "s1",
  before: { tokenCount: 120000 },
  after: { tokenCount: 40000 },
};

const compactingEvent: SessionCompactingEvent = { sessionId: "s1" };

describe("createCompactionHook — onCompacted", () => {
  test("fires a single warn toast per call mentioning /clear", async () => {
    const { toast, calls } = createFakeToast();
    const root = await makeTempProject();
    try {
      const { onCompacted } = createCompactionHook({ toast, projectRoot: root });
      await onCompacted(compactedEvent);
      expect(calls.length).toBe(1);
      expect(calls[0].severity).toBe("warn");
      expect(calls[0].message).toContain("/clear");
      expect(calls[0].message).toContain("compacted");
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  test("two calls produce two toasts (no internal latching)", async () => {
    const { toast, calls } = createFakeToast();
    const root = await makeTempProject();
    try {
      const { onCompacted } = createCompactionHook({ toast, projectRoot: root });
      await onCompacted(compactedEvent);
      await onCompacted(compactedEvent);
      expect(calls.length).toBe(2);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});

describe("createCompactionHook — onCompacting", () => {
  test("returns nulls when no state file and no PRDs exist", async () => {
    const { toast } = createFakeToast();
    const root = await makeTempProject();
    try {
      const { onCompacting } = createCompactionHook({
        toast,
        projectRoot: root,
      });
      const ctx = await onCompacting(compactingEvent);
      expect(ctx).toEqual({ prdPath: null, activeIssueId: null });
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  test("returns both fields when .hero/state.json contains both keys", async () => {
    const { toast } = createFakeToast();
    const root = await makeTempProject();
    try {
      await mkdir(join(root, ".hero"), { recursive: true });
      await writeFile(
        join(root, ".hero", "state.json"),
        JSON.stringify({
          activePrdPath: ".hero/prds/foo.md",
          activeIssueId: "42",
        }),
      );
      const { onCompacting } = createCompactionHook({
        toast,
        projectRoot: root,
      });
      const ctx = await onCompacting(compactingEvent);
      expect(ctx).toEqual({
        prdPath: ".hero/prds/foo.md",
        activeIssueId: "42",
      });
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  test("returns prdPath only when state has only activePrdPath", async () => {
    const { toast } = createFakeToast();
    const root = await makeTempProject();
    try {
      await mkdir(join(root, ".hero"), { recursive: true });
      await writeFile(
        join(root, ".hero", "state.json"),
        JSON.stringify({ activePrdPath: ".hero/prds/foo.md" }),
      );
      const { onCompacting } = createCompactionHook({
        toast,
        projectRoot: root,
      });
      const ctx = await onCompacting(compactingEvent);
      expect(ctx).toEqual({
        prdPath: ".hero/prds/foo.md",
        activeIssueId: null,
      });
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  test("returns nulls and does not throw on invalid JSON in state file", async () => {
    const { toast } = createFakeToast();
    const root = await makeTempProject();
    try {
      const { onCompacting } = createCompactionHook({
        toast,
        projectRoot: root,
        readState: async () => {
          throw new SyntaxError("bad json");
        },
      });
      const ctx = await onCompacting(compactingEvent);
      expect(ctx).toEqual({ prdPath: null, activeIssueId: null });
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  test("falls back to most recent PRD by mtime when no state file", async () => {
    const { toast } = createFakeToast();
    const root = await makeTempProject();
    try {
      const prdsDir = join(root, ".hero", "prds");
      await mkdir(prdsDir, { recursive: true });
      const older = join(prdsDir, "older.md");
      const newer = join(prdsDir, "newer.md");
      await writeFile(older, "# older");
      await writeFile(newer, "# newer");
      // Force mtimes far apart so this is robust on filesystems with low resolution.
      const olderTime = new Date(Date.now() - 10_000);
      const newerTime = new Date(Date.now());
      await utimes(older, olderTime, olderTime);
      await utimes(newer, newerTime, newerTime);

      const { onCompacting } = createCompactionHook({
        toast,
        projectRoot: root,
      });
      const ctx = await onCompacting(compactingEvent);
      expect(ctx.prdPath).toBe(".hero/prds/newer.md");
      expect(ctx.activeIssueId).toBe(null);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});
