import { readdir, readFile, stat } from "node:fs/promises";
import { join } from "node:path";

import type {
  CompactingContext,
  SessionCompactedHook,
  SessionCompactingHook,
  ToastApi,
} from "../types.ts";

export interface CompactionHookOptions {
  toast: ToastApi;
  projectRoot: string;
  // Test injection point. Defaults to reading `.hero/state.json` from
  // `projectRoot`. Returning `null` means "no state file"; throwing means
  // "unreadable / unparseable" — both collapse to nulls in the result.
  readState?: () => Promise<unknown>;
}

const COMPACTED_MESSAGE =
  "Session compacted. Prefer /clear next time — fresh context outperforms compacted context.";

const PRDS_DIR = join(".hero", "prds");

function toRelative(projectRoot: string, abs: string): string {
  // Always emit forward slashes regardless of host OS.
  const root = projectRoot.endsWith("/") ? projectRoot : projectRoot + "/";
  const rel = abs.startsWith(root) ? abs.slice(root.length) : abs;
  return rel.split(/[\\/]/).filter(Boolean).join("/");
}

async function defaultReadState(projectRoot: string): Promise<unknown> {
  const path = join(projectRoot, ".hero", "state.json");
  const raw = await readFile(path, "utf8");
  return JSON.parse(raw);
}

async function findMostRecentPrd(projectRoot: string): Promise<string | null> {
  const dir = join(projectRoot, PRDS_DIR);
  let entries: string[];
  try {
    entries = await readdir(dir);
  } catch {
    return null;
  }
  const stats = await Promise.all(
    entries.map(async (name) => {
      const abs = join(dir, name);
      try {
        const s = await stat(abs);
        return s.isFile() ? { abs, mtimeMs: s.mtimeMs } : null;
      } catch {
        return null;
      }
    }),
  );
  const files = stats.filter((s): s is { abs: string; mtimeMs: number } => !!s);
  if (files.length === 0) return null;
  files.sort((a, b) => b.mtimeMs - a.mtimeMs);
  return toRelative(projectRoot, files[0].abs);
}

function pickString(obj: Record<string, unknown>, key: string): string | null {
  const v = obj[key];
  return typeof v === "string" && v.length > 0 ? v : null;
}

export function createCompactionHook(opts: CompactionHookOptions): {
  onCompacted: SessionCompactedHook;
  onCompacting: SessionCompactingHook;
} {
  const { toast, projectRoot } = opts;
  const readState = opts.readState ?? (() => defaultReadState(projectRoot));

  const onCompacted: SessionCompactedHook = async () => {
    await toast.show({ message: COMPACTED_MESSAGE, severity: "warn" });
  };

  const onCompacting: SessionCompactingHook = async () => {
    let state: Record<string, unknown> | null = null;
    try {
      const parsed = await readState();
      if (parsed && typeof parsed === "object") {
        state = parsed as Record<string, unknown>;
      }
    } catch {
      // Missing file, parse error, or any other read failure: fall back to nulls.
      state = null;
    }

    const stateActiveIssueId = state ? pickString(state, "activeIssueId") : null;
    const statePrdPath = state ? pickString(state, "activePrdPath") : null;

    const prdPath = statePrdPath ?? (await findMostRecentPrd(projectRoot));
    const ctx: CompactingContext = {
      prdPath,
      activeIssueId: stateActiveIssueId,
    };
    return ctx;
  };

  return { onCompacted, onCompacting };
}
